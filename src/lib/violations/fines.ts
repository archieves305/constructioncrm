import { Prisma } from "@/generated/prisma/client";

/**
 * Fine arithmetic, pure.
 *
 * Two figures must never be confused: the SYSTEM ESTIMATE (computed here on
 * read from the fine terms, never stored) and the OFFICIAL balance (entered
 * from an agency statement, with its date). The UI always shows both,
 * labelled. The only thing that stops the estimate accruing is an official
 * stop date — never "the work is done".
 */

type Money = Prisma.Decimal | number | string | null | undefined;

const D = (v: Money): Prisma.Decimal => new Prisma.Decimal(v === null || v === undefined || v === "" ? 0 : v);

export type FineAccrualInput = {
  initialFine: Money;
  dailyFine: Money;
  accrualStartDate: Date | null;
  /** The OFFICIAL stop. Corrective-work completion never sets this. */
  accrualStoppedAt: Date | null;
  asOf: Date;
};

export type FineAccrualStatus = "NOT_CONFIGURED" | "NOT_STARTED" | "ACCRUING" | "STOPPED";

export type FineEstimate = {
  status: FineAccrualStatus;
  /** Calendar days counted; the start day is day 1. */
  days: number;
  initial: Prisma.Decimal;
  dailyFine: Prisma.Decimal;
  accrued: Prisma.Decimal;
  total: Prisma.Decimal;
  asOf: Date;
  stoppedAt: Date | null;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function calendarDaysInclusive(from: Date, to: Date): number {
  const a = startOfDay(from).getTime();
  const b = startOfDay(to).getTime();
  if (b < a) return 0;
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function estimateAccruedFine(i: FineAccrualInput): FineEstimate {
  const initial = D(i.initialFine).toDecimalPlaces(2);
  const daily = D(i.dailyFine).toDecimalPlaces(2);
  const base = { initial, dailyFine: daily, asOf: i.asOf, stoppedAt: i.accrualStoppedAt };
  if (daily.lte(0) || !i.accrualStartDate) {
    return { ...base, status: "NOT_CONFIGURED", days: 0, accrued: new Prisma.Decimal(0), total: initial };
  }
  if (startOfDay(i.accrualStartDate) > startOfDay(i.asOf)) {
    return { ...base, status: "NOT_STARTED", days: 0, accrued: new Prisma.Decimal(0), total: initial };
  }
  const end = i.accrualStoppedAt && i.accrualStoppedAt < i.asOf ? i.accrualStoppedAt : i.asOf;
  const days = calendarDaysInclusive(i.accrualStartDate, end);
  const accrued = daily.mul(days).toDecimalPlaces(2);
  return {
    ...base,
    status: i.accrualStoppedAt && i.accrualStoppedAt <= i.asOf ? "STOPPED" : "ACCRUING",
    days,
    accrued,
    total: initial.add(accrued).toDecimalPlaces(2),
  };
}

export type ExposureInput = {
  estimate: FineEstimate;
  adminCosts: Money;
  amountPaid: Money;
  mitigatedAmount: Money;
  override: { amount: Money; reason: string | null; at: Date | null } | null;
  officialBalance: { amount: Money; asOf: Date } | null;
};

export type Exposure = {
  /** Always shown, even when overridden. */
  systemEstimate: Prisma.Decimal;
  /** The override when one is set, else the system estimate. */
  effectiveEstimate: Prisma.Decimal;
  overrideApplied: boolean;
  /** max(0, effective + admin − paid − mitigated). Never includes the official balance. */
  exposure: Prisma.Decimal;
  officialBalance: { amount: Prisma.Decimal; asOf: Date } | null;
  /** official − effective, display only. */
  officialVsEstimateDelta: Prisma.Decimal | null;
};

export function computeExposure(i: ExposureInput): Exposure {
  const systemEstimate = i.estimate.total;
  const overrideApplied = i.override !== null && i.override.amount !== null && i.override.amount !== undefined;
  const effective = overrideApplied ? D(i.override!.amount).toDecimalPlaces(2) : systemEstimate;
  const raw = effective.add(D(i.adminCosts)).sub(D(i.amountPaid)).sub(D(i.mitigatedAmount)).toDecimalPlaces(2);
  const exposure = raw.lt(0) ? new Prisma.Decimal(0) : raw;
  const official = i.officialBalance ? { amount: D(i.officialBalance.amount).toDecimalPlaces(2), asOf: i.officialBalance.asOf } : null;
  return {
    systemEstimate,
    effectiveEstimate: effective,
    overrideApplied,
    exposure,
    officialBalance: official,
    officialVsEstimateDelta: official ? official.amount.sub(effective).toDecimalPlaces(2) : null,
  };
}

/** The override predates a change to the fine terms — flag it, never drop it silently. */
export function overrideIsStale(c: { fineEstimateOverrideAt: Date | null; fineTermsUpdatedAt: Date | null }): boolean {
  return Boolean(c.fineEstimateOverrideAt && c.fineTermsUpdatedAt && c.fineTermsUpdatedAt > c.fineEstimateOverrideAt);
}

export function formatOfficialBalanceLabel(asOf: Date): string {
  return `Official (agency) balance as of ${asOf.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

/** The case's own columns → both figures, for the read model. */
export function fineSummaryFor(
  c: {
    initialFine: Money;
    dailyFine: Money;
    fineAccrualStartDate: Date | null;
    fineAccrualStoppedAt: Date | null;
    adminCosts: Money;
    amountPaid: Money;
    mitigationGrantedAmount: Money;
    fineEstimateOverride: Money;
    fineEstimateOverrideReason: string | null;
    fineEstimateOverrideAt: Date | null;
    fineTermsUpdatedAt: Date | null;
    officialBalance: Money;
    officialBalanceAsOf: Date | null;
  },
  asOf: Date,
) {
  const estimate = estimateAccruedFine({
    initialFine: c.initialFine,
    dailyFine: c.dailyFine,
    accrualStartDate: c.fineAccrualStartDate,
    accrualStoppedAt: c.fineAccrualStoppedAt,
    asOf,
  });
  const exposure = computeExposure({
    estimate,
    adminCosts: c.adminCosts,
    amountPaid: c.amountPaid,
    mitigatedAmount: c.mitigationGrantedAmount,
    override: c.fineEstimateOverride !== null && c.fineEstimateOverride !== undefined ? { amount: c.fineEstimateOverride, reason: c.fineEstimateOverrideReason, at: c.fineEstimateOverrideAt } : null,
    officialBalance: c.officialBalance !== null && c.officialBalance !== undefined && c.officialBalanceAsOf ? { amount: c.officialBalance, asOf: c.officialBalanceAsOf } : null,
  });
  return {
    accrual: { status: estimate.status, days: estimate.days, dailyFine: estimate.dailyFine.toString(), initial: estimate.initial.toString(), accrued: estimate.accrued.toString(), stoppedAt: estimate.stoppedAt },
    systemEstimate: exposure.systemEstimate.toString(),
    effectiveEstimate: exposure.effectiveEstimate.toString(),
    overrideApplied: exposure.overrideApplied,
    overrideStale: overrideIsStale(c),
    exposure: exposure.exposure.toString(),
    officialBalance: exposure.officialBalance ? { amount: exposure.officialBalance.amount.toString(), asOf: exposure.officialBalance.asOf, label: formatOfficialBalanceLabel(exposure.officialBalance.asOf) } : null,
    officialVsEstimateDelta: exposure.officialVsEstimateDelta?.toString() ?? null,
    accruing: estimate.status === "ACCRUING",
  };
}

export type FineSummary = ReturnType<typeof fineSummaryFor>;
