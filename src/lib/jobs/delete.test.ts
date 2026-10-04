import { describe, expect, it } from "vitest";
import { jobDeleteBlockers, jobDeletePlan, type JobDeleteCounts } from "./delete";

const none: JobDeleteCounts = {
  payments: 0, expenses: 0, invoices: 0, laborPayments: 0, dailyLogs: 0, laborEntries: 0, contractsIssued: 0,
  violationCases: 0, tasks: 0, permits: 0, laborContracts: 0, changeOrders: 0, commitments: 0, budgetLines: 0, files: 0,
};

describe("job delete plan", () => {
  it("an empty job, or one with only tasks, permits and unpaid labor contracts, may be deleted", () => {
    expect(jobDeleteBlockers(none)).toEqual([]);
    const plan = jobDeletePlan({ ...none, tasks: 104, permits: 1, laborContracts: 2, files: 3 });
    expect(plan.blockers).toEqual([]);
    expect(plan.removes).toEqual([
      { label: "tasks and workflow steps", count: 104 },
      { label: "permits", count: 1 },
      { label: "labor contracts (none paid)", count: 2 },
    ]);
    expect(plan.keptFiles).toBe(3);
  });

  it("every kind of business record blocks the delete", () => {
    for (const key of ["payments", "expenses", "invoices", "laborPayments", "dailyLogs", "laborEntries", "contractsIssued", "violationCases"] as const) {
      expect(jobDeleteBlockers({ ...none, [key]: 1 })).toHaveLength(1);
    }
    expect(jobDeleteBlockers({ ...none, payments: 2, expenses: 55 })).toEqual([
      { label: "customer payments", count: 2 },
      { label: "expenses", count: 55 },
    ]);
  });
});
