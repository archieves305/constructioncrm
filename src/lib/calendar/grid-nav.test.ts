import { describe, expect, it } from "vitest";
import { containerAt, nearestInDirection } from "./grid-nav";

// A 3×2 grid of 100×60 cells with 10px gaps, plus a tall rail on the left.
const cell = (col: number, row: number) => ({ left: 200 + col * 110, top: 100 + row * 70, width: 100, height: 60 });
const grid = [
  { id: "r0c0", rect: cell(0, 0) },
  { id: "r0c1", rect: cell(1, 0) },
  { id: "r0c2", rect: cell(2, 0) },
  { id: "r1c0", rect: cell(0, 1) },
  { id: "r1c1", rect: cell(1, 1) },
  { id: "r1c2", rect: cell(2, 1) },
  { id: "rail", rect: { left: 0, top: 0, width: 180, height: 600 } },
];

describe("nearestInDirection", () => {
  it("prefers the neighbour on the axis over a diagonal one", () => {
    expect(nearestInDirection(cell(0, 0), grid, "right")).toBe("r0c1");
    expect(nearestInDirection(cell(1, 0), grid, "down")).toBe("r1c1");
    expect(nearestInDirection(cell(1, 1), grid, "up")).toBe("r0c1");
    expect(nearestInDirection(cell(2, 1), grid, "left")).toBe("r1c1");
  });
  it("leaves the grid for the rail on the far left and returns null off the edge", () => {
    expect(nearestInDirection(cell(0, 1), grid, "left")).toBe("rail");
    expect(nearestInDirection(cell(2, 0), grid, "right")).toBeNull();
    expect(nearestInDirection(cell(1, 1), grid, "down")).toBeNull();
  });
});

describe("containerAt", () => {
  it("finds the cell under the point, else the nearest centre", () => {
    expect(containerAt({ x: 320, y: 120 }, grid)).toBe("r0c1");
    expect(containerAt({ x: 315, y: 95 }, grid)).toBe("r0c1");
    expect(containerAt({ x: 5, y: 5 }, [])).toBeNull();
  });
});
