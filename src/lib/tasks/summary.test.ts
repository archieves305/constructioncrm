import { describe, expect, it } from "vitest";
import { addDays, subDays } from "date-fns";
import { bucketByDue, dueBucket, summarizeTasks } from "./summary";

const today = new Date();
today.setHours(15, 0, 0, 0);

describe("dueBucket", () => {
  it("treats any time today as due today, even if that moment has passed", () => {
    const earlier = new Date();
    earlier.setHours(0, 5, 0, 0);
    expect(dueBucket(earlier)).toBe("today");
  });
  it("puts yesterday in overdue", () => {
    expect(dueBucket(subDays(today, 1))).toBe("overdue");
  });
  it("puts tomorrow in upcoming", () => {
    expect(dueBucket(addDays(today, 1))).toBe("upcoming");
  });
  it("accepts ISO strings, as the API returns them", () => {
    expect(dueBucket(subDays(today, 3).toISOString())).toBe("overdue");
  });
  it("has a bucket for no date", () => {
    expect(dueBucket(null)).toBe("noDate");
  });
});

describe("summarizeTasks", () => {
  it("counts BLOCKED as open and as overdue when past due", () => {
    const s = summarizeTasks([
      { status: "BLOCKED", dueAt: subDays(today, 2) },
      { status: "PENDING", dueAt: today },
      { status: "IN_PROGRESS", dueAt: null },
      { status: "COMPLETED", dueAt: subDays(today, 9) },
      { status: "CANCELLED", dueAt: subDays(today, 9) },
    ]);
    expect(s).toEqual({ open: 3, overdue: 1, dueToday: 1, blocked: 1 });
  });
  it("is all zeros for nothing", () => {
    expect(summarizeTasks([])).toEqual({ open: 0, overdue: 0, dueToday: 0, blocked: 0 });
  });
});

describe("bucketByDue", () => {
  it("drops closed tasks and groups the rest", () => {
    const rows = [
      { id: "a", status: "PENDING" as const, dueAt: subDays(today, 1) },
      { id: "b", status: "PENDING" as const, dueAt: today },
      { id: "c", status: "PENDING" as const, dueAt: addDays(today, 4) },
      { id: "d", status: "PENDING" as const, dueAt: null },
      { id: "e", status: "COMPLETED" as const, dueAt: null },
    ];
    const b = bucketByDue(rows);
    expect(b.overdue.map((t) => t.id)).toEqual(["a"]);
    expect(b.today.map((t) => t.id)).toEqual(["b"]);
    expect(b.upcoming.map((t) => t.id)).toEqual(["c"]);
    expect(b.noDate.map((t) => t.id)).toEqual(["d"]);
  });
});
