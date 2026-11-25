import type { Prisma, Priority, FieldIssueType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isCrewRole } from "@/lib/access/roles";
import { recordAudit } from "@/lib/audit/record";
import { createTask } from "@/lib/tasks/create";
import { userForJobRole } from "@/lib/workflows/roles";

/**
 * The one way a field issue is made — from the phone, the web, or an
 * inspection's confirmed finding. It also makes the linked office task, so
 * the issue lands in the task queue; resolving either side completes the
 * other (`updateTask`).
 */
export const TYPE_LABELS: Record<FieldIssueType, string> = {
  OFFICE_FOLLOW_UP: "Field",
  CO_REVIEW: "Field: CO review",
  SAFETY: "Field: Safety",
  MATERIAL_REQUEST: "Field: Materials",
  INSPECTION_REMINDER: "Field: Inspection",
  PUNCH: "Punch",
};

export const FIELD_ISSUE_INCLUDE = {
  raisedBy: { select: { id: true, firstName: true, lastName: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  task: { select: { id: true, status: true } },
} satisfies Prisma.FieldIssueInclude;

export type CreateFieldIssueInput = {
  id?: string;
  jobId: string;
  type: FieldIssueType;
  title: string;
  description?: string | null;
  priority: Priority;
  assignedUserId?: string | null;
  dueAt?: Date | null;
  dailyLogId?: string | null;
  qualityFindingId?: string | null;
};

export async function createFieldIssue(
  input: CreateFieldIssueInput,
  actor: { id: string; role: string },
  job: { projectManagerId: string | null },
) {
  // A material request nobody was named for goes to whoever buys for the job
  // (the Purchasing slot, else the company default), not into an unowned task.
  // A problem a crew lead reports with nobody named goes to the job's PM
  // (purchasing first for materials): a crew never leaves it unowned.
  const assignedUserId =
    input.assignedUserId ||
    (input.type === "MATERIAL_REQUEST" ? await userForJobRole(input.jobId, "PURCHASING") : null) ||
    (isCrewRole(actor.role) ? job.projectManagerId : null);

  const issue = await prisma.$transaction(async (tx) => {
    const created = await tx.fieldIssue.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        jobId: input.jobId,
        dailyLogId: input.dailyLogId || null,
        type: input.type,
        title: input.title,
        description: input.description || null,
        priority: input.priority,
        assignedUserId,
        dueAt: input.dueAt ?? null,
        raisedByUserId: actor.id,
        qualityFindingId: input.qualityFindingId ?? null,
      },
    });
    // Through the shared creator so the task gets its CREATED/ASSIGNED
    // timeline rows and the assignee is actually told. Mail is deferred past
    // the response, i.e. after this transaction commits.
    const task = await createTask(
      {
        jobId: input.jobId,
        dailyLogId: input.dailyLogId || null,
        title: `[${TYPE_LABELS[input.type]}] ${input.title}`,
        description: input.description || null,
        priority: input.priority,
        assignedUserId,
        createdByUserId: actor.id,
        dueAt: input.dueAt ?? null,
        source: "field_issue",
      },
      { db: tx, actorUserId: actor.id },
    );
    return tx.fieldIssue.update({ where: { id: created.id }, data: { taskId: task.id }, include: FIELD_ISSUE_INCLUDE });
  });

  await recordAudit({
    actorUserId: actor.id,
    entityType: "FieldIssue",
    entityId: issue.id,
    action: "create",
    after: { jobId: input.jobId, type: issue.type, title: issue.title, ...(input.qualityFindingId ? { qualityFindingId: input.qualityFindingId } : {}) },
  });
  return issue;
}
