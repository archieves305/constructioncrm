import type { PermitInspectionResult, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { createTask } from "@/lib/tasks/create";
import { recordTaskEvent } from "@/lib/tasks/events";
import { updateTask, TaskUpdateError } from "@/lib/tasks/update";
import { addBusinessDaysFrom, atDueHour } from "./schedule";
import { loadRoleContext, resolveAssignee } from "./roles";

/**
 * Inspection results on a workflow step.
 *
 *   PASS         → the step completes (the result is its evidence).
 *   CONDITIONAL  → completes, plus a correction task for the conditions.
 *   FAIL         → the step goes BLOCKED ("Failed inspection") and a
 *                  correction task is created that it now waits on. When
 *                  the correction completes, activation reopens the
 *                  inspection as Ready with a fresh date — one row, so the
 *                  whole history (fail, fix, re-request, pass) reads on
 *                  its timeline.
 *
 * The task is the authoritative record; a `JobPermitInspection` (job) or a
 * `CodeViolationInspection` (agency reinspection on a case) row is mirrored
 * only when the caller names one.
 */

export const CORRECTION_MARK = ":correction:";

export function isCorrectionKey(key: string | null | undefined): boolean {
  return Boolean(key && key.includes(CORRECTION_MARK));
}

export type InspectionResultInput = {
  taskId: string;
  result: Extract<PermitInspectionResult, "PASS" | "FAIL" | "CONDITIONAL">;
  notes?: string | null;
  inspectedAt?: Date | null;
  jobPermitInspectionId?: string | null;
  violationInspectionId?: string | null;
  actor: { id: string; role: RoleName };
};

export class InspectionError extends Error {
  constructor(
    public readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = "InspectionError";
  }
}

export async function recordInspectionResult(input: InspectionResultInput): Promise<{ status: string; correctionTaskId: string | null }> {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      title: true,
      status: true,
      leadId: true,
      jobId: true,
      violationCaseId: true,
      violationItemId: true,
      assignedUserId: true,
      dueLocked: true,
      workflowInstanceId: true,
      workflowTaskKey: true,
      workflowPhaseKey: true,
      workflowModuleKey: true,
      workflowRole: true,
      workflowSortOrder: true,
      requiredEvidence: true,
      _count: { select: { dependencies: { where: { dependsOn: { workflowTaskKey: { contains: CORRECTION_MARK } } } } } },
    },
  });
  if (!task) throw new InspectionError(404, "Task not found");
  if (!task.workflowInstanceId || !task.workflowTaskKey) throw new InspectionError(400, "Only a workflow step can carry an inspection result");
  if (task.requiredEvidence !== "INSPECTION_RESULT") throw new InspectionError(400, "This step does not record an inspection");
  if (task.status === "COMPLETED" || task.status === "CANCELLED") throw new InspectionError(400, "This step is already closed");

  const now = input.inspectedAt ?? new Date();
  const notes = input.notes?.trim() || null;
  await prisma.task.update({ where: { id: task.id }, data: { inspectionResult: input.result, inspectionRecordedAt: now } });
  await recordTaskEvent({ taskId: task.id, actorUserId: input.actor.id, type: "INSPECTION_RESULT", toValue: input.result, body: notes });

  if (input.jobPermitInspectionId) {
    await prisma.jobPermitInspection.updateMany({
      where: { id: input.jobPermitInspectionId },
      data: { result: input.result, completedAt: now, notes: notes ?? undefined },
    });
  }
  if (input.violationInspectionId) {
    await prisma.codeViolationInspection.updateMany({
      where: { id: input.violationInspectionId },
      data: { result: input.result, status: "COMPLETED", completedAt: now, notes: notes ?? undefined, taskId: task.id },
    });
  }

  let correctionTaskId: string | null = null;
  if (input.result === "FAIL" || input.result === "CONDITIONAL") {
    const n = task._count.dependencies + 1;
    const roleCtx = await loadRoleContext(prisma, { instanceId: task.workflowInstanceId });
    const assignee = resolveAssignee("SUPERINTENDENT", roleCtx) ?? task.assignedUserId;
    const correction = await createTask(
      {
        title: input.result === "FAIL" ? `Correct failed inspection items — ${task.title}` : `Complete conditions — ${task.title}`,
        description: notes ? `Inspector notes: ${notes}` : null,
        priority: "HIGH",
        dueAt: atDueHour(addBusinessDaysFrom(now, 2)),
        assignedUserId: assignee,
        createdByUserId: input.actor.id,
        // The correction lives wherever the failed step lives (job, or case + item).
        leadId: task.leadId,
        jobId: task.jobId,
        violationCaseId: task.violationCaseId,
        violationItemId: task.violationItemId,
        source: "workflow",
        activatedAt: now,
        workflow: {
          instanceId: task.workflowInstanceId,
          taskKey: `${task.workflowTaskKey}${CORRECTION_MARK}${n}`,
          phaseKey: task.workflowPhaseKey ?? "core:other",
          moduleKey: task.workflowModuleKey ?? "core",
          role: "SUPERINTENDENT",
          sortOrder: (task.workflowSortOrder ?? 0) + 1,
          anchor: "PREDECESSOR",
          dueOffsetBusinessDays: 2,
          requiredEvidence: "PHOTO",
        },
      },
      { actorUserId: input.actor.id },
    );
    correctionTaskId = correction.id;
    if (input.result === "FAIL") {
      // The inspection now waits on the fix; activation reopens it afterwards.
      await prisma.taskDependency.create({
        data: { taskId: task.id, dependsOnTaskId: correction.id, kind: "BLOCKING", source: "workflow", createdByUserId: input.actor.id },
      });
      await recordTaskEvent({ taskId: task.id, actorUserId: input.actor.id, type: "DEPENDENCY_ADDED", toValue: correction.id });
    }
  }

  let status: string;
  if (input.result === "FAIL") {
    const r = await updateTask({
      id: task.id,
      input: { status: "BLOCKED", blockedReason: `Failed inspection${notes ? ` — ${notes}` : ""}` },
      actorUserId: input.actor.id,
      actorRole: input.actor.role,
    });
    status = r.task.status;
  } else {
    try {
      const r = await updateTask({ id: task.id, input: { status: "COMPLETED" }, actorUserId: input.actor.id, actorRole: input.actor.role, internal: { bypassEvidence: true, tickChecklist: true } });
      status = r.task.status;
    } catch (err) {
      if (err instanceof TaskUpdateError) throw new InspectionError(400, err.message);
      throw err;
    }
  }

  await recordAudit({
    actorUserId: input.actor.id,
    entityType: "Task",
    entityId: task.id,
    action: "inspection_result",
    after: { result: input.result, notes, correctionTaskId, jobPermitInspectionId: input.jobPermitInspectionId ?? null, violationInspectionId: input.violationInspectionId ?? null },
  });
  return { status, correctionTaskId };
}
