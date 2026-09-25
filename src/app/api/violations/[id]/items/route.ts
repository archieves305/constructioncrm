import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { itemCreateSchema } from "@/lib/validators/violation";
import { addItem } from "@/lib/violations/items";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const gate = await requireCase(id, session.user);
  if ("response" in gate) return gate.response;
  const rows = await prisma.codeViolationItem.findMany({ where: { caseId: id }, orderBy: { itemNumber: "asc" }, include: { category: { select: { id: true, key: true, name: true } }, assignedTo: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { tasks: true, files: true } } } });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, itemCreateSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canEdit);
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await addItem(id, parsed.data, session.user), { status: 201 });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
