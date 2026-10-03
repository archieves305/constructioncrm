import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import {
  canApproveJobCosts,
  canEnterJobCosts,
  getCostGrants,
  COST_DENIED_MESSAGE,
} from "@/lib/expenses/permissions";
import {
  recomputeCostPlusJob,
  recomputeJobBalance,
  rollsExpensesIntoContract,
} from "@/lib/services/job-pricing";
import { guardJob } from "@/lib/access/records";
import { fileExists } from "@/lib/files/storage";
import { resolveVendorId } from "@/lib/vendors/service";
import { autoCommitmentId } from "@/lib/vendors/commitment-service";

const TYPES = [
  "MATERIAL",
  "LABOR",
  "EQUIPMENT",
  "PERMIT_FEE",
  "SUBCONTRACTOR",
  "CHANGE_ORDER",
  "OTHER",
] as const;

const METHODS = [
  "CHECK",
  "CARD",
  "ACH",
  "CASH",
  "FINANCING",
  "WIRE",
  "OTHER",
] as const;

const createSchema = z.object({
  type: z.enum(TYPES).default("OTHER"),
  vendor: z.string().max(120).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  amount: z.number().min(0),
  incurredDate: z.string().optional(),
  paidMethod: z.enum(METHODS).nullable().optional(),
  paidFrom: z.string().max(120).nullable().optional(),
  billable: z.boolean().default(false),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const denied = await guardJob(session.user, id, "read");
  if (denied) return denied;
  const expenses = await prisma.jobExpense.findMany({
    where: { jobId: id },
    orderBy: { incurredDate: "desc" },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      vendorRecord: { select: { id: true, name: true } },
      commitment: { select: { id: true, number: true } },
      receipts: { orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, fileType: true, fileSize: true, storageKey: true } },
    },
  });
  // Each receipt says whether its file is still in the store; the storage key stays here.
  const withReceipts = await Promise.all(
    expenses.map(async (e) => ({
      ...e,
      receipts: await Promise.all(e.receipts.map(async ({ storageKey, ...r }) => ({ ...r, missing: !(await fileExists(storageKey)) }))),
    })),
  );
  return NextResponse.json(withReceipts);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  // A billable expense increments contractAmount and recomputes balanceDue —
  // this endpoint changes what a customer owes, so it is not open to every
  // logged-in user.
  const grants = await getCostGrants(session.user.id);
  if (!canEnterJobCosts(session.user.role, grants)) {
    return NextResponse.json({ error: COST_DENIED_MESSAGE }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const job = await prisma.job.findUnique({
    where: { id },
    select: { leadId: true, jobType: true },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const amount = parsed.data.amount;
  const isRollup = rollsExpensesIntoContract(job.jobType);
  // On rollup jobs (cost-plus / owned-rehab), billable is irrelevant — every
  // expense rolls into the contract via recompute.
  const billable = isRollup ? false : parsed.data.billable;

  // A charge entered by someone who already holds approval authority is
  // approved on entry — asking a bookkeeper to approve their own keystroke is
  // theatre. Everyone else's lands PENDING and moves no money until reviewed.
  const selfApproves = canApproveJobCosts(session.user.role);
  const status = selfApproves ? "APPROVED" : "PENDING";

  // Only an APPROVED charge may touch the ledger on creation.
  const affectsLedger = status === "APPROVED";

  // The payee text is kept as typed; a known vendor is linked beside it.
  const vendorId = await resolveVendorId(parsed.data.vendor);
  // One open commitment for that vendor on this job: the expense draws it down.
  const commitmentId = await autoCommitmentId(id, vendorId);

  const [expense] = await prisma.$transaction([
    prisma.jobExpense.create({
      data: {
        jobId: id,
        type: parsed.data.type,
        vendor: parsed.data.vendor?.trim() || null,
        vendorId,
        commitmentId,
        description: parsed.data.description?.trim() || null,
        amount,
        incurredDate: parsed.data.incurredDate
          ? new Date(parsed.data.incurredDate)
          : new Date(),
        paidMethod: parsed.data.paidMethod ?? null,
        paidFrom: parsed.data.paidFrom?.trim() || null,
        billable,
        createdByUserId: session.user.id,
        status,
        approvedByUserId: selfApproves ? session.user.id : null,
        approvedAt: selfApproves ? new Date() : null,
      },
      include: {
        createdBy: { select: { firstName: true, lastName: true } },
        vendorRecord: { select: { id: true, name: true } },
      commitment: { select: { id: true, number: true } },
      },
    }),
    ...(billable && affectsLedger
      ? [
          prisma.job.update({
            where: { id },
            data: { contractAmount: { increment: amount } },
          }),
        ]
      : []),
  ]);

  // balanceDue is derived — recompute via the single writer. A pending charge
  // is excluded from the rollup sum, so recomputing is harmless but pointless.
  if (isRollup && affectsLedger) await recomputeCostPlusJob(id);
  else if (billable && affectsLedger) await recomputeJobBalance(id);

  await prisma.activityLog.create({
    data: {
      leadId: job.leadId,
      activityType: "NOTE",
      title: `Expense ${status === "PENDING" ? "submitted" : "added"}: ${parsed.data.type.replace(/_/g, " ")} — $${amount.toLocaleString()}`,
      description: !affectsLedger
        ? `Awaiting approval — not counted against the job yet${parsed.data.vendor ? ` · ${parsed.data.vendor}` : ""}`
        : isRollup
        ? `Rolled into job total${parsed.data.vendor ? ` · ${parsed.data.vendor}` : ""}`
        : billable
          ? `Billable; added to contract${parsed.data.vendor ? ` · ${parsed.data.vendor}` : ""}`
          : parsed.data.vendor || undefined,
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(expense, { status: 201 });
}
