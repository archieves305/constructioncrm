import { describe, expect, it } from "vitest";
import { canQuickComplete, canQuickReopen, undoPatch } from "./quick-done";

describe("quick done", () => {
  it("offers Done on open ordinary tasks only", () => {
    expect(canQuickComplete({ status: "PENDING" })).toBe(true);
    expect(canQuickComplete({ status: "BLOCKED", blockedReason: "x" })).toBe(true);
    expect(canQuickComplete({ status: "COMPLETED" })).toBe(false);
    expect(canQuickComplete({ status: "CANCELLED" })).toBe(false);
    expect(canQuickComplete({ status: "PENDING", workflowTaskKey: "core:x" })).toBe(false);
    expect(canQuickReopen({ status: "COMPLETED" })).toBe(true);
    expect(canQuickReopen({ status: "COMPLETED", workflowTaskKey: "core:x" })).toBe(false);
  });

  it("Undo restores the status it had, with a blocked task's reason", () => {
    expect(undoPatch({ status: "IN_PROGRESS" })).toEqual({ status: "IN_PROGRESS" });
    expect(undoPatch({ status: "PENDING" })).toEqual({ status: "PENDING" });
    expect(undoPatch({ status: "BLOCKED", blockedReason: "Waiting on the city" })).toEqual({ status: "BLOCKED", blockedReason: "Waiting on the city" });
    expect(undoPatch({ status: "BLOCKED" })).toEqual({ status: "PENDING" });
  });
});
