import { prisma } from "@/lib/db/prisma";
import type { InvoiceStatus, RoleName } from "@/generated/prisma/client";
import { nextInvoiceNumber } from "@/lib/services/invoices";

/**
 * Progress billing — AIA G702/G703-style payment applications.
 *
 * A PROGRESS job carries a schedule of values (SovLine). Each application is
 * an Invoice with `applicationNumber` set and one InvoiceLine per SOV line
 * holding *this period's* work. Everything cumulative is derived by replaying
 * earlier applications in number order, so the maths here is the maths on the
 * form:
 *
 *   completed to date       = Σ work on all applications through this one
 *   retainage               = completed to date × rate
 *   earned less retainage   = completed to date − retainage
 *   previous certificates   = Σ amount of earlier (non-void) applications
 *   current payment due     = earned less retainage − previous certificates
 *   balance to finish       = contract sum − completed to date
 *
 * `Invoice.amount` stores the current payment due so A/R aging, payments and
 * `Job.balanceDue` keep working unchanged. Only the latest application may be
 * edited or voided — anything earlier is already baked into the ones after it.
 */

export const PROGRESS_BILLING_ROLES: RoleName[] = [
  "ADMIN",
  "MANAGER",
  "OFFICE_STAFF",
];

export function canManageProgressBilling(role: RoleName): boolean {
  return PROGRESS_BILLING_ROLES.includes(role);
}

/** Retainage the trade normally sees: 10% on commercial work, none on residential. */
export function defaultRetainagePercent(
  propertyType: "RESIDENTIAL" | "COMMERCIAL" | null | undefined,
): number {
  return propertyType === "COMMERCIAL" ? 10 : 0;
}

export {
  round2,
  computeApplication,
  type SovLineInput,
  type AppLineInput,
  type ComputedLine,
  type ComputedApplication,
} from "@/lib/billing/g702";
import {
  round2,
  computeApplication,
  type SovLineInput,
  type AppLineInput,
  type ComputedApplication,
} from "@/lib/billing/g702";

// ─── Read model ─────────────────────────────────────────────────────────────

export type ApplicationSummary = {
  id: string;
  invoiceNumber: string;
  applicationNumber: number;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  paidAt: string | null;
  notes: string | null;
  amount: number;
  paid: number;
  computed: ComputedApplication;
};

export type BillingSummary = {
  billingMethod: "LUMP_SUM" | "PROGRESS";
  retainagePercent: number;
  contractSum: number;
  sovLines: (SovLineInput & { sortOrder: number })[];
  sovTotal: number;
  sovMatchesContract: boolean;
  applications: ApplicationSummary[];
  /** Totals through the latest issued (SENT/PAID) application. */
  totals: {
    completedToDate: number;
    retainageHeld: number;
    billedToDate: number; // earned less retainage, i.e. Σ certificates
    collected: number;
    openReceivable: number;
    balanceToFinish: number;
  };
  hasDraft: boolean;
  nextApplicationNumber: number;
  nextPeriodFrom: string | null;
};

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

export async function getBillingSummary(
  jobId: string,
  tx = prisma,
): Promise<BillingSummary | null> {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: {
      contractAmount: true,
      billingMethod: true,
      retainagePercent: true,
      targetStartDate: true,
      createdAt: true,
    },
  });
  if (!job) return null;

  const [sovRows, invoices] = await Promise.all([
    tx.sovLine.findMany({
      where: { jobId },
      orderBy: [{ sortOrder: "asc" }, { itemNo: "asc" }],
    }),
    tx.invoice.findMany({
      where: { jobId, applicationNumber: { not: null } },
      orderBy: { applicationNumber: "asc" },
      include: {
        lines: { select: { sovLineId: true, workCompleted: true } },
        payments: { where: { status: "RECEIVED" }, select: { amount: true } },
      },
    }),
  ]);

  const sovLines = sovRows.map((s) => ({
    id: s.id,
    itemNo: s.itemNo,
    description: s.description,
    scheduledValue: Number(s.scheduledValue),
    sortOrder: s.sortOrder,
  }));
  const contractSum = Number(job.contractAmount);
  const sovTotal = round2(sovLines.reduce((s, l) => s + l.scheduledValue, 0));

  const previousByLine: Record<string, number> = {};
  let previousCertificates = 0;
  let issued: ComputedApplication | null = null;
  let collected = 0;
  let hasDraft = false;
  let maxNumber = 0;
  let lastPeriodTo: Date | null = null;

  const applications: ApplicationSummary[] = [];
  for (const inv of invoices) {
    const n = inv.applicationNumber as number;
    maxNumber = Math.max(maxNumber, n);
    const thisPeriod = inv.lines.map((l) => ({
      sovLineId: l.sovLineId,
      workCompleted: Number(l.workCompleted),
    }));
    const computed = computeApplication({
      contractSum,
      retainagePercent: Number(inv.retainagePercent ?? job.retainagePercent),
      sovLines,
      previousByLine,
      previousCertificates,
      thisPeriod,
    });
    const paid = round2(inv.payments.reduce((s, p) => s + Number(p.amount), 0));
    applications.push({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      applicationNumber: n,
      status: inv.status,
      issueDate: inv.issueDate.toISOString(),
      dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
      periodFrom: isoDate(inv.periodFrom),
      periodTo: isoDate(inv.periodTo),
      paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
      notes: inv.notes,
      amount: Number(inv.amount),
      paid,
      computed,
    });

    if (inv.status === "VOID") continue;
    if (inv.status === "DRAFT") {
      hasDraft = true;
      continue; // a draft is never rolled into the next application's "previous"
    }
    for (const l of thisPeriod) {
      previousByLine[l.sovLineId] = round2(
        (previousByLine[l.sovLineId] ?? 0) + l.workCompleted,
      );
    }
    previousCertificates = round2(previousCertificates + Number(inv.amount));
    collected = round2(collected + paid);
    issued = computed;
    if (inv.periodTo) lastPeriodTo = inv.periodTo;
  }

  const billedToDate = previousCertificates;
  const nextPeriodFrom =
    lastPeriodTo ?? job.targetStartDate ?? job.createdAt;

  return {
    billingMethod: job.billingMethod,
    retainagePercent: Number(job.retainagePercent),
    contractSum,
    sovLines,
    sovTotal,
    sovMatchesContract: Math.abs(sovTotal - contractSum) < 0.005,
    applications,
    totals: {
      completedToDate: issued?.completedToDate ?? 0,
      retainageHeld: issued?.retainage ?? 0,
      billedToDate,
      collected,
      openReceivable: round2(billedToDate - collected),
      balanceToFinish: round2(contractSum - (issued?.completedToDate ?? 0)),
    },
    hasDraft,
    nextApplicationNumber: maxNumber + 1,
    nextPeriodFrom: isoDate(lastPeriodTo ? addDays(nextPeriodFrom, 1) : nextPeriodFrom),
  };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export type ApplicationInput = {
  periodFrom?: string | null;
  periodTo: string;
  lines: AppLineInput[];
  dueDate?: string | null;
  notes?: string | null;
  status?: "DRAFT" | "SENT";
};

