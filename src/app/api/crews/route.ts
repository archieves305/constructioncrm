import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  trades: z.array(z.string().min(1).max(80)).default([]),
  counties: z.array(z.string().min(1).max(80)).default([]),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search")?.trim() || "";
  const trades = searchParams.getAll("trade").filter(Boolean);
  const counties = searchParams.getAll("county").filter(Boolean);
  const activeOnly = searchParams.get("activeOnly") === "true";

  const where: Record<string, unknown> = {};
  if (activeOnly) where.isActive = true;
  if (search) where.name = { contains: search, mode: "insensitive" };
  if (trades.length > 0) where.trades = { hasSome: trades };
  if (counties.length > 0) where.counties = { hasSome: counties };

  const crews = await prisma.crew.findMany({
    where,
    include: {
      assignments: {
        where: {
          job: { currentStage: { isClosed: false } },
        },
        include: {
          job: { select: { id: true, jobNumber: true, title: true, scheduledDate: true } },
        },
        orderBy: { installDate: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(crews);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const { email, phone, ...rest } = parsed.data;
  const crew = await prisma.crew.create({
    data: {
      ...rest,
      phone: phone?.trim() || null,
      email: email?.trim() || null,
    },
  });

  return NextResponse.json(crew, { status: 201 });
}
