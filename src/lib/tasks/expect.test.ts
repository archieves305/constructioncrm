import { describe, expect, it } from "vitest";
import { checkExpectations, expectSchema, sameValue } from "./expect";

const task = {
  status: "PENDING",
  assignedUserId: "u-frank",
  dueAt: new Date("2026-11-08T12:00:00.000Z"),
  blockedReason: null,
  title: "Set trusses",
  description: null,
  priority: "MEDIUM",
};

describe("checkExpectations", () => {
  it("applies when nothing changed", () => {
    expect(checkExpectations(task, { status: "PENDING" }, { status: "COMPLETED" })).toEqual({ ok: true, noop: false });
  });

  it("is a conflict when someone else changed the field", () => {
    const cancelled = { ...task, status: "CANCELLED" };
    expect(checkExpectations(cancelled, { status: "PENDING" }, { status: "COMPLETED" })).toEqual({
      ok: false,
      conflicts: ["status"],
    });
  });

  it("is a success with nothing to write when the task already holds the value", () => {
    const done = { ...task, status: "COMPLETED" };
    expect(checkExpectations(done, { status: "PENDING" }, { status: "COMPLETED" })).toEqual({ ok: true, noop: true });
  });

  it("ignores fields the caller did not mention", () => {
    const moved = { ...task, dueAt: new Date("2026-11-12T12:00:00.000Z") };
    expect(checkExpectations(moved, { status: "PENDING" }, { status: "COMPLETED" })).toEqual({ ok: true, noop: false });
  });

  it("reports each conflicting field", () => {
    const changed = { ...task, status: "BLOCKED", blockedReason: "Rain" };
    const r = checkExpectations(
      changed,
      { status: "PENDING", blockedReason: null },
      { status: "BLOCKED", blockedReason: "No trusses" },
    );
    expect(r).toEqual({ ok: false, conflicts: ["blockedReason"] });
  });

  it("without expectations behaves as before", () => {
    expect(checkExpectations({ ...task, status: "CANCELLED" }, undefined, { status: "COMPLETED" })).toEqual({
      ok: true,
      noop: false,
    });
  });

  it("is not a no-op when the patch carries a field that cannot be compared", () => {
    const done = { ...task, status: "COMPLETED" };
    expect(checkExpectations(done, { status: "PENDING" }, { status: "COMPLETED", checklist: [] })).toEqual({
      ok: true,
      noop: false,
    });
  });
});

describe("sameValue", () => {
  it("compares instants, days and empty text the way the task stores them", () => {
    expect(sameValue("dueAt", new Date("2026-11-08T12:00:00Z"), "2026-11-08T12:00:00.000Z")).toBe(true);
    expect(sameValue("dueAt", new Date("2026-11-08T12:00:00Z"), "2026-11-08")).toBe(true);
    expect(sameValue("dueAt", new Date("2026-11-08T12:00:00Z"), "2026-11-09")).toBe(false);
    expect(sameValue("dueAt", null, null)).toBe(true);
    expect(sameValue("description", null, "")).toBe(true);
    expect(sameValue("assignedUserId", "a", null)).toBe(false);
  });
});

describe("expectSchema", () => {
  it("refuses a field it cannot check", () => {
    expect(expectSchema.safeParse({ checklist: [] }).success).toBe(false);
    expect(expectSchema.safeParse({ status: "PENDING", dueAt: null }).success).toBe(true);
  });
});
