import { describe, expect, it } from "vitest";
import { hrefForRole, paths } from "./links";

describe("hrefForRole", () => {
  it("sends crew leads to the field shell and leaves everyone else on the office path", () => {
    expect(hrefForRole("/tasks?task=t1", "CREW_LEAD")).toBe("/field/tasks/t1");
    expect(hrefForRole("/jobs/j1?tab=workflow", "CREW_LEAD")).toBe("/field/jobs/j1");
    expect(hrefForRole("/violations/c1", "CREW_LEAD")).toBe("/violations/c1");
    expect(hrefForRole("/tasks?task=t1", "SALES_REP")).toBe("/tasks?task=t1");
  });

  it("builds the office paths the producers store", () => {
    expect(paths.task("t1")).toBe("/tasks?task=t1");
    expect(paths.job("j1", "money", "contract")).toBe("/jobs/j1?tab=money&sub=contract");
    expect(paths.violationCase("c1", "items")).toBe("/violations/c1?tab=items");
    expect(paths.notifications(new Date("2026-10-06T12:00:00Z"))).toBe("/notifications?since=2026-10-06T12%3A00%3A00.000Z");
  });
});
