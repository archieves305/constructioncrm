import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { LEAD_EVENTS } from "@/lib/follow-ups/events";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  triggerEvent: z.enum(LEAD_EVENTS).optional(),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 365).optional(),
  messageTemplateId: z.string().nullable().optional(),
  taskTemplateJson: z
    .object({
      title: z.string(),
      description: z.string().optional(),
      dueInDays: z.number().int().min(0).max(365).optional(),
      priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
    })
    .nullable()
    .optional(),
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

  const { taskTemplateJson, messageTemplateId, ...rest } = parsed.data;
  const record = await prisma.followUpRule
    .update({
      where: { id },
      data: {
        ...rest,
        ...(messageTemplateId !== undefined
          ? { messageTemplateId: messageTemplateId || null }
          : {}),
        ...(taskTemplateJson !== undefined
          ? { taskTemplateJson: taskTemplateJson ?? undefined }
          : {}),
      },
    })
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
  await prisma.followUpRule.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
