import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ViolationError } from "./errors";
import { recordCaseEvent } from "./events";

type Actor = { id: string; role: RoleName };
const NOTE_INCLUDE = { actor: { select: { id: true, firstName: true, lastName: true } } } as const;

export async function addNote(caseId: string, body: string, actor: Actor) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { id: true } });
  if (!c) throw new ViolationError(404, "Case not found");
  const row = await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "NOTE", body: body.trim() });
  return prisma.codeViolationEvent.findUniqueOrThrow({ where: { id: row.id }, include: NOTE_INCLUDE });
}

/** Only NOTE rows are editable, by their author or an ADMIN/MANAGER. */
export async function editNote(caseId: string, noteId: string, body: string, actor: Actor) {
  const n = await prisma.codeViolationEvent.findUnique({ where: { id: noteId } });
  if (!n || n.caseId !== caseId || n.type !== "NOTE") throw new ViolationError(404, "Note not found");
  if (n.actorUserId !== actor.id && actor.role !== "ADMIN" && actor.role !== "MANAGER") throw new ViolationError(403, "You can only edit your own notes");
  return prisma.codeViolationEvent.update({ where: { id: noteId }, data: { body: body.trim(), editedAt: new Date() }, include: NOTE_INCLUDE });
}

export async function deleteNote(caseId: string, noteId: string, actor: Actor) {
  const n = await prisma.codeViolationEvent.findUnique({ where: { id: noteId } });
  if (!n || n.caseId !== caseId || n.type !== "NOTE") throw new ViolationError(404, "Note not found");
  if (n.actorUserId !== actor.id && actor.role !== "ADMIN" && actor.role !== "MANAGER") throw new ViolationError(403, "You can only delete your own notes");
  await prisma.codeViolationEvent.delete({ where: { id: noteId } });
}
