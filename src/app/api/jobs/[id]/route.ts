import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

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
  ];

  const updateData: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if (field.endsWith("Date") && body[field]) {
        updateData[field] = new Date(body[field]);
      } else {
        updateData[field] = body[field];
      }
    }
  }

  // Recalculate balance if contract amount changed
  if (body.contractAmount !== undefined) {
    const job = await prisma.job.findUnique({ where: { id }, select: { depositReceived: true } });
    if (job) {
      updateData.balanceDue = Number(body.contractAmount) - Number(job.depositReceived);
    }
  }

  const job = await prisma.job.update({
    where: { id },
    data: updateData,
    include: { currentStage: true },
  });

  return NextResponse.json(job);
}
