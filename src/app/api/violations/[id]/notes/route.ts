import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { caseNoteSchema } from "@/lib/validators/violation";
import { addNote } from "@/lib/violations/notes";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const gate = await requireCase(id, session.user);
  if ("response" in gate) return gate.response;
  const notes = await prisma.codeViolationEvent.findMany({ where: { caseId: id, type: "NOTE" }, orderBy: { createdAt: "desc" }, include: { actor: { select: { id: true, firstName: true, lastName: true } } } });
  return NextResponse.json(notes);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, caseNoteSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canComment);
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await addNote(id, parsed.data.body, session.user), { status: 201 });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
