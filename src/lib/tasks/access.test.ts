import { describe, expect, it } from "vitest";
import { canEditTask, canViewTask, taskVisibilityFilter, canDeleteTask } from "./access";

const task = { assignedUserId: "u-frank", createdByUserId: "u-jo" };

describe("task access", () => {
  it("lets office roles edit anything", () => {
    for (const role of ["ADMIN", "MANAGER", "OFFICE_STAFF"] as const) {
      expect(canEditTask({ id: "u-other", role }, task)).toBe(true);
    }
  });

  it("stops a sales rep editing a task that is not theirs", () => {
    // The write side had no role check at all: any authenticated user could
    // PATCH any task by id, while the read side scoped them to their own.
    expect(canEditTask({ id: "u-other", role: "SALES_REP" }, task)).toBe(false);
  });

  it("lets a sales rep edit their own assigned task", () => {
    expect(canEditTask({ id: "u-frank", role: "SALES_REP" }, task)).toBe(true);
  });

  it("lets the person who raised a task edit it", () => {
    expect(canEditTask({ id: "u-jo", role: "SALES_REP" }, task)).toBe(true);
  });

  it("never lets READ_ONLY edit, even their own", () => {
    expect(canEditTask({ id: "u-frank", role: "READ_ONLY" }, task)).toBe(false);
  });

  it("still lets READ_ONLY view", () => {
    expect(canViewTask({ id: "u-other", role: "READ_ONLY" }, task)).toBe(true);
  });

  it("confines a crew lead to their own tasks", () => {
    expect(canViewTask({ id: "u-other", role: "CREW_LEAD" }, task)).toBe(false);
    expect(canViewTask({ id: "u-frank", role: "CREW_LEAD" }, task)).toBe(true);
  });

  it("returns an unrestricted filter for office roles", () => {
    expect(taskVisibilityFilter({ id: "u1", role: "ADMIN" })).toEqual({});
  });

  it("returns an own-queue filter for restricted roles", () => {
    expect(taskVisibilityFilter({ id: "u1", role: "SALES_REP" })).toEqual({
      OR: [{ assignedUserId: "u1" }, { createdByUserId: "u1" }],
    });
  });

  it("delete: office roles always, the raiser yes, the assignee alone no, READ_ONLY never", () => {
    const task = { assignedUserId: "frank", createdByUserId: "jo" };
    expect(canDeleteTask({ id: "x", role: "OFFICE_STAFF" }, task)).toBe(true);
    expect(canDeleteTask({ id: "jo", role: "SALES_REP" }, task)).toBe(true);
    expect(canDeleteTask({ id: "frank", role: "CREW_LEAD" }, task)).toBe(false);
    expect(canDeleteTask({ id: "jo", role: "READ_ONLY" }, task)).toBe(false);
  });
});

describe("task access — job scope", () => {
  const rep = { id: "u-rep", role: "SALES_REP" as const };
  const other = { assignedUserId: "u-someone", createdByUserId: "u-else", jobId: "j1" };

  it("a rep sees another person's task on a job they are on, and only there", () => {
    expect(canViewTask(rep, other)).toBe(false);
    expect(canViewTask(rep, other, { jobIds: ["j1"] })).toBe(true);
    expect(canViewTask(rep, other, { jobIds: ["j2"] })).toBe(false);
    expect(canViewTask(rep, { ...other, jobId: null }, { jobIds: ["j1"] })).toBe(false);
  });

  it("scope widens viewing, never editing", () => {
    expect(canEditTask(rep, other)).toBe(false);
  });
});
