import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMN_LIMIT, nextShown, splitVisible } from "./limit";

describe("splitVisible", () => {
  const items = Array.from({ length: 30 }, (_, i) => i);
  it("returns everything when the limit covers the column", () => {
    expect(splitVisible(items, 30)).toEqual({ visible: items, hidden: 0 });
    expect(splitVisible(items, 100).hidden).toBe(0);
  });
  it("cuts at the limit and counts the rest", () => {
    const r = splitVisible(items, 25);
    expect(r.visible).toHaveLength(25);
    expect(r.hidden).toBe(5);
  });
  it("treats zero and negatives as nothing shown", () => {
    expect(splitVisible(items, 0)).toEqual({ visible: [], hidden: 30 });
    expect(splitVisible(items, -3).hidden).toBe(30);
  });
  it("handles an empty column", () => {
    expect(splitVisible([], 25)).toEqual({ visible: [], hidden: 0 });
  });
});

describe("nextShown", () => {
  it("adds the default step", () => {
    expect(nextShown(25)).toBe(25 + DEFAULT_COLUMN_LIMIT);
    expect(nextShown(0, 10)).toBe(10);
    expect(nextShown(-5, 0)).toBe(1);
  });
});