export type BillingFailure =
  | "not_found"
  | "not_progress"
  | "draft_exists"
  | "not_draft"
  | "not_latest"
  | "not_application"
  | "unknown_line"
  | "exceeds_scheduled_value"
  | "nothing_billed"
  | "negative_due";

export type ApplicationResult =
  | { ok: true; invoiceId: string; invoiceNumber: string; amount: number }
  | { ok: false; reason: BillingFailure; message: string };

type Failure = { ok: false; reason: BillingFailure; message: string };

function fail(reason: BillingFailure, message: string): Failure {
  return { ok: false, reason, message };
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Validate this period's lines against the schedule and what was billed
 * before. Returns the computed application or a failure.
 */
function validateLines(
  summary: BillingSummary,
  lines: AppLineInput[],
): { ok: true; computed: ComputedApplication } | Failure {
  const byId = new Map(summary.sovLines.map((s) => [s.id, s]));
  for (const l of lines) {
    if (!byId.has(l.sovLineId))
      return fail("unknown_line", "A line references an item not on this job's schedule of values");
  }
  const previousByLine: Record<string, number> = {};
  // Replay issued applications only — drafts never count as "previous".
  for (const app of summary.applications) {
    if (app.status === "VOID" || app.status === "DRAFT") continue;
    for (const l of app.computed.lines) {
      previousByLine[l.sovLineId] = round2((previousByLine[l.sovLineId] ?? 0) + l.thisPeriod);
    }
  }
  const computed = computeApplication({
    contractSum: summary.contractSum,
    retainagePercent: summary.retainagePercent,
    sovLines: summary.sovLines,
    previousByLine,
    previousCertificates: summary.totals.billedToDate,
    thisPeriod: lines,
  });
  if (computed.completedThisPeriod <= 0)
    return fail("nothing_billed", "Enter work completed this period on at least one line");
  const over = computed.lines.find((l) => l.toDate > l.scheduledValue + 0.005);
  if (over)
    return fail(
      "exceeds_scheduled_value",
      `"${over.description}" would exceed its scheduled value by $${round2(over.toDate - over.scheduledValue).toLocaleString()}`,
    );
  if (computed.currentDue < 0)
    return fail("negative_due", "Current payment due would be negative — check the retainage rate");
  return { ok: true, computed };
}

export async function createApplication(
  jobId: string,
  input: ApplicationInput,
  actorUserId: string,
): Promise<ApplicationResult> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, jobNumber: true, leadId: true, billingMethod: true },
  });
  if (!job) return fail("not_found", "Job not found");
  if (job.billingMethod !== "PROGRESS")
    return fail("not_progress", "This job is billed lump-sum; switch it to progress billing first");

  const summary = await getBillingSummary(jobId);
  if (!summary) return fail("not_found", "Job not found");
  if (summary.hasDraft)
    return fail("draft_exists", "Finish or void the draft application before starting another");

  const checked = validateLines(summary, input.lines);
  if (!checked.ok) return checked;
  const { computed } = checked;

  const periodTo = parseDate(input.periodTo);
  if (!periodTo) return fail("nothing_billed", "A period-to date is required");
  const periodFrom = parseDate(input.periodFrom) ?? parseDate(summary.nextPeriodFrom);
  const dueDate = parseDate(input.dueDate) ?? new Date(Date.now() + 30 * 86400000);

  const invoice = await prisma.$transaction(async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(
      job.jobNumber,
      jobId,
      tx as typeof prisma,
    );
    const created = await tx.invoice.create({
      data: {
        jobId,
        invoiceNumber,
        amount: computed.currentDue,
        status: input.status ?? "DRAFT",
        dueDate,
        notes: input.notes ?? null,
        applicationNumber: summary.nextApplicationNumber,
        periodFrom,
        periodTo,
        retainagePercent: summary.retainagePercent,
        lines: {
          create: computed.lines
            .filter((l) => l.thisPeriod > 0)
            .map((l) => ({ sovLineId: l.sovLineId, workCompleted: l.thisPeriod })),
        },
      },
      select: { id: true, invoiceNumber: true },
    });
    await tx.activityLog.create({
      data: {
        leadId: job.leadId,
        activityType: "NOTE",
        title: `Payment application #${summary.nextApplicationNumber} (${created.invoiceNumber}) created`,
        description: `$${computed.currentDue.toLocaleString()} due — $${computed.completedThisPeriod.toLocaleString()} work this period, ${summary.retainagePercent}% retainage`,
        createdByUserId: actorUserId,
      },
    });
    return created;
  });

  return {
    ok: true,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    amount: computed.currentDue,
  };
}

