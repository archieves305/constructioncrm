import { describe, expect, it } from "vitest";
import { allowedTransitions, closureBlockers, itemsToReopen, transitionNeedsReason } from "./rules";

describe("case rules", () => {
  it("lifecycle transitions: closed and cancelled are terminal; hold and cancel need a reason", () => {
    expect(allowedTransitions("NEW")).toEqual(["ACTIVE", "ON_HOLD", "CANCELLED"]);
    expect(allowedTransitions("COMPLIED")).toEqual(["ACTIVE", "ON_HOLD"]);
    expect(allowedTransitions("CLOSED")).toEqual([]);
    expect(allowedTransitions("CANCELLED")).toEqual([]);
    expect(transitionNeedsReason("ON_HOLD")).toBe(true);
    expect(transitionNeedsReason("ACTIVE")).toBe(false);
  });

  it("closureBlockers lists every blocker and is empty when the case is truly done", () => {
    const now = new Date();
    const all = closureBlockers({ items: [{ status: "OPEN" }, { status: "CORRECTED" }], agencyConfirmedAt: null, lienStatus: "RECORDED", officialBalance: 500, fineResolvedAt: null, openBlockingSteps: 2 });
    expect(all.map((b) => b.key)).toEqual(["items", "agency", "lien", "fines", "steps"]);
    expect(all[0]!.message).toBe("2 violation items are not yet verified or withdrawn");
    const clear = closureBlockers({ items: [{ status: "VERIFIED" }, { status: "WITHDRAWN" }], agencyConfirmedAt: now, lienStatus: "RELEASED", officialBalance: 500, fineResolvedAt: now, openBlockingSteps: 0 });
    expect(clear).toEqual([]);
    expect(closureBlockers({ items: [], agencyConfirmedAt: now, lienStatus: "NONE", officialBalance: 0, fineResolvedAt: null, openBlockingSteps: 0 })).toEqual([]);
  });

  it("itemsToReopen reopens only the re-cited items that had progressed", () => {
    const items = [
      { id: "a", status: "CORRECTED" as const },
      { id: "b", status: "VERIFIED" as const },
      { id: "c", status: "OPEN" as const },
      { id: "d", status: "WITHDRAWN" as const },
      { id: "e", status: "IN_PROGRESS" as const },
    ];
    expect(itemsToReopen(items, ["a", "b", "c", "d", "e", "ghost"]).map((i) => i.id)).toEqual(["a", "b", "e"]);
    expect(itemsToReopen(items, [])).toEqual([]);
  });
});
