import { describe, expect, it } from "vitest";
import { dropId, parseDropId, targetDay, type DropTarget } from "./drop-target";

describe("dropId / parseDropId", () => {
  it("round-trips every target kind", () => {
    const targets: DropTarget[] = [
      { kind: "day", day: "2026-09-29" },
      { kind: "slot", day: "2026-09-29", hour: 8, minute: 0 },
      { kind: "slot", day: "2026-09-29", hour: 13, minute: 30 },
      { kind: "cell", day: "2026-09-29", userId: "u-lisette" },
      { kind: "cell", day: "2026-09-29", userId: null },
      { kind: "unscheduled" },
    ];
    for (const t of targets) expect(parseDropId(dropId(t))).toEqual(t);
  });

  it("names the ids the components use", () => {
    expect(dropId({ kind: "day", day: "2026-09-29" })).toBe("day:2026-09-29");
    expect(dropId({ kind: "slot", day: "2026-09-29", hour: 8, minute: 0 })).toBe("slot:2026-09-29T08:00");
    expect(dropId({ kind: "cell", day: "2026-09-29", userId: null })).toBe("cell:unassigned::2026-09-29");
    expect(dropId({ kind: "cell", day: "2026-09-29", userId: "u1" })).toBe("cell:u1::2026-09-29");
  });

  it("rejects junk and impossible dates rather than guessing", () => {
    expect(parseDropId("day:2026-13-40")).toBeNull();
    expect(parseDropId("slot:2026-09-29T25:00")).toBeNull();
    expect(parseDropId("cell:u1:2026-09-29")).toBeNull();
    expect(parseDropId("t-123")).toBeNull();
    expect(parseDropId(null)).toBeNull();
    expect(parseDropId(42)).toBeNull();
  });

  it("knows which day a target lands on", () => {
    expect(targetDay({ kind: "cell", day: "2026-09-29", userId: null })).toBe("2026-09-29");
    expect(targetDay({ kind: "unscheduled" })).toBeNull();
  });
});
