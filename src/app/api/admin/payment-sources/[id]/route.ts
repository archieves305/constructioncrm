import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
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

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const record = await prisma.paymentSource
    .update({ where: { id }, data })
    .catch(() => null);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(record);
}
