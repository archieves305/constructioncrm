import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { manualWorkflowTaskSchema } from "@/lib/validators/workflow";
import { canCoordinateWorkflow } from "@/lib/workflows/access";
import { jobScopeFor } from "@/lib/workflows/visibility";
import { createTask } from "@/lib/tasks/create";
import { parseDueAt } from "@/lib/tasks/dates";
import { splitFullKey } from "@/lib/workflows/keys";
import { loadInstanceModules } from "@/lib/workflows/load";
import { recordTaskEvents } from "@/lib/tasks/events";

/**
 * A job-specific task inside a workflow phase. It has no template key, so
 * reconciliation never touches it, but it lives in the phase, can wait on
 * other steps and shows up in the tab like any other row.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const user = session.user;

  const parsed = await validateBody(request, manualWorkflowTaskSchema);
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;

  const jobScope = await jobScopeFor(id);
  if (!jobScope) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!canCoordinateWorkflow(user, jobScope)) return forbidden();
  const instance = await prisma.jobWorkflowInstance.findUnique({ where: { jobId: id }, select: { id: true } });
  if (!instance) return NextResponse.json({ error: "This job has no workflow yet" }, { status: 404 });

  const { moduleKey, shortKey } = splitFullKey(b.phaseKey);
  const modules = await loadInstanceModules(prisma, instance.id);
  const phase = modules.find((m) => m.moduleKey === moduleKey)?.definition.phases.find((p) => p.key === shortKey);
  if (!phase) return badRequest("Unknown phase");

  const depIds = Array.from(new Set(b.dependsOnTaskIds ?? []));
  if (depIds.length > 0) {
    const n = await prisma.task.count({ where: { id: { in: depIds }, workflowInstanceId: instance.id } });
    if (n !== depIds.length) return badRequest("Every dependency must be a step in this workflow");
  }
  const openDeps =
    depIds.length > 0
      ? await prisma.task.count({ where: { id: { in: depIds }, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } } })
      : 0;

  const task = await createTask(
    {
      title: b.title,
      description: b.description ?? null,
      priority: b.priority ?? "MEDIUM",
      dueAt: b.dueAt ? parseDueAt(b.dueAt) : null,
      assignedUserId: b.assignedUserId ?? null,
      createdByUserId: user.id,
      jobId: id,
      source: "manual",
      activatedAt: openDeps > 0 ? null : new Date(),
      workflow: { instanceId: instance.id, taskKey: null, phaseKey: b.phaseKey, moduleKey, anchor: openDeps > 0 ? "PREDECESSOR" : null, dueOffsetBusinessDays: 2 },
    },
    { actorUserId: user.id },
  );
  if (depIds.length > 0) {
    await prisma.taskDependency.createMany({
      data: depIds.map((dependsOnTaskId) => ({ taskId: task.id, dependsOnTaskId, kind: "BLOCKING" as const, source: "manual", createdByUserId: user.id })),
      skipDuplicates: true,
    });
    await recordTaskEvents({
      taskId: task.id,
      actorUserId: user.id,
      events: depIds.map((d) => ({ type: "DEPENDENCY_ADDED" as const, fromValue: null, toValue: d })),
    });
  }
  return NextResponse.json(task, { status: 201 });
}
