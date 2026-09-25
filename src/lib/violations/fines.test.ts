import { describe, expect, it } from "vitest";
import { computeExposure, estimateAccruedFine, fineSummaryFor, overrideIsStale } from "./fines";

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 10);

describe("estimateAccruedFine", () => {
  it("counts calendar days with the start day as day 1 and rounds to cents", () => {
    const e = estimateAccruedFine({ initialFine: 100, dailyFine: 250, accrualStartDate: d(2026, 9, 15), accrualStoppedAt: null, asOf: d(2026, 9, 25) });
    expect(e.status).toBe("ACCRUING");
    expect(e.days).toBe(11);
    expect(e.accrued.toString()).toBe("2750");
    expect(e.total.toString()).toBe("2850");
  });

  it("no daily fine or no start → nothing accrues, the initial fine still counts", () => {
    expect(estimateAccruedFine({ initialFine: 500, dailyFine: 0, accrualStartDate: d(2026, 9, 1), accrualStoppedAt: null, asOf: d(2026, 9, 25) })).toMatchObject({ status: "NOT_CONFIGURED", days: 0 });
    expect(estimateAccruedFine({ initialFine: 500, dailyFine: 10, accrualStartDate: null, accrualStoppedAt: null, asOf: d(2026, 9, 25) }).total.toString()).toBe("500");
  });

  it("a start in the future has not started; a stop before the start is zero; a stop caps the count", () => {
    expect(estimateAccruedFine({ initialFine: 0, dailyFine: 10, accrualStartDate: d(2026, 10, 1), accrualStoppedAt: null, asOf: d(2026, 9, 25) }).status).toBe("NOT_STARTED");
    const early = estimateAccruedFine({ initialFine: 0, dailyFine: 10, accrualStartDate: d(2026, 9, 10), accrualStoppedAt: d(2026, 9, 5), asOf: d(2026, 9, 25) });
    expect(early).toMatchObject({ status: "STOPPED", days: 0 });
    const capped = estimateAccruedFine({ initialFine: 0, dailyFine: 10, accrualStartDate: d(2026, 9, 10), accrualStoppedAt: d(2026, 9, 12), asOf: d(2026, 9, 25) });
    expect(capped).toMatchObject({ status: "STOPPED", days: 3 });
    expect(capped.accrued.toString()).toBe("30");
  });

  it("only the official stop date stops the estimate", () => {
    const e = estimateAccruedFine({ initialFine: 0, dailyFine: 10, accrualStartDate: d(2026, 9, 10), accrualStoppedAt: null, asOf: d(2026, 9, 25) });
    expect(e.status).toBe("ACCRUING");
  });

  it("decimal rates round to cents", () => {
    const e = estimateAccruedFine({ initialFine: "0", dailyFine: "33.333", accrualStartDate: d(2026, 9, 1), accrualStoppedAt: null, asOf: d(2026, 9, 3) });
    expect(e.dailyFine.toString()).toBe("33.33");
    expect(e.accrued.toString()).toBe("99.99");
  });
});

describe("computeExposure", () => {
  const estimate = estimateAccruedFine({ initialFine: 100, dailyFine: 100, accrualStartDate: d(2026, 9, 1), accrualStoppedAt: null, asOf: d(2026, 9, 10) }); // 100 + 1000

  it("exposure = effective + admin − paid − mitigated, floored at zero, official never merged", () => {
    const x = computeExposure({ estimate, adminCosts: 50, amountPaid: 200, mitigatedAmount: 100, override: null, officialBalance: { amount: 1500, asOf: d(2026, 9, 9) } });
    expect(x.systemEstimate.toString()).toBe("1100");
    expect(x.effectiveEstimate.toString()).toBe("1100");
    expect(x.exposure.toString()).toBe("850");
    expect(x.officialBalance?.amount.toString()).toBe("1500");
    expect(x.officialVsEstimateDelta?.toString()).toBe("400");
    expect(computeExposure({ estimate, adminCosts: 0, amountPaid: 5000, mitigatedAmount: 0, override: null, officialBalance: null }).exposure.toString()).toBe("0");
  });

  it("an override replaces the estimate but the system figure is still reported", () => {
    const x = computeExposure({ estimate, adminCosts: 0, amountPaid: 0, mitigatedAmount: 0, override: { amount: 400, reason: "agency waived weekends", at: d(2026, 9, 9) }, officialBalance: null });
    expect(x.overrideApplied).toBe(true);
    expect(x.effectiveEstimate.toString()).toBe("400");
    expect(x.systemEstimate.toString()).toBe("1100");
    expect(x.exposure.toString()).toBe("400");
  });

  it("flags an override whose fine terms changed afterwards", () => {
    expect(overrideIsStale({ fineEstimateOverrideAt: d(2026, 9, 1), fineTermsUpdatedAt: d(2026, 9, 2) })).toBe(true);
    expect(overrideIsStale({ fineEstimateOverrideAt: d(2026, 9, 2), fineTermsUpdatedAt: d(2026, 9, 1) })).toBe(false);
    expect(overrideIsStale({ fineEstimateOverrideAt: null, fineTermsUpdatedAt: d(2026, 9, 1) })).toBe(false);
  });

  it("fineSummaryFor labels the official balance with its date and reports accruing", () => {
    const s = fineSummaryFor(
      {
        initialFine: 100, dailyFine: 100, fineAccrualStartDate: d(2026, 9, 1), fineAccrualStoppedAt: null, adminCosts: 0, amountPaid: 0, mitigationGrantedAmount: null,
        fineEstimateOverride: null, fineEstimateOverrideReason: null, fineEstimateOverrideAt: null, fineTermsUpdatedAt: null, officialBalance: 900, officialBalanceAsOf: d(2026, 9, 8),
      },
      d(2026, 9, 10),
    );
    expect(s.accruing).toBe(true);
    expect(s.systemEstimate).toBe("1100");
    expect(s.officialBalance?.label).toMatch(/^Official \(agency\) balance as of Sep 8, 2026$/);
  });
});
