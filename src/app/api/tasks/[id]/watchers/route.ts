import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { taskWatcherSchema } from "@/lib/validators/task";
import { canCommentOnTask } from "@/lib/tasks/access";
import { recordTaskEvent } from "@/lib/tasks/events";

async function loadTask(id: string) {
  return prisma.task.findUnique({
    where: { id },
    select: { assignedUserId: true, createdByUserId: true },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const parsed = await validateBody(request, taskWatcherSchema);
  if (!parsed.ok) return parsed.response;

  const task = await loadTask(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (!canCommentOnTask(session.user, task)) return forbidden();

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, isActive: true },
  });
  if (!target?.isActive) {
    return NextResponse.json({ error: "That user is not active" }, { status: 400 });
  }

  const watcher = await prisma.taskWatcher.upsert({
    where: { taskId_userId: { taskId: id, userId: target.id } },
    create: { taskId: id, userId: target.id },
    update: {},
    select: {
      id: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  await recordTaskEvent({
    taskId: id,
    actorUserId: session.user.id,
    type: "WATCHER_ADDED",
    toValue: target.id,
  });

  return NextResponse.json(watcher, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  const task = await loadTask(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (!canCommentOnTask(session.user, task)) return forbidden();

  await prisma.taskWatcher
    .delete({ where: { taskId_userId: { taskId: id, userId } } })
    .catch(() => null); // already gone is the desired end state

  await recordTaskEvent({
    taskId: id,
    actorUserId: session.user.id,
    type: "WATCHER_REMOVED",
    toValue: userId,
  });

  return NextResponse.json({ ok: true });
}
