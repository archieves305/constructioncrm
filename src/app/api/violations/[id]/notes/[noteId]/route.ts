import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { caseNoteSchema } from "@/lib/validators/violation";
import { deleteNote, editNote } from "@/lib/violations/notes";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, noteId } = await params;
  const parsed = await validateBody(request, caseNoteSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canComment);
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await editNote(id, noteId, parsed.data.body, session.user));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, noteId } = await params;
  const gate = await requireCase(id, session.user, (p) => p.canComment);
  if ("response" in gate) return gate.response;
  try {
    await deleteNote(id, noteId, session.user);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
