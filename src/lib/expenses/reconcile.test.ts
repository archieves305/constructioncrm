import { describe, expect, it } from "vitest";
import { dayGap, findManualTwin, pairCandidates, pairKey, sourceOf, twinReviewNote, type ReconcileRow } from "./reconcile";

const d = (s: string) => new Date(`${s}T15:30:00Z`);
let n = 0;
function row(over: Partial<ReconcileRow>): ReconcileRow {
  n++;
  return {
    id: `e${n}`,
    jobId: "j1",
    amount: 100,
    incurredDate: d("2026-08-07"),
    vendor: "Home Depot",
    externalId: null,
    payrollPaymentId: null,
    status: "APPROVED",
    createdAt: new Date(`2026-08-0${n % 9 || 1}T00:00:00Z`),
    createdByUserId: "u1",
    ...over,
  };
}

describe("dayGap", () => {
  it("counts calendar days regardless of time of day", () => {
    expect(dayGap(new Date("2026-08-07T23:59:00Z"), new Date("2026-08-08T00:01:00Z"))).toBe(1);
    expect(dayGap(d("2026-08-07"), d("2026-08-07"))).toBe(0);
    expect(dayGap(d("2026-08-04"), d("2026-08-07"))).toBe(3);
  });
});

describe("findManualTwin", () => {
  const rows = [
    row({ id: "far", incurredDate: d("2026-08-01") }),
    row({ id: "near", incurredDate: d("2026-08-05"), createdAt: new Date("2026-08-05T00:00:00Z") }),
    row({ id: "same-late", incurredDate: d("2026-08-07"), createdAt: new Date("2026-08-07T12:00:00Z") }),
    row({ id: "same-early", incurredDate: d("2026-08-07"), createdAt: new Date("2026-08-07T08:00:00Z") }),
    row({ id: "other-job", jobId: "j2" }),
    row({ id: "other-amount", amount: 100.01 }),
    row({ id: "pending", status: "PENDING" }),
    row({ id: "external", externalId: "abc" }),
    row({ id: "payroll", payrollPaymentId: "pp" }),
  ];
  it("prefers the same day, then the earliest-entered row", () => {
    expect(findManualTwin({ jobId: "j1", amount: 100, incurredDate: d("2026-08-07") }, rows)?.id).toBe("same-early");
  });
  it("falls back to the nearest day inside the window and ignores everything else", () => {
    expect(findManualTwin({ jobId: "j1", amount: 100, incurredDate: d("2026-08-08") }, rows.filter((r) => !r.id.startsWith("same")))?.id).toBe("near");
    expect(findManualTwin({ jobId: "j1", amount: 100, incurredDate: d("2026-08-12") }, rows)).toBeNull();
    expect(findManualTwin({ jobId: "j3", amount: 100, incurredDate: d("2026-08-07") }, rows)).toBeNull();
  });
  it("compares in cents", () => {
    expect(findManualTwin({ jobId: "j1", amount: 100.004, incurredDate: d("2026-08-07") }, rows)?.id).toBe("same-early");
  });
});

describe("pairCandidates", () => {
  it("pairs every external row with its manual twins, exact days first, skipping decided pairs", () => {
    const m1 = row({ id: "m1", amount: 500, incurredDate: d("2026-08-07") });
    const m2 = row({ id: "m2", amount: 500, incurredDate: d("2026-08-09") });
    const x1 = row({ id: "x1", amount: 500, externalId: "bank:t1", vendor: "ROBERTO R", incurredDate: d("2026-08-07") });
    const x2 = row({ id: "x2", amount: 20, externalId: "cardtxn", incurredDate: d("2026-08-07") });
    const m3 = row({ id: "m3", amount: 20, incurredDate: d("2026-08-08") });
    const pairs = pairCandidates([m1, m2, x1, x2, m3, row({ id: "rej", amount: 500, status: "REJECTED" })]);
    expect(pairs.map((p) => [p.manual.id, p.external.id, p.gapDays, p.exact, p.source])).toEqual([
      ["m1", "x1", 0, true, "bank"],
      ["m3", "x2", 1, false, "card"],
      ["m2", "x1", 2, false, "bank"],
    ]);
    const decided = new Set([pairKey("m1", "x1")]);
    expect(pairCandidates([m1, m2, x1], decided).map((p) => p.key)).toEqual(["m2:x1"]);
  });
  it("never pairs two manual rows or two external rows", () => {
    const a = row({ id: "a" });
    const b = row({ id: "b" });
    const x = row({ id: "x", externalId: "t" });
    const y = row({ id: "y", externalId: "u" });
    expect(pairCandidates([a, b, x, y]).map((p) => p.key).sort()).toEqual(["a:x", "a:y", "b:x", "b:y"]);
  });
});

describe("helpers", () => {
  it("names the source and writes a note a reviewer can act on", () => {
    expect(sourceOf("bank:abc")).toBe("bank");
    expect(sourceOf("cmog123")).toBe("card");
    const note = twinReviewNote(row({ id: "m9", vendor: "Roberto Rodriguez", amount: 2336.9, incurredDate: d("2026-08-07") }));
    expect(note).toContain("m9");
    expect(note).toContain("Roberto Rodriguez, 2026-08-07, $2336.90");
    expect(note).toMatch(/Cost Reconciliation/);
  });
});
