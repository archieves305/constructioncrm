import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { createProspectSchema } from "@/lib/validators/prospect";
import { Prisma } from "@/generated/prisma/client";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";

// Shape returned for prospect lists/cards: core fields + knock count + latest
// knock outcome, so the canvassing UI can render status at a glance.
const prospectListInclude = {
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { knocks: { where: { isDeleted: false } } } },
  knocks: {
    where: { isDeleted: false },
    orderBy: { knockedAt: "desc" as const },
    take: 1,
    select: { outcome: true, knockedAt: true },
  },
} satisfies Prisma.ProspectInclude;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const assignedTo = searchParams.get("assigned_to");
  const search = searchParams.get("search");
  const limit = searchParams.get("limit");
  const withTaskCounts = searchParams.get("withTaskCounts") === "true";

  const where: Prisma.ProspectWhereInput = {};

  if (status) where.status = status as Prisma.ProspectWhereInput["status"];

  if (assignedTo === "me") where.assignedToUserId = session.user.id;
  else if (assignedTo) where.assignedToUserId = assignedTo;

  // Sales reps only see prospects assigned to them.
  if (session.user.role === "SALES_REP") where.assignedToUserId = session.user.id;

  if (search) {
    where.OR = [
      { propertyAddress1: { contains: search, mode: "insensitive" } },
      { ownerName: { contains: search, mode: "insensitive" } },
      { city: { contains: search, mode: "insensitive" } },
    ];
  }

  const prospects = await prisma.prospect.findMany({
    where,
    include: prospectListInclude,
    orderBy: { createdAt: "desc" },
    take: limit ? parseInt(limit) : undefined,
  });

  if (!withTaskCounts || prospects.length === 0) return NextResponse.json(prospects);

  // Same shape the jobs and leads lists return, so one badge component serves
  // all three.
  const ids = prospects.map((p) => p.id);
  const now = new Date();
  const [open, overdue] = await Promise.all([
    prisma.task.groupBy({
      by: ["prospectId"],
      where: { prospectId: { in: ids }, ...ACTIVE_OPEN_WHERE },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["prospectId"],
      where: { prospectId: { in: ids }, ...ACTIVE_OPEN_WHERE, dueAt: { lt: now } },
      _count: { _all: true },
    }),
  ]);
  const counts: Record<string, { pending: number; overdue: number }> = {};
  for (const g of open) if (g.prospectId) counts[g.prospectId] = { pending: g._count._all, overdue: 0 };
  for (const g of overdue) {
    if (!g.prospectId) continue;
    counts[g.prospectId] ??= { pending: 0, overdue: 0 };
    counts[g.prospectId].overdue = g._count._all;
  }

  return NextResponse.json(
    prospects.map((p) => ({ ...p, taskCounts: counts[p.id] ?? { pending: 0, overdue: 0 } })),
  );
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const body = await request.json();
  const parsed = createProspectSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }
  const input = parsed.data;

  // Don't create a second prospect for a property we've already saved.
  if (input.reapiId) {
    const existing = await prisma.prospect.findFirst({
      where: { reapiId: input.reapiId },
      include: prospectListInclude,
    });
    if (existing) return NextResponse.json(existing, { status: 200 });
  }

  const prospect = await prisma.prospect.create({
    data: {
      reapiId: input.reapiId,
      ownerName: input.ownerName,
      propertyAddress1: input.propertyAddress1,
      propertyAddress2: input.propertyAddress2,
      city: input.city,
      state: input.state,
      zipCode: input.zipCode,
      county: input.county,
      latitude: input.latitude,
      longitude: input.longitude,
      notes: input.notes,
      createdByUserId: session.user.id,
      assignedToUserId: input.assignedToUserId ?? session.user.id,
    },
    include: prospectListInclude,
  });

  return NextResponse.json(prospect, { status: 201 });
}
