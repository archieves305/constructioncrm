import { prisma } from "@/lib/db/prisma";
import { getLaborSettings } from "@/lib/labor/settings";
import { addDays, fromDbDate, toDbDate, weekStartOf } from "@/lib/labor/dates";
import { recordAudit } from "@/lib/audit/record";

// Weekly payroll run: who should be paid for a payroll week, and marking a
// worker's week PAID. Paying is transactional — it creates the
// PayrollPayment, posts one LABOR JobExpense per job worked (split by the
// entries' cost snapshots), and stamps the covered entries. From then on
// those entries drop out of the accrued field-labor cost stream (the
// expenses carry the cost) and refuse hour changes until an admin undoes
// the payment.

export class PayrollRunError extends Error {}

export type PayrollJobSplit = {
  jobId: string;
  jobNumber: string;
  title: string;
  hours: number;
  amount: number;
};

export type PayrollWeekRow = {
  personnelId: string;
  name: string;
  entity: string | null;
  employmentType: string;
  regularHours: number;
  otHours: number;
  totalHours: number;
  gross: number;
  zeroRate: boolean;
  /** Work dates whose daily log is not yet APPROVED — payment is blocked. */
  unapprovedDates: string[];
  byJob: PayrollJobSplit[];
  payment: {
    id: string;
    paidAt: string;
    grossAmount: number;
    method: string | null;
    reference: string | null;
    paidBy: string;
  } | null;
};

export type PayrollWeek = {
  weekStart: string;
  weekEnd: string;
  rows: PayrollWeekRow[];
};

function weekEntriesWhere(personnelId: string | undefined, weekStart: string) {
  return {
    ...(personnelId ? { personnelId } : {}),
    isAbsent: false,
    workDate: {
      gte: toDbDate(weekStart),
      lt: toDbDate(addDays(weekStart, 7)),
    },
  };
}

const ENTRY_SELECT = {
  id: true,
  personnelId: true,
  jobId: true,
  workDate: true,
  regularHours: true,
  otHours: true,
  regularRate: true,
  totalCost: true,
  payrollPaymentId: true,
  dailyLog: { select: { status: true } },
  job: { select: { jobNumber: true, title: true } },
  personnel: {
    select: {
      firstName: true,
      lastName: true,
      employmentType: true,
      entityName: true,
      crew: { select: { name: true } },
    },
  },
} as const;

type WeekEntry = {
  id: string;
  personnelId: string;
  jobId: string;
  workDate: Date;
  regularHours: unknown;
  otHours: unknown;
  regularRate: unknown;
  totalCost: unknown;
  payrollPaymentId: string | null;
  dailyLog: { status: string };
  job: { jobNumber: string; title: string };
  personnel: {
    firstName: string;
    lastName: string;
    employmentType: string;
    entityName: string | null;
    crew: { name: string } | null;
  };
};

