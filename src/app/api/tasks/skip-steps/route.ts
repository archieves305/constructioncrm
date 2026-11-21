import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { updateTask, TaskUpdateError } from "@/lib/tasks/update";
import { validateBody } from "@/lib/validation/body";
import { taskRightsFor } from "@/lib/workflows/visibility";

/**
 * POST /api/tasks/skip-steps — "these steps don't apply to this job": skip
 * several workflow steps with one reason, from the Workflow tab. Each step is
 * checked on its own (`taskRightsFor`: office roles, the job's PM / case
 * manager, the workflow's team) and goes through `updateTask`, so a blocking
 * gate is still skipped only by an admin or manager. Steps the rules refuse
 * are reported; the rest go ahead. One audit row records the run.
 */
const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  reason: z.string().trim().min(3, "say why these steps don't apply").max(500),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const user = session.user;
  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  const { ids, reason } = v.data;

  const rows = await prisma.task.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, assignedUserId: true, createdByUserId: true, jobId: true, violationCaseId: true, workflowInstanceId: true, workflowTaskKey: true },
  });
  const done: string[] = [];
  const refused: { id: string; reason: string }[] = [];
  for (const id of [...new Set(ids)]) {
    const row = rows.find((r) => r.id === id);
    if (!row || !row.workflowTaskKey) {
      refused.push({ id, reason: "Not a workflow step" });
      continue;
    }
    const rights = await taskRightsFor(user, row);
    if (!rights.canEdit) {
      refused.push({ id, reason: "You cannot change this step" });
      continue;
    }
    try {
      await updateTask({ id, input: { status: "CANCELLED", skipReason: reason }, actorUserId: user.id, actorRole: user.role, notify: "none" });
      done.push(id);
    } catch (err) {
      if (err instanceof TaskUpdateError) refused.push({ id, reason: err.message });
      else throw err;
    }
  }

  if (done.length > 0) {
    await recordAudit({ actorUserId: user.id, entityType: "task", entityId: "bulk", action: "workflow_steps_skip", after: { reason, done, refused } });
  }
  return NextResponse.json({ done: done.length, refused });
}
