import { describe, expect, it } from "vitest";
import { allocatorExpenseStatus, parseStatusIds, replayOutcome, MAX_STATUS_IDS, type AllocatorExpenseRow } from "./status";

const row = (o: Partial<AllocatorExpenseRow> = {}): AllocatorExpenseRow => ({
  id: "exp1", jobId: "job1", externalId: "txn1", status: "PENDING", holdReason: "LABOR",
  reviewNote: "Looks like a crew payment", coveredByLaborPaymentId: null,
  updatedAt: new Date("2026-11-21T12:00:00Z"), ...o,
});

describe("allocatorExpenseStatus", () => {
  it("reports the status, hold reason and note", () => {
    expect(allocatorExpenseStatus(row())).toEqual({
      externalId: "txn1", expenseId: "exp1", jobId: "job1", status: "PENDING", holdReason: "LABOR",
      note: "Looks like a crew payment", coveredByCrewPayment: false, updatedAt: "2026-11-21T12:00:00.000Z",
    });
  });
  it("says when a crew payment carries the money", () => {
    expect(allocatorExpenseStatus(row({ status: "REJECTED", coveredByLaborPaymentId: "lp1" })).coveredByCrewPayment).toBe(true);
  });
});

describe("replayOutcome", () => {
  it("returns the stored status for the same job", () => {
    const r = replayOutcome(row({ status: "APPROVED", holdReason: null }), "job1");
    expect(r.kind).toBe("replay");
    if (r.kind === "replay") expect(r.body).toMatchObject({ alreadyExists: true, status: "APPROVED", expenseId: "exp1" });
  });
  it("refuses a different job with the job the CRM holds", () => {
    const r = replayOutcome(row(), "job2");
    expect(r).toMatchObject({ kind: "conflict", body: { error: "external_id_conflict", existingJobId: "job1" } });
  });
});

describe("parseStatusIds", () => {
  it("splits, trims and de-duplicates", () => {
    expect(parseStatusIds(["a, b", "b", "c,,"])).toEqual({ ids: ["a", "b", "c"] });
  });
  it("requires at least one id", () => {
    expect(parseStatusIds([""])).toEqual({ error: "ids is required" });
  });
  it("caps the request", () => {
    const many = Array.from({ length: MAX_STATUS_IDS + 1 }, (_, i) => `t${i}`).join(",");
    expect(parseStatusIds([many])).toEqual({ error: `at most ${MAX_STATUS_IDS} ids per request` });
  });
});
