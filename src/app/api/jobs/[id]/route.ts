import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { recomputeCostPlusJob } from "@/lib/services/job-pricing";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;

  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      currentStage: true,
      lead: {
        select: {
          id: true, fullName: true, primaryPhone: true, email: true,
          propertyAddress1: true, propertyAddress2: true, city: true, county: true, state: true, zipCode: true,
          source: { select: { name: true } },
          services: { include: { serviceCategory: true } },
        },
      },
      salesRep: { select: { id: true, firstName: true, lastName: true } },
      projectManager: { select: { id: true, firstName: true, lastName: true } },
      stageHistory: {
        include: {
          fromStage: true,
          toStage: true,
          changedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { changedAt: "desc" },
      },
      payments: { orderBy: { createdAt: "desc" } },
      permits: {
        include: { assignedTo: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      },
      crewAssignments: {
        include: { crew: true },
        orderBy: { assignedDate: "desc" },
      },
      inspections: {
        include: { inspector: { select: { firstName: true, lastName: true } } },
        orderBy: { scheduledDate: "desc" },
      },
      tasks: {
        include: { assignedTo: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json(job);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();

  const allowedFields = [
    "title", "contractAmount", "depositRequired", "financingRequired",
    "financingProvider", "financingStatus", "financingApprovedDate",
    "projectManagerId", "salesRepId", "nextAction",
    "targetStartDate", "scheduledDate",
    "jobType", "laborCost", "marginType", "marginValue",
    "isRentalTurnover", "buildiumPropertyId", "buildiumUnitId",
    "priorTenantName", "turnoverStartedAt", "turnoverCompletedAt",
  ];

  const updateData: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if ((field.endsWith("Date") || field.endsWith("At")) && body[field]) {
        updateData[field] = new Date(body[field]);
      } else {
        updateData[field] = body[field];
      }
    }
  }

  const existing = await prisma.job.findUnique({
    where: { id },
    select: { jobType: true, depositReceived: true },
  });
  if (!existing) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const nextType = (body.jobType as "FIXED_PRICE" | "COST_PLUS" | undefined) ?? existing.jobType;

  if (nextType === "FIXED_PRICE" && body.contractAmount !== undefined) {
    updateData.balanceDue = Number(body.contractAmount) - Number(existing.depositReceived);
  }

  if (nextType === "COST_PLUS") {
    delete updateData.contractAmount;
  }

  const job = await prisma.job.update({
    where: { id },
    data: updateData,
    include: { currentStage: true },
  });

  if (nextType === "COST_PLUS") {
    await recomputeCostPlusJob(id);
    const refreshed = await prisma.job.findUnique({
      where: { id },
      include: { currentStage: true },
    });
    return NextResponse.json(refreshed);
  }

  return NextResponse.json(job);
}
