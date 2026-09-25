import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { caseCommunicationSchema } from "@/lib/validators/violation";
import { logCaseCommunication } from "@/lib/violations/communications";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const gate = await requireCase(id, session.user);
  if ("response" in gate) return gate.response;
  const rows = await prisma.communication.findMany({ where: { violationCaseId: id }, orderBy: { createdAt: "desc" }, include: { createdBy: { select: { id: true, firstName: true, lastName: true } } } });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, caseCommunicationSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canEdit);
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await logCaseCommunication(id, parsed.data, session.user), { status: 201 });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
