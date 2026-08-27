import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import {
  recomputeCostPlusJob,
  recomputeJobBalance,
  rollsExpensesIntoContract,
} from "@/lib/services/job-pricing";
import {
  canManageProgressBilling,
  defaultRetainagePercent,
  seedSovIfEmpty,
} from "@/lib/services/progress-billing";

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
    "isRentalTurnover",
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
    select: {
      jobType: true,
      depositReceived: true,
      billingMethod: true,
      lead: { select: { propertyType: true } },
    },
  });
  if (!existing) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Billing method + retainage: financial settings, so an explicit role list
  // rather than hasMinRole (SALES_REP outranks Accounting in the hierarchy).
  if (body.billingMethod !== undefined || body.retainagePercent !== undefined) {
    if (!canManageProgressBilling(session.user.role)) return forbidden();
    if (body.billingMethod !== undefined) {
      if (body.billingMethod !== "LUMP_SUM" && body.billingMethod !== "PROGRESS")
        return badRequest("billingMethod must be LUMP_SUM or PROGRESS");
      updateData.billingMethod = body.billingMethod;
    }
    if (body.retainagePercent !== undefined) {
      const pct = Number(body.retainagePercent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100)
        return badRequest("retainagePercent must be between 0 and 100");
      updateData.retainagePercent = pct;
    } else if (
      body.billingMethod === "PROGRESS" &&
      existing.billingMethod !== "PROGRESS"
    ) {
      // First switch to progress billing: 10% commercial, 0% residential.
      updateData.retainagePercent = defaultRetainagePercent(existing.lead.propertyType);
    }
  }

  const nextType =
    (body.jobType as "FIXED_PRICE" | "COST_PLUS" | "OWNED_REHAB" | undefined) ??
    existing.jobType;
  const isRollup = rollsExpensesIntoContract(nextType);

  if (isRollup) {
    // Contract is computed from labor + expenses; never set directly.
    delete updateData.contractAmount;
  }

  await prisma.job.update({ where: { id }, data: updateData });

  // A progress job bills against its schedule of values; start it with one
  // line for the whole contract.
  if (updateData.billingMethod === "PROGRESS") await seedSovIfEmpty(id);

  // balanceDue is derived — recompute via the single writer after any
  // contract/type change (rollup also recomputes contractAmount first).
  if (isRollup) await recomputeCostPlusJob(id);
  else await recomputeJobBalance(id);

  const refreshed = await prisma.job.findUnique({
    where: { id },
    include: { currentStage: true },
  });
  return NextResponse.json(refreshed);
}
