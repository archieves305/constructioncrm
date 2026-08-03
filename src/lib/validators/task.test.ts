import { describe, expect, it } from "vitest";
import { updateTaskSchema } from "./task";

/**
 * Regression tests for three defects that were live in production. Each of
 * these parsed "successfully" in a way that quietly did the wrong thing, so
 * they are pinned here rather than left to code review.
 */
describe("updateTaskSchema", () => {
  it("accepts an explicit null assignee so a task can be unassigned", () => {
    // Was `z.string().optional()`, which rejects null. The task board sends
    // `assignedUserId: null` on unassign, so this 400'd and the user saw only
    // a generic "Update failed" toast.
    const result = updateTaskSchema.safeParse({ assignedUserId: null });
    expect(result.success).toBe(true);
    expect(result.success && result.data.assignedUserId).toBeNull();
  });

  it("accepts an explicit null due date so a due date can be cleared", () => {
    const result = updateTaskSchema.safeParse({ dueAt: null });
    expect(result.success).toBe(true);
    expect(result.success && result.data.dueAt).toBeNull();
  });

  it("does NOT inject a default priority when priority is absent", () => {
    // `.partial()` does not strip `.default()`, so the create schema's
    // `.default("MEDIUM")` leaked into every PATCH. The route spread the
    // parsed object into the update, so ticking an URGENT task complete
    // silently downgraded it to MEDIUM.
    const result = updateTaskSchema.safeParse({ status: "COMPLETED" });
    expect(result.success).toBe(true);
    expect(result.success && "priority" in result.data).toBe(false);
  });

  it("still accepts a priority when one is genuinely sent", () => {
    const result = updateTaskSchema.safeParse({ priority: "URGENT" });
    expect(result.success && result.data.priority).toBe("URGENT");
  });

  it("accepts BLOCKED as a status", () => {
    expect(updateTaskSchema.safeParse({ status: "BLOCKED" }).success).toBe(true);
  });

  it("distinguishes absent from null for clearable fields", () => {
    // `undefined` means "leave alone"; `null` means "clear it". The route
    // branches on exactly this, so the schema must preserve the difference.
    const absent = updateTaskSchema.safeParse({ title: "x" });
    expect(absent.success && absent.data.dueAt).toBeUndefined();
    expect(absent.success && "dueAt" in absent.data).toBe(false);
  });
});
