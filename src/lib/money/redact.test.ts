import { describe, expect, it } from "vitest";
import { redactOverview } from "@/lib/jobs/overview";
import { jobMoneyView } from "./access";
import { redactJobMoney } from "./redact";

describe("jobMoneyView", () => {
  const job = { projectManagerId: "pm" };
  it("gives the office roles and read-only everything", () => {
    for (const role of ["ADMIN", "MANAGER", "OFFICE_STAFF", "READ_ONLY"]) expect(jobMoneyView({ id: "x", role }, job), role).toBe("full");
  });
  it("gives the job's own project manager everything, whatever their role", () => {
    expect(jobMoneyView({ id: "pm", role: "SALES_REP" }, job)).toBe("full");
    expect(jobMoneyView({ id: "pm", role: "CREW_LEAD" }, job)).toBe("full");
  });
  it("gives a sales rep the price only, and crew leads and marketing nothing", () => {
    expect(jobMoneyView({ id: "x", role: "SALES_REP" }, job)).toBe("price");
    expect(jobMoneyView({ id: "x", role: "CREW_LEAD" }, job)).toBe("none");
    expect(jobMoneyView({ id: "x", role: "MARKETING" }, { projectManagerId: null })).toBe("none");
  });
});

describe("redactJobMoney", () => {
  const job = { id: "j", contractAmount: "1000", balanceDue: "400", laborCost: "300", marginType: "PERCENT", marginValue: "20", depositRequired: "500", payments: [{ id: "p" }] };
  it("leaves a full view alone", () => {
    expect(redactJobMoney(job, "full")).toEqual({ ...job, moneyView: "full" });
  });
  it("keeps the price and drops the cost for a price view", () => {
    const r = redactJobMoney(job, "price");
    expect(r).toMatchObject({ contractAmount: "1000", balanceDue: "400", laborCost: null, marginType: null, marginValue: null, moneyView: "price" });
    expect(r.payments).toHaveLength(1);
  });
  it("drops every money field and the payments for no view", () => {
    expect(redactJobMoney(job, "none")).toMatchObject({ contractAmount: null, balanceDue: null, depositRequired: null, laborCost: null, payments: [], moneyView: "none" });
  });
});

describe("redactOverview", () => {
  const overview = {
    money: {
      billable: true, contract: 1000, paid: 600, balanceDue: 400, depositRequired: 500, depositReceived: 500,
      cost: 700, costBreakdown: { contractLabor: 500, fieldLabor: 0, expenses: 200 }, profit: 300, margin: 0.3,
      changeOrdersAwaiting: { count: 1, total: 50 }, pendingExpenses: { count: 2, total: 80 },
      estimatedCost: 650, committedOpen: 100, commitmentsOpen: 20, projectedProfit: 350, projectedMargin: 0.35, overBudgetBy: 50,
    },
    field: { dailyLogsAwaitingApproval: 1, crewPaymentRequests: { count: 1, total: 900 } },
    timeline: [
      { id: "a", kind: "payment" }, { id: "b", kind: "expense" }, { id: "c", kind: "labor_payment" },
      { id: "d", kind: "permit" }, { id: "e", kind: "invoice" }, { id: "f", kind: "stage" },
    ],
  } as unknown as Parameters<typeof redactOverview>[0];

  it("a price view keeps what the customer pays and drops cost, profit, crew pay and their events", () => {
    const r = redactOverview(overview, "price");
    expect(r.money).toMatchObject({ contract: 1000, paid: 600, cost: null, costBreakdown: null, profit: null, projectedProfit: null, estimatedCost: null, overBudgetBy: 0, pendingExpenses: { count: 0, total: 0 }, changeOrdersAwaiting: { count: 1, total: 50 } });
    expect(r.field.crewPaymentRequests).toEqual({ count: 0, total: 0 });
    expect(r.timeline.map((e) => e.kind)).toEqual(["payment", "permit", "invoice", "stage"]);
  });
  it("no view drops the money block and every money event", () => {
    const r = redactOverview(overview, "none");
    expect(r.money).toBeNull();
    expect(r.timeline.map((e) => e.kind)).toEqual(["permit", "stage"]);
  });
  it("a full view is unchanged", () => {
    const r = redactOverview(overview, "full");
    expect(r.money).toBe(overview.money);
    expect(r.moneyView).toBe("full");
  });
});
