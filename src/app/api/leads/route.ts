import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/helpers";
import { unauthorized, badRequest } from "@/lib/auth/helpers";
import { createLeadSchema } from "@/lib/validators/lead";
import { Prisma } from "@/generated/prisma/client";
import { emitLeadEvent } from "@/lib/follow-ups/events";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "25");
  const search = searchParams.get("search") || undefined;
  const stageId = searchParams.get("stageId") || undefined;
  const sourceId = searchParams.get("sourceId") || undefined;
  const assignedUserId = searchParams.get("assignedUserId") || undefined;
  const serviceCategoryId = searchParams.get("serviceCategoryId") || undefined;
  const city = searchParams.get("city") || undefined;
  const county = searchParams.get("county") || undefined;
  const dateFrom = searchParams.get("dateFrom") || undefined;
  const dateTo = searchParams.get("dateTo") || undefined;
  const includeClosed = searchParams.get("includeClosed") === "true";
  const withTaskCounts = searchParams.get("withTaskCounts") === "true";

  const where: Prisma.LeadWhereInput = {};

  if (!includeClosed && !stageId) {
    where.currentStage = { isClosed: false };
  }

  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { primaryPhone: { contains: search } },
      { email: { contains: search, mode: "insensitive" } },
      { propertyAddress1: { contains: search, mode: "insensitive" } },
      { companyName: { contains: search, mode: "insensitive" } },
    ];
  }

  if (stageId) where.currentStageId = stageId;
  if (sourceId) where.sourceId = sourceId;
  if (assignedUserId) where.assignedUserId = assignedUserId;
  if (city) where.city = { contains: city, mode: "insensitive" };
  if (county) where.county = { contains: county, mode: "insensitive" };

  if (serviceCategoryId) {
    where.services = { some: { serviceCategoryId } };
  }

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  // Sales reps only see their own leads
  if (session.user.role === "SALES_REP") {
    where.assignedUserId = session.user.id;
  }

  const [data, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: {
        currentStage: true,
        source: true,
        assignedUser: { select: { id: true, firstName: true, lastName: true } },
        services: { include: { serviceCategory: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.lead.count({ where }),
  ]);

  let taskCountsByLead: Record<string, { pending: number; overdue: number }> = {};
  if (withTaskCounts && data.length > 0) {
    const leadIds = data.map((l) => l.id);
    const now = new Date();
    const [pendingTasks, overdueTasks] = await Promise.all([
      prisma.task.groupBy({
        by: ["leadId"],
        where: { leadId: { in: leadIds }, status: { in: ["PENDING", "IN_PROGRESS"] } },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["leadId"],
        where: {
          leadId: { in: leadIds },
          status: { in: ["PENDING", "IN_PROGRESS"] },
          dueAt: { lt: now },
        },
        _count: { _all: true },
      }),
    ]);
    taskCountsByLead = Object.fromEntries(
      pendingTasks.map((g) => [g.leadId, { pending: g._count._all, overdue: 0 }]),
    );
    for (const g of overdueTasks) {
      const id = g.leadId as string;
      if (!taskCountsByLead[id]) taskCountsByLead[id] = { pending: 0, overdue: 0 };
      taskCountsByLead[id].overdue = g._count._all;
    }
  }

  const enriched = withTaskCounts
    ? data.map((l) => ({
        ...l,
        taskCounts: taskCountsByLead[l.id] ?? { pending: 0, overdue: 0 },
      }))
    : data;

  return NextResponse.json({
    data: enriched,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const body = await request.json();
  const parsed = createLeadSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }

  const input = parsed.data;

  // Get default stage
  const defaultStage = await prisma.leadStage.findFirst({
    where: { name: "New Lead" },
  });
  if (!defaultStage) return badRequest("Default stage not configured");

  // Duplicate check
  const duplicates = await prisma.lead.findMany({
    where: {
      OR: [
        { primaryPhone: input.primaryPhone },
        ...(input.email ? [{ email: input.email }] : []),
        {
          propertyAddress1: { equals: input.propertyAddress1, mode: "insensitive" as const },
          city: { equals: input.city, mode: "insensitive" as const },
          zipCode: input.zipCode,
        },
      ],
    },
    select: { id: true, fullName: true, primaryPhone: true },
    take: 5,
  });

  const { serviceCategoryIds, ...leadData } = input;

  const lead = await prisma.lead.create({
    data: {
      ...leadData,
      fullName: `${input.firstName} ${input.lastName}`,
      email: input.email || null,
      currentStageId: defaultStage.id,
      createdByUserId: session.user.id,
      isDuplicateFlag: duplicates.length > 0,
      nextFollowUpAt: input.nextFollowUpAt
        ? new Date(input.nextFollowUpAt)
        : new Date(Date.now() + 24 * 60 * 60 * 1000), // default: 24h
      services: serviceCategoryIds?.length
        ? {
            create: serviceCategoryIds.map((id) => ({
              serviceCategoryId: id,
            })),
          }
        : undefined,
    },
    include: {
      currentStage: true,
      source: true,
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
      services: { include: { serviceCategory: true } },
    },
  });

  // Activity log
  await prisma.activityLog.create({
    data: {
      leadId: lead.id,
      activityType: "LEAD_CREATED",
      title: "Lead created",
      description: `Lead "${lead.fullName}" was created`,
      createdByUserId: session.user.id,
    },
  });

  // Stage history
  await prisma.leadStageHistory.create({
    data: {
      leadId: lead.id,
      toStageId: defaultStage.id,
      changedByUserId: session.user.id,
    },
  });

  await emitLeadEvent("LEAD_CREATED", lead.id).catch((e) =>
    console.error("emitLeadEvent LEAD_CREATED failed", e),
  );

  return NextResponse.json(
    { lead, duplicates: duplicates.length > 0 ? duplicates : undefined },
    { status: 201 }
  );
}
