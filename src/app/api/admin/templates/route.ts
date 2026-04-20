import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";

const CHANNELS = ["SMS", "EMAIL", "IN_APP"] as const;

const createSchema = z.object({
  name: z.string().min(1).max(120),
  channel: z.enum(CHANNELS),
  templateBody: z.string().min(1).max(10000),
  isActive: z.boolean().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const templates = await prisma.messageTemplate.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(templates);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!["ADMIN", "MANAGER"].includes(session.user.role)) return forbidden();

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const record = await prisma.messageTemplate.create({ data: parsed.data });
  return NextResponse.json(record, { status: 201 });
}
