import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { taskNoteSchema } from "@/lib/validators/task";

/**
 * Notes are editable; the system events sharing this table are not. Both live
 * in `task_events`, so every handler here filters on `type: "NOTE"` — without
 * it, a crafted noteId would let someone rewrite the audit trail through the
 * notes endpoint.
 */

function notFound() {
  return NextResponse.json({ error: "Note not found" }, { status: 404 });
}

async function loadNote(taskId: string, noteId: string) {
  return prisma.taskEvent.findFirst({
    where: { id: noteId, taskId, type: "NOTE" },
    select: { id: true, actorUserId: true },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id, noteId } = await params;
  const parsed = await validateBody(request, taskNoteSchema);
  if (!parsed.ok) return parsed.response;

  const note = await loadNote(id, noteId);
  if (!note) return notFound();

  // Only the author rewrites their own words. An ADMIN can delete a note but
  // not edit one — putting different words in someone's mouth is worse than
  // removing them, and the timeline would show no sign of it.
  if (note.actorUserId !== session.user.id) return forbidden();

  const updated = await prisma.taskEvent.update({
    where: { id: noteId },
    data: { body: parsed.data.body, editedAt: new Date() },
    select: {
      id: true,
      body: true,
      editedAt: true,
      createdAt: true,
      actor: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id, noteId } = await params;
  const note = await loadNote(id, noteId);
  if (!note) return notFound();

  const isAuthor = note.actorUserId === session.user.id;
  if (!isAuthor && session.user.role !== "ADMIN") return forbidden();

  await prisma.taskEvent.delete({ where: { id: noteId } });
  return NextResponse.json({ ok: true });
}
