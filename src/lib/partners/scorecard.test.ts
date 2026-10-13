import { describe, expect, it } from "vitest";
import { bidKpis, type BidRowForKpi } from "./scorecard";

const w = { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T23:59:59Z") };
const row = (over: Partial<BidRowForKpi>): BidRowForKpi => ({ status: "CLOSED", decision: "BID", outcome: "LOST", invitedAt: "2026-03-01", decidedAt: "2026-03-03", submittedAt: "2026-03-15", outcomeAt: "2026-04-01", estimatedValue: 100_000, latestAmount: 95_000, awardedAmount: null, lossReason: "PRICE", estimatingHours: 10, ...over });

describe("bidKpis", () => {
  it("counts by the right anchor date and derives the rates", () => {
    const rows = [
      row({}),
      row({ outcome: "AWARDED", awardedAmount: 120_000, lossReason: null }),
      row({ status: "SUBMITTED", outcome: null, outcomeAt: null }),
      row({ status: "CLOSED", decision: "NO_BID", outcome: "NO_BID", submittedAt: null, estimatingHours: 2 }),
      row({ invitedAt: "2025-12-01", decidedAt: "2025-12-02", submittedAt: "2025-12-10", outcomeAt: "2025-12-20" }), // last year
    ];
    const k = bidKpis(rows, w);
    expect(k.invitations).toBe(4);
    expect(k.decided).toBe(4);
    expect(k.bid).toBe(3);
    expect(k.noBid).toBe(1);
    expect(k.bidRate).toBe(0.75);
    expect(k.submitted).toBe(3);
    expect(k.awarded).toBe(1);
    expect(k.lost).toBe(1);
    expect(k.winRate).toBe(0.5);
    expect(k.open).toBe(1);
    expect(k.openValue).toBe(95_000);
    expect(k.awardedValue).toBe(120_000);
    expect(k.avgTurnaroundDays).toBe(14);
    expect(k.estimatingHours).toBe(30);
    expect(k.lossReasons).toEqual({ PRICE: 1 });
  });
  it("is null-safe on an empty window", () => {
    const k = bidKpis([], w);
    expect(k.bidRate).toBeNull();
    expect(k.winRate).toBeNull();
    expect(k.avgTurnaroundDays).toBeNull();
  });
});
