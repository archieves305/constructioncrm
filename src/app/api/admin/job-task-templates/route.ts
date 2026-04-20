import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";

const createSchema = z.object({
  stageId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  relativeDueInDays: z.number().int().min(0).max(365).nullable().optional(),
  defaultAssignedUserId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const templates = await prisma.jobTaskTemplate.findMany({
    include: {
      stage: { select: { id: true, name: true, stageOrder: true } },
      defaultAssignee: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ stage: { stageOrder: "asc" } }, { title: "asc" }],
  });
  return NextResponse.json(templates);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!["ADMIN", "MANAGER"].includes(session.user.role)) return forbidden();

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const record = await prisma.jobTaskTemplate.create({
    data: {
      stageId: parsed.data.stageId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      relativeDueInDays: parsed.data.relativeDueInDays ?? null,
      defaultAssignedUserId: parsed.data.defaultAssignedUserId || null,
      isActive: parsed.data.isActive ?? true,
    },
  });
  return NextResponse.json(record, { status: 201 });
}
