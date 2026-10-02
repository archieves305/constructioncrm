import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/tasks/create", () => ({ createTask: vi.fn() }));
vi.mock("@/lib/tasks/update", () => ({ updateTask: vi.fn() }));

import { planLineSync } from "./schedule-task-link";

const line = (over: Partial<Parameters<typeof planLineSync>[0]> = {}) => ({ assignedUserId: null, status: "NOT_STARTED", hasTask: false, taskStatus: null, ...over });

describe("planLineSync", () => {
  it("a line with nobody on it has no task", () => {
    expect(planLineSync(line())).toBe("none");
  });

  it("naming a person raises the task", () => {
    expect(planLineSync(line({ assignedUserId: "u1" }))).toBe("create");
  });

  it("an open task follows the line's owner and date", () => {
    expect(planLineSync(line({ assignedUserId: "u2", hasTask: true, taskStatus: "PENDING" }))).toBe("update");
    // Clearing the owner unassigns the task rather than dropping it.
    expect(planLineSync(line({ assignedUserId: null, hasTask: true, taskStatus: "IN_PROGRESS" }))).toBe("update");
  });

  it("completing the line completes its open task, once", () => {
    expect(planLineSync(line({ status: "COMPLETE", assignedUserId: "u1", hasTask: true, taskStatus: "PENDING" }))).toBe("complete");
    expect(planLineSync(line({ status: "COMPLETE", assignedUserId: "u1", hasTask: true, taskStatus: "COMPLETED" }))).toBe("none");
    expect(planLineSync(line({ status: "COMPLETE", assignedUserId: "u1" }))).toBe("none");
  });

  it("a reopened line with an owner gets a fresh task instead of reopening the closed one", () => {
    expect(planLineSync(line({ assignedUserId: "u1", hasTask: true, taskStatus: "COMPLETED" }))).toBe("create");
    expect(planLineSync(line({ assignedUserId: null, hasTask: true, taskStatus: "CANCELLED" }))).toBe("none");
  });
});
