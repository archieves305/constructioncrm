import { describe, expect, it } from "vitest";
import { clampAt, pagePattern, subjectFor, usageBatchSchema } from "./events";

describe("usage events", () => {
  it("page paths lose ids, dates and query strings", () => {
    expect(pagePattern("/jobs/cmo7890l80000o88ogp5ar2zt/daily-logs/2026-11-08?tab=crew")).toBe("/jobs/:id/daily-logs/:date");
    expect(pagePattern("/leads?callList=1")).toBe("/leads");
    expect(pagePattern("/attention/jobs-delayed")).toBe("/attention/jobs-delayed");
    expect(pagePattern("/sign/aVeryLongRandomTokenThatShouldNeverBeKeptAsIsXYZ123456")).toBe("/sign/:x");
  });
  it("only known kinds are kept as a subject", () => {
    expect(subjectFor("task_opened", "task")).toBe("task");
    expect(subjectFor("task_opened", "Call Mrs Smith")).toBeNull();
    expect(subjectFor("page_viewed", "/jobs/cmo7890l80000o88ogp5ar2zt")).toBe("/jobs/:id");
  });
  it("times are kept to the last week and never in the future", () => {
    const now = Date.UTC(2026, 10, 8, 12);
    expect(clampAt("2030-01-01T00:00:00Z", now).getTime()).toBe(now);
    expect(clampAt("2020-01-01T00:00:00Z", now).getTime()).toBe(now - 7 * 86_400_000);
  });
  it("unknown events are refused", () => {
    expect(usageBatchSchema.safeParse({ source: "phone", events: [{ event: "made_up", at: new Date().toISOString() }] }).success).toBe(false);
    expect(usageBatchSchema.safeParse({ source: "web", events: [{ event: "page_viewed", subject: "/jobs", at: new Date().toISOString() }] }).success).toBe(true);
  });
});
