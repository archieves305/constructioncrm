import { describe, expect, it } from "vitest";
import { computePaymentSchedule, depositAmountOf, validatePaymentSchedule } from "./schedule";

const stages = [
  { key: "deposit", label: "Deposit", percent: 40, trigger: "upon signing" },
  { key: "progress", label: "Progress", percent: 40, trigger: "at rough-in" },
  { key: "final", label: "Final", percent: 20, trigger: "on completion" },
];

describe("validatePaymentSchedule", () => {
  it("accepts a schedule that sums to 100", () => {
    expect(validatePaymentSchedule(stages)).toEqual([]);
  });
  it("refuses an empty schedule", () => {
    expect(validatePaymentSchedule([])).toEqual(["Add at least one payment stage"]);
  });
  it("reports the sum, duplicate keys and bad keys", () => {
    const errs = validatePaymentSchedule([
      { key: "Deposit", label: "Deposit", percent: 50, trigger: "" },
      { key: "final", label: "", percent: 30, trigger: "" },
      { key: "final", label: "Final", percent: 30, trigger: "" },
    ]);
    expect(errs.join("\n")).toMatch(/Stage 1: key/);
    expect(errs.join("\n")).toMatch(/Stage 2: label required/);
    expect(errs.join("\n")).toMatch(/duplicate key "final"/);
    expect(errs.join("\n")).toMatch(/add up to 110%/);
  });
  it("tolerates float noise in the sum", () => {
    expect(
      validatePaymentSchedule([
        { key: "a", label: "A", percent: 33.33, trigger: "" },
        { key: "b", label: "B", percent: 33.33, trigger: "" },
        { key: "c", label: "C", percent: 33.34, trigger: "" },
      ]),
    ).toEqual([]);
  });
});

describe("computePaymentSchedule", () => {
  it("splits to cents and the last stage absorbs the remainder", () => {
    const rows = computePaymentSchedule(1000.01, [
      { key: "a", label: "A", percent: 33.33, trigger: "" },
      { key: "b", label: "B", percent: 33.33, trigger: "" },
      { key: "c", label: "C", percent: 33.34, trigger: "" },
    ]);
    expect(rows.map((r) => r.amount)).toEqual([333.3, 333.3, 333.41]);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(1000.01, 2);
  });
  it("is exact on a round total", () => {
    expect(computePaymentSchedule(25000, stages).map((r) => r.amount)).toEqual([10000, 10000, 5000]);
  });
  it("puts the whole total on a single stage", () => {
    expect(computePaymentSchedule(999.99, [{ key: "all", label: "All", percent: 100, trigger: "" }])[0].amount).toBe(999.99);
  });
  it("names the first stage the deposit", () => {
    expect(depositAmountOf(computePaymentSchedule(25000, stages))).toBe(10000);
    expect(depositAmountOf([])).toBe(0);
  });
});
