import { describe, expect, it } from "vitest";
import { parseRange } from "./range";

describe("parseRange", () => {
  it("no header, or one it cannot use: the whole file", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-10,20-30", 100)).toBeNull();
    expect(parseRange("items=0-10", 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
  });
  it("the probe iPhones send first, an open range, and an end past the file", () => {
    expect(parseRange("bytes=0-1", 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange("bytes=40-", 100)).toEqual({ start: 40, end: 99 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
  });
  it("the last n bytes", () => {
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });
  it("outside the file", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=50-40", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
  });
});
