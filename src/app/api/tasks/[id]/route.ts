import { NextRequest, NextResponse } from "next/server";
import { forViewer } from "@/lib/access/crew-redact";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { updateTaskSchema } from "@/lib/validators/task";
import { canDeleteTask, canViewTask } from "@/lib/tasks/access";
import { recordAudit } from "@/lib/audit/record";
import { TASK_DETAIL_INCLUDE } from "@/lib/tasks/include";
import { updateTask, TaskUpdateError } from "@/lib/tasks/update";
import { taskRightsFor, visibilityScopeFor } from "@/lib/workflows/visibility";
import { checkExpectations } from "@/lib/tasks/expect";
import { withIdempotency } from "@/lib/api/idempotency";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const task = await prisma.task.findUnique({ where: { id }, include: TASK_DETAIL_INCLUDE });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (!canViewTask(session.user, task, await visibilityScopeFor(session.user))) return forbidden();

  // What this viewer may do, so the sheet does not have to guess from ownership alone.
  return NextResponse.json(forViewer(session.user.role, { ...task, viewer: await taskRightsFor(session.user, task) }));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const user = session.user;
  return withIdempotency(request, user.id, `PATCH /api/tasks/${id}`, async () => {
    const parsed = await validateBody(request, updateTaskSchema);
    if (!parsed.ok) return parsed.response;
    const { expect, ...input } = parsed.data;

    const row = await prisma.task.findUnique({
      where: { id },
      select: {
        assignedUserId: true,
        createdByUserId: true,
        jobId: true,
        violationCaseId: true,
        workflowInstanceId: true,
        status: true,
        dueAt: true,
        blockedReason: true,
        title: true,
        description: true,
        priority: true,
      },
    });
    if (!row) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    const rights = await taskRightsFor(user, row);

    // An edit made from a stale copy (the phone was offline): refuse a field
    // someone else changed, and skip a write the task already reflects.
    if (expect) {
      if (!rights.canEdit) return NextResponse.json({ error: "You cannot edit this task" }, { status: 403 });
      const check = checkExpectations(row, expect, input);
      if (!check.ok) {
        const current = await prisma.task.findUnique({ where: { id }, include: TASK_DETAIL_INCLUDE });
        return NextResponse.json(
          {
            error: "Someone changed this task since you last saw it",
            code: "conflict",
            conflicts: check.conflicts,
            current,
          },
          { status: 409 },
        );
      }
      if (check.noop) {
        const current = await prisma.task.findUnique({ where: { id }, include: TASK_DETAIL_INCLUDE });
        return NextResponse.json(current);
      }
    }

    try {
      const { task } = await updateTask({
        id,
        input,
        actorUserId: user.id,
        actorRole: user.role,
        authorize: () => rights.canEdit,
      });
      return NextResponse.json(task);
    } catch (err) {
      if (err instanceof TaskUpdateError) {
        return NextResponse.json({ error: err.message, hint: err.hint ?? null }, { status: err.status });
      }
      throw err;
    }
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, title: true, assignedUserId: true, createdByUserId: true, sourceKey: true, jobId: true, leadId: true, workflowTaskKey: true },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (!canDeleteTask(session.user, task)) return forbidden("Only the person who raised this task, an admin, a manager or office staff can delete it.");
  // A workflow step is part of a plan other steps depend on. It is skipped
  // (with a reason, on the timeline), never deleted.
  if (task.workflowTaskKey) {
    return NextResponse.json({ error: "Workflow steps are skipped, not deleted — use Skip on the step instead" }, { status: 400 });
  }

  // Events and watchers cascade; a linked field issue keeps its row with
  // taskId set to null. The audit row is the only trace afterwards.
  await prisma.task.delete({ where: { id } });
  await recordAudit({
    actorUserId: session.user.id,
    entityType: "Task",
    entityId: id,
    action: "delete",
    before: task,
  });

  return NextResponse.json({ ok: true });
}
