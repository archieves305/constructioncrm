import { describe, expect, it } from "vitest";
import { bidKpis, groupBy, moneyKpis, profitPerHour, type BidRowForKpi } from "./scorecard";

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


describe("moneyKpis", () => {
  const w2 = { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T23:59:59Z") };
  const base = {
    jobs: [
      { jobId: "j1", billable: true, revisedContract: 800_000, projectedProfit: 200_000, retainageHeld: 40_000, createdAt: "2025-06-01" },
      { jobId: "j2", billable: true, revisedContract: 200_000, projectedProfit: null, retainageHeld: 0, createdAt: "2026-04-01" },
      { jobId: "j3", billable: false, revisedContract: 0, projectedProfit: null, retainageHeld: 0, createdAt: "2026-05-01" },
      { jobId: "j4", billable: true, revisedContract: 50_000, projectedProfit: 5_000, retainageHeld: 0, createdAt: "2024-01-01" },
    ],
    invoices: [
      { jobId: "j1", amount: 100_000, issueDate: "2026-02-01", status: "PAID" },
      { jobId: "j1", amount: 50_000, issueDate: "2026-03-01", status: "SENT" },
      { jobId: "j4", amount: 9_000, issueDate: "2026-03-01", status: "DRAFT" },
      { jobId: "j4", amount: 7_000, issueDate: "2026-03-01", status: "VOID" },
      { jobId: "j4", amount: 1_000, issueDate: "2025-12-01", status: "PAID" },
    ],
    payments: [
      { amount: 100_000, receivedDate: "2026-03-03", invoiceIssueDate: "2026-02-01", status: "RECEIVED" },
      { amount: 20_000, receivedDate: "2026-04-01", invoiceIssueDate: null, status: "RECEIVED" },
      { amount: 5_000, receivedDate: null, invoiceIssueDate: "2026-03-01", status: "PENDING" },
    ],
    changeOrders: [
      { status: "APPROVED", decidedAt: "2026-05-01" },
      { status: "REJECTED", decidedAt: "2026-06-01" },
      { status: "APPROVED", decidedAt: "2026-07-01" },
      { status: "SENT", decidedAt: null },
    ],
  };
  it("billed counts issued invoices in the window only", () => {
    expect(moneyKpis(base, w2).billed).toBe(150_000);
  });
  it("days to pay uses linked payments and reports the unlinked ones", () => {
    const k = moneyKpis(base, w2);
    expect(k.daysToPay).toBe(30);
    expect(k.linkedPayments).toBe(1);
    expect(k.unlinkedPayments).toBe(1);
    expect(k.collected).toBe(120_000);
  });
  it("margin counts jobs active in the window (created or billed there); owned rehabs are left out", () => {
    const k = moneyKpis(base, w2);
    expect(k.grossProfit).toBe(200_000);
    expect(k.margin).toBe(0.25);
    expect(k.contractValue).toBe(1_000_000);
    expect(k.averageContract).toBe(500_000);
    expect(k.retainageHeld).toBe(40_000);
    // j1 billed in the window (created before it), j2 and j3 created in it; j4 only billed last year → out.
    expect(k.jobs).toBe(3);
    expect(k.repeatWork).toBe(true);
  });
  it("change-order approval rate over decided ones", () => {
    const k = moneyKpis(base, w2);
    expect(k.changeOrdersDecided).toBe(3);
    expect(k.changeOrderApprovalRate).toBeCloseTo(2 / 3);
  });
  it("a window with no activity has no profit to show", () => {
    const k = moneyKpis(base, { from: new Date("2020-01-01T00:00:00Z"), to: new Date("2020-12-31T23:59:59Z") });
    expect(k).toMatchObject({ billed: 0, grossProfit: null, margin: null, contractValue: 0, jobs: 0, repeatWork: true });
  });
  it("is null-safe with nothing", () => {
    const k = moneyKpis({ jobs: [], invoices: [], payments: [], changeOrders: [] }, w2);
    expect(k).toMatchObject({ billed: 0, grossProfit: null, margin: null, averageContract: null, daysToPay: null, changeOrderApprovalRate: null, repeatWork: false });
  });
  it("profit per hour, both variants", () => {
    expect(profitPerHour(10_000, 40, 100)).toEqual({ perAwardHour: 250, perBidHour: 100 });
    expect(profitPerHour(null, 40, 100)).toEqual({ perAwardHour: null, perBidHour: null });
    expect(profitPerHour(10_000, 0, 0)).toEqual({ perAwardHour: null, perBidHour: null });
  });
  it("groupBy puts a row in every group it belongs to", () => {
    const g = groupBy([{ id: 1, t: ["a", "b"] }, { id: 2, t: ["b"] }], (r) => r.t.map((k) => ({ key: k, label: k.toUpperCase() })));
    expect(g.map((x) => [x.key, x.rows.length])).toEqual([["a", 1], ["b", 2]]);
  });
});
