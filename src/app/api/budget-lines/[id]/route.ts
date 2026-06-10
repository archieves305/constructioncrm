import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.string().max(120).nullable().optional(),
  amount: z.number().min(0).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const existing = await prisma.budgetLine.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.category !== undefined)
    data.category = parsed.data.category?.trim() || null;
  if (parsed.data.amount !== undefined) data.amount = parsed.data.amount;

  const line = await prisma.budgetLine.update({ where: { id }, data });
  return NextResponse.json(line);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const existing = await prisma.budgetLine.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Linked expenses/labor contracts have their budget_line_id set null (FK SetNull).
  await prisma.budgetLine.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
