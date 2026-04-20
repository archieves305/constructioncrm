import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  channel: z.enum(["SMS", "EMAIL", "IN_APP"]).optional(),
  templateBody: z.string().min(1).max(10000).optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!["ADMIN", "MANAGER"].includes(session.user.role)) return forbidden();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const record = await prisma.messageTemplate
    .update({ where: { id }, data: parsed.data })
    .catch(() => null);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(record);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!["ADMIN", "MANAGER"].includes(session.user.role)) return forbidden();

  const { id } = await context.params;

  const inUse = await prisma.followUpRule.count({ where: { messageTemplateId: id } });
  if (inUse > 0) {
    return badRequest("template is referenced by a follow-up rule — disable instead of delete");
  }

  await prisma.messageTemplate.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
