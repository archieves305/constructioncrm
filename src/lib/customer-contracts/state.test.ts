import { describe, expect, it } from "vitest";
import { canSend, computeMoneyEffects, evaluateSignAttempt, type MoneyEffectInput } from "./state";

describe("canSend", () => {
  it("allows a lone draft", () => {
    expect(canSend({ id: "a", status: "DRAFT" }, [{ id: "a", status: "DRAFT" }])).toEqual({ ok: true });
  });
  it("refuses a non-draft", () => {
    expect(canSend({ id: "a", status: "SENT" }, [])).toEqual({ ok: false, reason: "not_draft" });
  });
  it("refuses when a sibling is signed, before checking for one that is out", () => {
    const sibs = [{ id: "b", status: "SENT" as const }, { id: "c", status: "SIGNED" as const }];
    expect(canSend({ id: "a", status: "DRAFT" }, sibs)).toEqual({ ok: false, reason: "signed_exists" });
  });
  it("refuses when a sibling is awaiting signature", () => {
    expect(canSend({ id: "a", status: "DRAFT" }, [{ id: "b", status: "SENT" }])).toEqual({ ok: false, reason: "sent_exists" });
  });
  it("ignores void and declined siblings", () => {
    expect(canSend({ id: "a", status: "DRAFT" }, [{ id: "b", status: "VOID" }, { id: "c", status: "DECLINED" }])).toEqual({ ok: true });
  });
});

describe("evaluateSignAttempt", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  it("signs a live SENT contract", () => {
    expect(evaluateSignAttempt({ status: "SENT", tokenExpiresAt: new Date("2026-10-01") }, now)).toEqual({ ok: true });
  });
  it("reports expiry", () => {
    expect(evaluateSignAttempt({ status: "SENT", tokenExpiresAt: new Date("2026-09-01") }, now)).toEqual({ ok: false, reason: "expired" });
  });
  it("reports already signed even when the link has expired", () => {
    expect(evaluateSignAttempt({ status: "SIGNED", tokenExpiresAt: new Date("2026-09-01") }, now)).toEqual({ ok: false, reason: "already_signed" });
  });
  it("reports declined / void as decided", () => {
    expect(evaluateSignAttempt({ status: "DECLINED", tokenExpiresAt: null }, now)).toEqual({ ok: false, reason: "already_decided" });
    expect(evaluateSignAttempt({ status: "VOID", tokenExpiresAt: null }, now)).toEqual({ ok: false, reason: "already_decided" });
  });
  it("reports a draft as not sent", () => {
    expect(evaluateSignAttempt({ status: "DRAFT", tokenExpiresAt: null }, now)).toEqual({ ok: false, reason: "not_sent" });
  });
});

describe("computeMoneyEffects", () => {
  const base: MoneyEffectInput = {
    jobType: "FIXED_PRICE",
    billingMethod: "LUMP_SUM",
    jobTitle: "Roofing — Jane",
    contractTotal: 25000,
    depositAmount: 10000,
    approvedChangeOrderTotal: 0,
    sovLines: [],
    issuedApplicationCount: 0,
  };

  it("fixed price + lump sum: sets the contract sum and deposit, no SOV", () => {
    const e = computeMoneyEffects(base);
    expect(e.contractAmount).toBe(25000);
    expect(e.depositRequired).toBe(10000);
    expect(e.sov).toEqual({ action: "none" });
    expect(e.notes).toEqual([]);
  });

  it("adds approved change orders on top of the signed base", () => {
    const e = computeMoneyEffects({ ...base, approvedChangeOrderTotal: 1500.5 });
    expect(e.contractAmount).toBe(26500.5);
    expect(e.notes[0]).toMatch(/approved change orders/);
  });

  it("rollup job types leave the contract sum alone", () => {
    for (const jobType of ["COST_PLUS", "OWNED_REHAB"] as const) {
      const e = computeMoneyEffects({ ...base, jobType });
      expect(e.contractAmount).toBeNull();
      expect(e.depositRequired).toBe(10000);
      expect(e.notes[0]).toMatch(/computes its contract from costs/);
    }
  });

  it("progress billing with no SOV creates the base line", () => {
    const e = computeMoneyEffects({ ...base, billingMethod: "PROGRESS" });
    expect(e.sov).toEqual({ action: "create", itemNo: 1, description: "Roofing — Jane", scheduledValue: 25000 });
  });

  it("progress billing numbers the new base line after change-order lines", () => {
    const e = computeMoneyEffects({ ...base, billingMethod: "PROGRESS", sovLines: [{ id: "co", itemNo: 3, changeOrderId: "c1", scheduledValue: 500 }] });
    expect(e.sov).toEqual({ action: "create", itemNo: 4, description: "Roofing — Jane", scheduledValue: 25000 });
  });

  it("progress billing with one base line updates it, ignoring change-order lines", () => {
    const e = computeMoneyEffects({
      ...base,
      billingMethod: "PROGRESS",
      sovLines: [
        { id: "b", itemNo: 1, changeOrderId: null, scheduledValue: 30000 },
        { id: "co", itemNo: 2, changeOrderId: "c1", scheduledValue: 500 },
      ],
    });
    expect(e.sov).toEqual({ action: "update", lineId: "b", scheduledValue: 25000 });
  });

  it("progress billing with several base lines is left to the office", () => {
    const e = computeMoneyEffects({
      ...base,
      billingMethod: "PROGRESS",
      sovLines: [
        { id: "b1", itemNo: 1, changeOrderId: null, scheduledValue: 10000 },
        { id: "b2", itemNo: 2, changeOrderId: null, scheduledValue: 15000 },
      ],
    });
    expect(e.sov).toEqual({ action: "skip", reason: "multiple_base_lines" });
    expect(e.notes[0]).toMatch(/2 base lines/);
  });

  it("never touches the SOV once an application has been issued", () => {
    const e = computeMoneyEffects({ ...base, billingMethod: "PROGRESS", issuedApplicationCount: 2 });
    expect(e.sov).toEqual({ action: "skip", reason: "applications_issued" });
    expect(e.contractAmount).toBe(25000);
    expect(e.notes[0]).toMatch(/2 payment applications have already been issued/);
  });

  it("rounds to cents", () => {
    const e = computeMoneyEffects({ ...base, contractTotal: 100.005, depositAmount: 33.335, approvedChangeOrderTotal: 0.1 + 0.2 });
    expect(e.contractAmount).toBe(100.31);
    expect(e.depositRequired).toBe(33.34);
  });
});
