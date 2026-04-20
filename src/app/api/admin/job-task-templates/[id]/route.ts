import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";

const updateSchema = z.object({
  stageId: z.string().optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  relativeDueInDays: z.number().int().min(0).max(365).nullable().optional(),
  defaultAssignedUserId: z.string().nullable().optional(),
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
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const data: Record<string, unknown> = {};
  if (parsed.data.stageId !== undefined) data.stageId = parsed.data.stageId;
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.description !== undefined)
    data.description = parsed.data.description || null;
  if (parsed.data.priority !== undefined) data.priority = parsed.data.priority;
  if (parsed.data.relativeDueInDays !== undefined)
    data.relativeDueInDays = parsed.data.relativeDueInDays ?? null;
  if (parsed.data.defaultAssignedUserId !== undefined)
    data.defaultAssignedUserId = parsed.data.defaultAssignedUserId || null;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const record = await prisma.jobTaskTemplate
    .update({ where: { id }, data })
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
  await prisma.jobTaskTemplate.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
