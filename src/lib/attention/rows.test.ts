import { describe, expect, it } from "vitest";
import { ATTENTION_KEYS, ATTENTION_ROWS, attentionHref, attentionRowsFor, canSeeAttentionRow, isAttentionKey, visibleAttention, type AttentionCount } from "./rows";

const keys = (role: Parameters<typeof attentionRowsFor>[0]) => attentionRowsFor(role).map((r) => r.key);

describe("attention rows", () => {
  it("defines every key exactly once", () => {
    expect(ATTENTION_ROWS.map((r) => r.key).sort()).toEqual([...ATTENTION_KEYS].sort());
  });

  it("shows an admin the rows the audit named", () => {
    expect(keys("ADMIN")).toEqual(
      expect.arrayContaining(["inspections-to-correct", "permits-expiring", "violation-deadlines", "change-orders-awaiting", "pending-expenses"]),
    );
    expect(keys("ADMIN")).toHaveLength(ATTENTION_KEYS.length);
  });

  it("keeps approval and money rows to the roles that can act on them", () => {
    expect(keys("SALES_REP")).not.toContain("pending-expenses");
    expect(keys("SALES_REP")).not.toContain("logs-awaiting");
    expect(keys("SALES_REP")).not.toContain("deposits-missing");
    expect(keys("SALES_REP")).toContain("overdue-follow-ups");
    expect(keys("SALES_REP")).toContain("contracts-awaiting");
    expect(keys("READ_ONLY")).toContain("deposits-missing");
    expect(keys("READ_ONLY")).not.toContain("pending-expenses");
  });

  it("gives marketing and crew leads only what they work", () => {
    expect(keys("MARKETING")).toEqual(["overdue-tasks", "overdue-follow-ups"]);
    expect(keys("CREW_LEAD")).toEqual(["overdue-tasks"]);
    expect(keys(null)).toEqual([]);
  });

  it("guards a list by the same role list as its row", () => {
    expect(canSeeAttentionRow("OFFICE_STAFF", "pending-expenses")).toBe(true);
    expect(canSeeAttentionRow("SALES_REP", "pending-expenses")).toBe(false);
    expect(canSeeAttentionRow(undefined, "overdue-tasks")).toBe(false);
    expect(isAttentionKey("quiet-jobs")).toBe(true);
    expect(isAttentionKey("nope")).toBe(false);
  });

  it("opens overdue tasks on the Tasks page and every other row on its own list, carrying the scope", () => {
    expect(attentionHref("overdue-tasks", "mine")).toBe("/tasks?overdue=1&assignedUserId=me");
    expect(attentionHref("overdue-tasks", "all")).toBe("/tasks?overdue=1&scope=all");
    expect(attentionHref("permits-expiring", "all")).toBe("/attention/permits-expiring?scope=all");
    expect(attentionHref("permits-expiring", "mine")).toBe("/attention/permits-expiring?scope=mine");
  });

  it("hides empty rows and puts the most severe first, keeping the defined order within a tone", () => {
    const row = (key: AttentionCount["key"], tone: AttentionCount["tone"], count: number): AttentionCount => ({ key, label: key, tone, count, href: "#" });
    const out = visibleAttention([
      row("quiet-jobs", "neutral", 4),
      row("permits-expiring", "warning", 1),
      row("overdue-tasks", "danger", 0),
      row("pending-expenses", "warning", 2),
      row("violation-deadlines", "danger", 3),
    ]);
    expect(out.map((r) => r.key)).toEqual(["violation-deadlines", "permits-expiring", "pending-expenses", "quiet-jobs"]);
  });
});
