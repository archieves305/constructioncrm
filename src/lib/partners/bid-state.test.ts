import { describe, expect, it } from "vitest";
import { BID_STATUSES, bidNumber, canTransition, closeRequires, latestAmount, leadStageFor } from "./bid-state";

describe("bid state", () => {
  it("allows the forward moves, the backward corrections, and closing from anywhere", () => {
    expect(canTransition("INVITED", "ESTIMATING")).toBe(true);
    expect(canTransition("ESTIMATING", "SUBMITTED")).toBe(true);
    expect(canTransition("SUBMITTED", "ESTIMATING")).toBe(true); // a revision
    expect(canTransition("SHORTLISTED", "INVITED")).toBe(false);
    for (const s of BID_STATUSES) expect(canTransition(s, "CLOSED") || s === "CLOSED").toBe(true);
    expect(canTransition("CLOSED", "INVITED")).toBe(true); // reopen
    expect(canTransition("CLOSED", "SUBMITTED")).toBe(false);
    expect(canTransition("TRACKING", "TRACKING")).toBe(true);
  });
  it("closing needs a reason for a loss and an amount for an award", () => {
    expect(closeRequires("LOST")).toEqual({ lossReason: true, awardedAmount: false });
    expect(closeRequires("AWARDED")).toEqual({ lossReason: false, awardedAmount: true });
    expect(closeRequires("CANCELLED")).toEqual({ lossReason: false, awardedAmount: false });
  });
  it("mirrors only Won and Lost onto the lead", () => {
    expect(leadStageFor("AWARDED")).toBe("won");
    expect(leadStageFor("LOST")).toBe("lost");
    expect(leadStageFor("NO_BID")).toBe("lost");
    expect(leadStageFor("REBID")).toBe("open");
    expect(leadStageFor(null)).toBe("open");
  });
  it("numbers and amounts", () => {
    expect(bidNumber(7)).toBe("BID-00007");
    expect(latestAmount([])).toBeNull();
    expect(latestAmount([{ version: 1, amount: "100" }, { version: 2, amount: 90 }])).toBe(90);
  });
});
