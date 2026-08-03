import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { taskNoteSchema } from "@/lib/validators/task";
import { canCommentOnTask } from "@/lib/tasks/access";
import { parseMentions } from "@/lib/tasks/mentions";
import { notifyTaskMentions } from "@/lib/tasks/notify";

const NOTE_SELECT = {
  id: true,
  body: true,
  editedAt: true,
  createdAt: true,
  actor: { select: { id: true, firstName: true, lastName: true } },
} as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const task = await prisma.task.findUnique({
    where: { id },
    select: { assignedUserId: true, createdByUserId: true },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (!canCommentOnTask(session.user, task)) return forbidden();

  const notes = await prisma.taskEvent.findMany({
    where: { taskId: id, type: "NOTE" },
    orderBy: { createdAt: "asc" },
    select: NOTE_SELECT,
  });
  return NextResponse.json(notes);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const parsed = await validateBody(request, taskNoteSchema);
  if (!parsed.ok) return parsed.response;

  const task = await prisma.task.findUnique({
    where: { id },
    select: { assignedUserId: true, createdByUserId: true },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (!canCommentOnTask(session.user, task)) return forbidden();

  const note = await prisma.taskEvent.create({
    data: {
      taskId: id,
      actorUserId: session.user.id,
      type: "NOTE",
      body: parsed.data.body,
    },
    select: NOTE_SELECT,
  });

  // Writing a note is an implicit statement of interest, so the author starts
  // following the task. Without this, someone who asks a question in a note
  // never hears the answer unless they remember to come back and look.
  await prisma.taskWatcher.upsert({
    where: { taskId_userId: { taskId: id, userId: session.user.id } },
    create: { taskId: id, userId: session.user.id },
    update: {},
  });

  const mentionable = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const mentionedUserIds = parseMentions(parsed.data.body, mentionable);

  // Being named in a note is a standing interest too — otherwise the person
  // you pulled in misses every later reply in the thread.
  if (mentionedUserIds.length > 0) {
    await prisma.taskWatcher.createMany({
      data: mentionedUserIds.map((userId) => ({ taskId: id, userId })),
      skipDuplicates: true,
    });
  }

  const actorUserId = session.user.id;
  const authorName = `${session.user.firstName} ${session.user.lastName}`.trim();
  after(async () => {
    await notifyTaskMentions({
      taskId: id,
      actorUserId,
      mentionedUserIds,
      note: { authorName, body: parsed.data.body, createdAt: note.createdAt },
    });
  });

  return NextResponse.json({ ...note, mentionedUserIds }, { status: 201 });
}
