import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rescheduleTargetStart } from "@/lib/workflows/reschedule";
import { reassignUnresolved } from "@/lib/workflows/roles";
import { parseDueAt } from "@/lib/tasks/dates";
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
import { canEditJobRecord, canManageJobMoney, JOB_MONEY_FIELDS, MONEY_DENIED_MESSAGE, touchesJobMoney } from "@/lib/money/access";
import { recordAudit } from "@/lib/audit/record";
import { settleJobGates } from "@/lib/workflows/gates";
import { guardJob } from "@/lib/access/records";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const denied = await guardJob(session.user, id, "read");
  if (denied) return denied;

  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      currentStage: true,
      lead: {
        select: {
          id: true, fullName: true, companyName: true, primaryPhone: true, secondaryPhone: true, email: true, propertyType: true,
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
  const denied = await guardJob(session.user, id, "write");
  if (denied) return denied;
  const body = await request.json();

  // The job record is the office's and the rep's to edit; its pricing fields
  // move what the customer owes, so they take the money roles.
  if (!canEditJobRecord(session.user.role)) return forbidden();
  if (touchesJobMoney(body) && !canManageJobMoney(session.user.role)) {
    return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });
  }

  const allowedFields = [
    "title", "contractAmount", "depositRequired", "financingRequired",
    "financingProvider", "financingStatus", "financingApprovedDate",
    "projectManagerId", "salesRepId", "nextAction",
    "targetStartDate", "scheduledDate",
    "jobType", "laborCost", "marginType", "marginValue",
    "isRentalTurnover",
    "priorTenantName", "turnoverStartedAt", "turnoverCompletedAt",
    "jurisdiction",
  ];

  const updateData: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if (field === "targetStartDate" && body[field]) {
        // A day, not an instant: a bare yyyy-MM-dd is pinned to noon UTC, as
        // the workflow apply route does, so it stays on its day in every zone.
        const start = parseDueAt(String(body[field]));
        if (Number.isNaN(start.getTime())) return badRequest("targetStartDate must be a date");
        updateData[field] = start;
      } else if ((field.endsWith("Date") || field.endsWith("At")) && body[field]) {
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
      contractAmount: true,
      depositRequired: true,
      laborCost: true,
      marginType: true,
      marginValue: true,
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

  // The workflow follows the job: a moved target start shifts the steps
  // anchored on it; a new PM picks up the unassigned PM steps.
  if (updateData.targetStartDate !== undefined) await rescheduleTargetStart(id, session.user.id);
  if (updateData.projectManagerId !== undefined || updateData.salesRepId !== undefined) {
    const wf = await prisma.jobWorkflowInstance.findUnique({ where: { jobId: id }, select: { id: true } });
    if (wf) {
      // The PM / sales-rep slots on the workflow team are the same fact as the
      // job's own fields (team-mirror.ts covers the other direction).
      const slots = [
        ["PROJECT_MANAGER", updateData.projectManagerId],
        ["SALES_REP", updateData.salesRepId],
      ] as const;
      for (const [role, userId] of slots) {
        if (userId === undefined) continue;
        if (typeof userId === "string" && userId) {
          await prisma.jobWorkflowTeamMember.upsert({
            where: { instanceId_role: { instanceId: wf.id, role } },
            create: { instanceId: wf.id, role, userId },
            update: { userId },
          });
        } else {
          await prisma.jobWorkflowTeamMember.deleteMany({ where: { instanceId: wf.id, role } });
        }
      }
      await reassignUnresolved(wf.id, session.user.id);
    }
  }
  // A PM or a start date now on the job may be a checklist line some step was waiting to have ticked.
  if (updateData.projectManagerId !== undefined || updateData.targetStartDate !== undefined) {
    await settleJobGates(id, session.user.id);
  }

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
  if (refreshed && touchesJobMoney(body)) {
    const pick = (j: Record<string, unknown>) => Object.fromEntries(JOB_MONEY_FIELDS.map((f) => [f, j[f] == null ? null : String(j[f])]));
    await recordAudit({ actorUserId: session.user.id, entityType: "Job", entityId: id, action: "pricing_update", before: pick(existing), after: pick(refreshed) });
  }
  return NextResponse.json(refreshed);
}
