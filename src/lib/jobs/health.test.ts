import { describe, expect, it } from "vitest";
import { deriveJobHealth, type JobHealthInput } from "./health";

const base: JobHealthInput = {
  closed: false,
  hasWorkflow: true,
  openTasks: 4,
  overdueTasks: 0,
  oldestOverdueDays: 0,
  blockedTasks: 0,
  failedInspections: 0,
  permitExpiresInDays: null,
};

describe("deriveJobHealth", () => {
  it("is on track with open work and nothing late", () => {
    expect(deriveJobHealth(base)).toEqual({ level: "on_track", label: "On track", reasons: [] });
  });

  it("a closed job is closed whatever else is true", () => {
    expect(deriveJobHealth({ ...base, closed: true, blockedTasks: 3, overdueTasks: 2, oldestOverdueDays: 40 }).level).toBe("closed");
  });

  it("an overdue task under a week puts it at risk; a week or more makes it delayed", () => {
    expect(deriveJobHealth({ ...base, overdueTasks: 2, oldestOverdueDays: 3 })).toMatchObject({ level: "at_risk", reasons: ["2 overdue tasks"] });
    const late = deriveJobHealth({ ...base, overdueTasks: 1, oldestOverdueDays: 7 });
    expect(late.level).toBe("delayed");
    expect(late.reasons).toEqual(["a task is 7 days overdue"]);
  });

  it("a blocked task or a failed inspection is delayed, and says which", () => {
    expect(deriveJobHealth({ ...base, blockedTasks: 1 })).toMatchObject({ level: "delayed", reasons: ["1 blocked task"] });
    const failed = deriveJobHealth({ ...base, blockedTasks: 1, failedInspections: 1 });
    expect(failed.reasons[0]).toBe("1 failed inspection waiting on corrections");
  });

  it("a permit expiring within 30 days is a risk; an expired one is a delay", () => {
    expect(deriveJobHealth({ ...base, permitExpiresInDays: 12 })).toMatchObject({ level: "at_risk", reasons: ["a permit expires in 12 days"] });
    expect(deriveJobHealth({ ...base, permitExpiresInDays: 0 }).reasons).toEqual(["a permit expires today"]);
    expect(deriveJobHealth({ ...base, permitExpiresInDays: 31 }).level).toBe("on_track");
    expect(deriveJobHealth({ ...base, permitExpiresInDays: -2 })).toMatchObject({ level: "delayed", reasons: ["a permit has expired"] });
  });

  it("carries the risks along when it is delayed, so nothing is hidden", () => {
    const h = deriveJobHealth({ ...base, blockedTasks: 1, permitExpiresInDays: 5 });
    expect(h.level).toBe("delayed");
    expect(h.reasons).toEqual(["1 blocked task", "a permit expires in 5 days"]);
  });

  it("no workflow and nothing open is not started, not on track", () => {
    expect(deriveJobHealth({ ...base, hasWorkflow: false, openTasks: 0 }).level).toBe("not_started");
    expect(deriveJobHealth({ ...base, hasWorkflow: false, openTasks: 2 }).level).toBe("on_track");
  });
});