function splitByJob(entries: WeekEntry[]): PayrollJobSplit[] {
  const byJob = new Map<string, PayrollJobSplit>();
  for (const e of entries) {
    const split = byJob.get(e.jobId) ?? {
      jobId: e.jobId,
      jobNumber: e.job.jobNumber,
      title: e.job.title,
      hours: 0,
      amount: 0,
    };
    split.hours += Number(e.regularHours) + Number(e.otHours);
    split.amount += Number(e.totalCost);
    byJob.set(e.jobId, split);
  }
  return [...byJob.values()]
    .map((s) => ({ ...s, hours: round2(s.hours), amount: round2(s.amount) }))
    .sort((a, b) => a.jobNumber.localeCompare(b.jobNumber));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Everyone with hours in the payroll week containing `weekStartInput`. */
export async function getPayrollWeek(weekStartInput: string): Promise<PayrollWeek> {
  const settings = await getLaborSettings();
  const weekStart = weekStartOf(weekStartInput, settings.weekStartsOn);

  const [entries, payments] = await Promise.all([
    prisma.dailyLaborEntry.findMany({
      where: weekEntriesWhere(undefined, weekStart),
      select: ENTRY_SELECT,
      orderBy: { workDate: "asc" },
    }),
    prisma.payrollPayment.findMany({
      where: { weekStart: toDbDate(weekStart) },
      include: { paidBy: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const paymentByPersonnel = new Map(payments.map((p) => [p.personnelId, p]));

  const byWorker = new Map<string, WeekEntry[]>();
  for (const e of entries as WeekEntry[]) {
    const list = byWorker.get(e.personnelId) ?? [];
    list.push(e);
    byWorker.set(e.personnelId, list);
  }

  const rows: PayrollWeekRow[] = [...byWorker.entries()].map(([personnelId, list]) => {
    const p = list[0].personnel;
    const payment = paymentByPersonnel.get(personnelId) ?? null;
    return {
      personnelId,
      name: `${p.lastName}, ${p.firstName}`,
      entity: p.crew?.name ?? p.entityName,
      employmentType: p.employmentType,
      regularHours: round2(list.reduce((s, e) => s + Number(e.regularHours), 0)),
      otHours: round2(list.reduce((s, e) => s + Number(e.otHours), 0)),
      totalHours: round2(
        list.reduce((s, e) => s + Number(e.regularHours) + Number(e.otHours), 0),
      ),
      gross: round2(list.reduce((s, e) => s + Number(e.totalCost), 0)),
      zeroRate: list.some((e) => Number(e.regularRate) === 0),
      unapprovedDates: [
        ...new Set(
          list
            .filter((e) => e.dailyLog.status !== "APPROVED")
            .map((e) => fromDbDate(e.workDate)),
        ),
      ].sort(),
      byJob: splitByJob(list),
      payment: payment
        ? {
            id: payment.id,
            paidAt: payment.paidAt.toISOString(),
            grossAmount: Number(payment.grossAmount),
            method: payment.method,
            reference: payment.reference,
            paidBy: `${payment.paidBy.firstName} ${payment.paidBy.lastName}`,
          }
        : null,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));

  return { weekStart, weekEnd: addDays(weekStart, 6), rows };
}

export type MarkPaidInput = {
  weekStart: string;
  personnelId: string;
  method?: string | null;
  reference?: string | null;
  userId: string;
};

/**
 * Mark one worker's payroll week PAID: creates the payment, posts a LABOR
 * expense on every job worked, and stamps the entries. Requires every day
 * of the week to be APPROVED — draft/submitted hours can still change and
 * must never be paid out.
 */
export async function markWeekPaid(input: MarkPaidInput) {
  const settings = await getLaborSettings();
  const weekStart = weekStartOf(input.weekStart, settings.weekStartsOn);

  const result = await prisma.$transaction(async (tx) => {
    const entries = (await tx.dailyLaborEntry.findMany({
      where: weekEntriesWhere(input.personnelId, weekStart),
      select: ENTRY_SELECT,
    })) as WeekEntry[];

    if (entries.length === 0) {
      throw new PayrollRunError("No hours found for this worker in that week");
    }
    if (entries.some((e) => e.payrollPaymentId)) {
      throw new PayrollRunError("This week was already marked paid");
    }
    const unapproved = [
      ...new Set(
        entries
          .filter((e) => e.dailyLog.status !== "APPROVED")
          .map((e) => fromDbDate(e.workDate)),
      ),
    ].sort();
    if (unapproved.length > 0) {
      throw new PayrollRunError(
        `Approve these days first — hours can still change until approved: ${unapproved.join(", ")}`,
      );
    }

    const p = entries[0].personnel;
    const workerName = `${p.firstName} ${p.lastName}`;
    const regularHours = round2(entries.reduce((s, e) => s + Number(e.regularHours), 0));
    const otHours = round2(entries.reduce((s, e) => s + Number(e.otHours), 0));
    const gross = round2(entries.reduce((s, e) => s + Number(e.totalCost), 0));
    const byJob = splitByJob(entries);

    const payment = await tx.payrollPayment.create({
      data: {
        personnelId: input.personnelId,
        weekStart: toDbDate(weekStart),
        regularHours,
        otHours,
        grossAmount: gross,
        method: (input.method as never) ?? null,
        reference: input.reference ?? null,
        paidByUserId: input.userId,
      },
    });

    for (const split of byJob) {
      await tx.jobExpense.create({
        data: {
          jobId: split.jobId,
          type: "LABOR",
          vendor: workerName,
          description: `Payroll — ${workerName} — week of ${weekStart} (${split.hours}h)`,
          amount: split.amount,
          paidMethod: (input.method as never) ?? null,
          billable: false,
          createdByUserId: input.userId,
          payrollPaymentId: payment.id,
        },
      });
    }

    await tx.dailyLaborEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) } },
      data: { payrollPaymentId: payment.id },
    });

    return { payment, byJob, workerName, gross };
  });

  await recordAudit({
    actorUserId: input.userId,
    entityType: "PayrollPayment",
    entityId: result.payment.id,
    action: "payroll_paid",
    after: {
      personnelId: input.personnelId,
      worker: result.workerName,
      weekStart,
      gross: result.gross,
      jobs: result.byJob.map((j) => ({ jobNumber: j.jobNumber, amount: j.amount })),
    },
  });

  return result;
}

/**
 * Admin undo: deletes the payment — posted expenses cascade away and the
 * covered entries are released (FK set null) back into the accrued stream.
 */
export async function unmarkWeekPaid(input: {
  weekStart: string;
  personnelId: string;
  userId: string;
}) {
  const settings = await getLaborSettings();
  const weekStart = weekStartOf(input.weekStart, settings.weekStartsOn);

  const payment = await prisma.payrollPayment.findUnique({
    where: {
      personnelId_weekStart: {
        personnelId: input.personnelId,
        weekStart: toDbDate(weekStart),
      },
    },
    include: { personnel: { select: { firstName: true, lastName: true } } },
  });
  if (!payment) throw new PayrollRunError("No payment found for that week");

  await prisma.payrollPayment.delete({ where: { id: payment.id } });

  await recordAudit({
    actorUserId: input.userId,
    entityType: "PayrollPayment",
    entityId: payment.id,
    action: "payroll_unpaid",
    before: {
      personnelId: input.personnelId,
      worker: `${payment.personnel.firstName} ${payment.personnel.lastName}`,
      weekStart,
      gross: Number(payment.grossAmount),
    },
  });
}
