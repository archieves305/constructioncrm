import { describe, expect, it } from "vitest";
import { deriveTaskState } from "./state";

describe("deriveTaskState", () => {
  it("maps status + metadata onto the workflow states", () => {
    expect(deriveTaskState({ status: "PENDING", activatedAt: null })).toBe("NOT_ACTIVE");
    expect(deriveTaskState({ status: "PENDING", activatedAt: new Date() })).toBe("READY");
    expect(deriveTaskState({ status: "IN_PROGRESS", activatedAt: new Date() })).toBe("IN_PROGRESS");
    expect(deriveTaskState({ status: "BLOCKED", activatedAt: new Date() })).toBe("BLOCKED");
    expect(deriveTaskState({ status: "BLOCKED", activatedAt: new Date(), inspectionResult: "FAIL" })).toBe("FAILED_INSPECTION");
    expect(deriveTaskState({ status: "COMPLETED", activatedAt: new Date() })).toBe("COMPLETED");
    expect(deriveTaskState({ status: "CANCELLED", activatedAt: new Date(), skipReason: "n/a" })).toBe("SKIPPED");
    expect(deriveTaskState({ status: "CANCELLED", activatedAt: new Date(), skipReason: null })).toBe("CANCELLED");
  });
});
