import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { updateTaskSchema } from "@/lib/validators/task";
import { canDeleteTask, canViewTask } from "@/lib/tasks/access";
import { recordAudit } from "@/lib/audit/record";
import { TASK_DETAIL_INCLUDE } from "@/lib/tasks/include";
import { updateTask, TaskUpdateError } from "@/lib/tasks/update";
import { taskRightsFor, visibilityScopeFor } from "@/lib/workflows/visibility";

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
  return NextResponse.json({ ...task, viewer: await taskRightsFor(session.user, task) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const parsed = await validateBody(request, updateTaskSchema);
  if (!parsed.ok) return parsed.response;

  const user = session.user;
  const row = await prisma.task.findUnique({
    where: { id },
    select: { assignedUserId: true, createdByUserId: true, jobId: true, violationCaseId: true, workflowInstanceId: true },
  });
  if (!row) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const rights = await taskRightsFor(user, row);
  try {
    const { task } = await updateTask({
      id,
      input: parsed.data,
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
  if (!canDeleteTask(session.user, task)) return forbidden();
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
