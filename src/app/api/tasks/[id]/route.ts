import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { updateTaskSchema } from "@/lib/validators/task";
import { canEditTask, canViewTask } from "@/lib/tasks/access";
import { TASK_DETAIL_INCLUDE } from "@/lib/tasks/include";
import { updateTask, TaskUpdateError } from "@/lib/tasks/update";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const task = await prisma.task.findUnique({ where: { id }, include: TASK_DETAIL_INCLUDE });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (!canViewTask(session.user, task)) return forbidden();

  return NextResponse.json(task);
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
  try {
    const { task } = await updateTask({
      id,
      input: parsed.data,
      actorUserId: user.id,
      authorize: (existing) => canEditTask(user, existing),
    });
    return NextResponse.json(task);
  } catch (err) {
    if (err instanceof TaskUpdateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
