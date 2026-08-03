import { describe, expect, it } from "vitest";
import { diffTask, type TaskSnapshot } from "./events";

const base: TaskSnapshot = {
  status: "PENDING",
  priority: "MEDIUM",
  dueAt: null,
  assignedUserId: null,
  blockedReason: null,
};

const snap = (over: Partial<TaskSnapshot> = {}): TaskSnapshot => ({ ...base, ...over });

describe("diffTask", () => {
  it("records nothing when nothing changed", () => {
    expect(diffTask(snap(), snap())).toEqual([]);
  });

  it("records a first assignment with no from-value", () => {
    const events = diffTask(snap(), snap({ assignedUserId: "u1" }));
    expect(events).toEqual([{ type: "ASSIGNED", fromValue: null, toValue: "u1" }]);
  });

  it("records a reassignment with both sides, so the timeline can name them", () => {
    const events = diffTask(snap({ assignedUserId: "u1" }), snap({ assignedUserId: "u2" }));
    expect(events).toEqual([{ type: "ASSIGNED", fromValue: "u1", toValue: "u2" }]);
  });

  it("records an unassignment", () => {
    const events = diffTask(snap({ assignedUserId: "u1" }), snap());
    expect(events).toEqual([{ type: "UNASSIGNED", fromValue: "u1", toValue: null }]);
  });

  it("gives entering BLOCKED its own type carrying the reason", () => {
    const events = diffTask(
      snap(),
      snap({ status: "BLOCKED", blockedReason: "waiting on shingles" }),
    );
    expect(events).toEqual([
      { type: "BLOCKED", fromValue: "PENDING", toValue: "waiting on shingles" },
    ]);
  });

  it("gives leaving BLOCKED its own type carrying the new status", () => {
    const events = diffTask(
      snap({ status: "BLOCKED", blockedReason: "waiting on shingles" }),
      snap({ status: "IN_PROGRESS" }),
    );
    expect(events).toEqual([
      { type: "UNBLOCKED", fromValue: "waiting on shingles", toValue: "IN_PROGRESS" },
    ]);
  });

  it("records a changed blocker even though the status stayed BLOCKED", () => {
    const events = diffTask(
      snap({ status: "BLOCKED", blockedReason: "waiting on shingles" }),
      snap({ status: "BLOCKED", blockedReason: "waiting on the inspector" }),
    );
    expect(events).toEqual([
      {
        type: "BLOCKED",
        fromValue: "waiting on shingles",
        toValue: "waiting on the inspector",
      },
    ]);
  });

  it("uses the generic status type for ordinary transitions", () => {
    const events = diffTask(snap(), snap({ status: "COMPLETED" }));
    expect(events).toEqual([
      { type: "STATUS_CHANGED", fromValue: "PENDING", toValue: "COMPLETED" },
    ]);
  });

  it("records a cleared due date distinctly from an unchanged one", () => {
    const due = new Date("2026-08-10T12:00:00Z");
    expect(diffTask(snap({ dueAt: due }), snap({ dueAt: null }))).toEqual([
      { type: "DUE_CHANGED", fromValue: due.toISOString(), toValue: null },
    ]);
    // Same instant via a different Date object must not register as a change.
    expect(diffTask(snap({ dueAt: due }), snap({ dueAt: new Date(due) }))).toEqual([]);
  });

  it("emits one row per changed field on a multi-field save", () => {
    const events = diffTask(
      snap(),
      snap({ assignedUserId: "u1", priority: "URGENT", status: "IN_PROGRESS" }),
    );
    expect(events.map((e) => e.type).sort()).toEqual([
      "ASSIGNED",
      "PRIORITY_CHANGED",
      "STATUS_CHANGED",
    ]);
  });
});
