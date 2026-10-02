import { describe, expect, it } from "vitest";
import { isApprovedForPayment, netDueForLines, requestableLines, type ScheduleLine } from "./payment-math";

const line = (over: Partial<ScheduleLine> = {}): ScheduleLine => ({
  id: "l1", name: "Tile", status: "COMPLETE", inspectionRequired: true, inspectionStatus: "PASSED", paymentAmount: 1000, paymentRequestId: null, ...over,
});

describe("isApprovedForPayment", () => {
  it("needs the line complete and its inspection passed", () => {
    expect(isApprovedForPayment(line())).toBe(true);
    expect(isApprovedForPayment(line({ status: "IN_PROGRESS" }))).toBe(false);
    expect(isApprovedForPayment(line({ inspectionStatus: "PENDING" }))).toBe(false);
    expect(isApprovedForPayment(line({ inspectionStatus: "FAILED" }))).toBe(false);
  });

  it("does not wait on an inspection the line does not require", () => {
    expect(isApprovedForPayment(line({ inspectionRequired: false, inspectionStatus: "PENDING" }))).toBe(true);
  });
});

describe("netDueForLines", () => {
  it("takes retainage, backcharges and direct payments off the gross", () => {
    const due = netDueForLines([line({ id: "a", paymentAmount: 2850 }), line({ id: "b", paymentAmount: 950 })], 10, { backcharges: 100, directPayments: 250 });
    expect(due).toEqual({ lineIds: ["a", "b"], gross: 3800, retainage: 380, deductions: 350, net: 3070 });
  });

  it("is never negative and tolerates lines with no amount", () => {
    expect(netDueForLines([line({ paymentAmount: 100 })], 0, { backcharges: 500 }).net).toBe(0);
    expect(netDueForLines([line({ paymentAmount: null })], 10).gross).toBe(0);
    expect(netDueForLines([], 10).net).toBe(0);
  });

  it("rounds to cents", () => {
    expect(netDueForLines([line({ paymentAmount: 333.33 })], 7.5).retainage).toBe(25);
  });
});

describe("requestableLines", () => {
  it("offers approved lines with an amount that no request covers yet", () => {
    const lines = [
      line({ id: "ok" }),
      line({ id: "requested", paymentRequestId: "r1" }),
      line({ id: "open", status: "IN_PROGRESS" }),
      line({ id: "free", paymentAmount: 0 }),
    ];
    expect(requestableLines(lines).map((l) => l.id)).toEqual(["ok"]);
  });
});
