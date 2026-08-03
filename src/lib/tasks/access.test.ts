import { describe, expect, it } from "vitest";
import { canEditTask, canViewTask, taskVisibilityFilter } from "./access";

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
});
