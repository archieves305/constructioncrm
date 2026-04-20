import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { LEAD_EVENTS } from "@/lib/follow-ups/events";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  triggerEvent: z.enum(LEAD_EVENTS),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 365),
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

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const rules = await prisma.followUpRule.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { messageTemplate: { select: { id: true, name: true, channel: true } } },
  });
  return NextResponse.json(rules);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!["ADMIN", "MANAGER"].includes(session.user.role)) return forbidden();

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const { messageTemplateId, taskTemplateJson, ...rest } = parsed.data;
  const record = await prisma.followUpRule.create({
    data: {
      ...rest,
      messageTemplateId: messageTemplateId || null,
      taskTemplateJson: taskTemplateJson ?? undefined,
    },
  });
  return NextResponse.json(record, { status: 201 });
}