export type ApplicationUpdate = {
  periodFrom?: string | null;
  periodTo?: string;
  lines?: AppLineInput[];
};

/**
 * Edit a draft application. Only the latest application on the job may
 * change — an earlier one is already the "previous" of those after it.
 */
export async function updateApplication(
  invoiceId: string,
  input: ApplicationUpdate,
): Promise<ApplicationResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, jobId: true, invoiceNumber: true, status: true, applicationNumber: true, amount: true },
  });
  if (!invoice) return fail("not_found", "Invoice not found");
  if (invoice.applicationNumber == null)
    return fail("not_application", "Not a payment application");
  if (invoice.status !== "DRAFT")
    return fail("not_draft", "Only a draft application can be edited");

  const summary = await getBillingSummary(invoice.jobId);
  if (!summary) return fail("not_found", "Job not found");
  const later = summary.applications.some(
    (a) => a.status !== "VOID" && a.applicationNumber > (invoice.applicationNumber as number),
  );
  if (later) return fail("not_latest", "A later application exists; this one can no longer change");

  const data: Record<string, unknown> = {};
  if (input.periodFrom !== undefined) data.periodFrom = parseDate(input.periodFrom);
  if (input.periodTo !== undefined) {
    const d = parseDate(input.periodTo);
    if (!d) return fail("nothing_billed", "A period-to date is required");
    data.periodTo = d;
  }

  let amount = Number(invoice.amount);
  let lineRows: { sovLineId: string; workCompleted: number }[] | null = null;
  if (input.lines) {
    const checked = validateLines(summary, input.lines);
    if (!checked.ok) return checked;
    amount = checked.computed.currentDue;
    data.amount = amount;
    data.retainagePercent = summary.retainagePercent;
    lineRows = checked.computed.lines
      .filter((l) => l.thisPeriod > 0)
      .map((l) => ({ sovLineId: l.sovLineId, workCompleted: l.thisPeriod }));
  }

  await prisma.$transaction(async (tx) => {
    if (lineRows) {
      await tx.invoiceLine.deleteMany({ where: { invoiceId } });
      await tx.invoiceLine.createMany({
        data: lineRows.map((l) => ({ invoiceId, ...l })),
      });
    }
    if (Object.keys(data).length) {
      await tx.invoice.update({ where: { id: invoiceId }, data });
    }
  });

  return { ok: true, invoiceId, invoiceNumber: invoice.invoiceNumber, amount };
}

/**
 * Whether an application may be voided: only the latest non-void one, since
 * voiding an earlier application would silently shift every later one's
 * "previous certificates".
 */
export async function canVoidApplication(invoiceId: string): Promise<boolean> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { jobId: true, applicationNumber: true },
  });
  if (!invoice || invoice.applicationNumber == null) return true;
  const later = await prisma.invoice.count({
    where: {
      jobId: invoice.jobId,
      applicationNumber: { gt: invoice.applicationNumber },
      status: { not: "VOID" },
    },
  });
  return later === 0;
}

/**
 * A progress job needs at least one SOV line to bill against. Seeds a single
 * line for the whole contract when the job has none — the "one line per
 * contract" default; more can be added on the Invoices tab.
 */
export async function seedSovIfEmpty(jobId: string, tx = prisma): Promise<void> {
  const count = await tx.sovLine.count({ where: { jobId } });
  if (count > 0) return;
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: { title: true, contractAmount: true },
  });
  if (!job) return;
  await tx.sovLine.create({
    data: {
      jobId,
      itemNo: 1,
      description: job.title,
      scheduledValue: job.contractAmount,
      sortOrder: 0,
    },
  });
}
