import { describe, expect, it } from "vitest";
import { findBlanks, toPdfRect } from "./detect";

const W = 600;
const H = 420;
const DPI = 100;
function page() {
  const g = new Uint8Array(W * H).fill(255);
  const ink = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * W + x] = 0;
  };
  return { g, ink };
}
const square = (ink: (a: number, b: number, c: number, d: number) => void, x: number, y: number, s: number) => {
  ink(x, y, x + s - 1, y);
  ink(x, y + s - 1, x + s - 1, y + s - 1);
  ink(x, y, x, y + s - 1);
  ink(x + s - 1, y, x + s - 1, y + s - 1);
};

describe("finding blanks on a flat form", () => {
  it("an underline gives the empty band above it", () => {
    const { g, ink } = page();
    ink(100, 100, 400, 101);
    const c = findBlanks(g, W, H, DPI);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ id: 1, kind: "line" });
    expect(c[0].y + c[0].h).toBeLessThanOrEqual(100);
    expect(c[0].w).toBeGreaterThan(280);
  });
  it("a line with printed text right above it keeps only the empty part", () => {
    const { g, ink } = page();
    ink(100, 100, 400, 101);
    ink(100, 88, 380, 97); // words over most of the line
    expect(findBlanks(g, W, H, DPI)).toHaveLength(0);
  });
  it("a table row is split into its cells where vertical lines cross", () => {
    const { g, ink } = page();
    ink(50, 300, 550, 301);
    ink(50, 250, 550, 251);
    for (const x of [50, 200, 400, 550]) ink(x, 250, x + 1, 301);
    const c = findBlanks(g, W, H, DPI).filter((x) => x.kind === "line" && x.y > 240);
    expect(c).toHaveLength(3);
    expect(c.map((x) => x.x < 200 ? "a" : x.x < 400 ? "b" : "c")).toEqual(["a", "b", "c"]);
  });
  it("a tick box with clear space round it; a box squeezed between letters is not one", () => {
    const { g, ink } = page();
    square(ink, 500, 60, 12);
    square(ink, 300, 200, 12);
    ink(287, 200, 296, 211); // a letter just left of it
    ink(315, 200, 324, 211); // and just right
    const boxes = findBlanks(g, W, H, DPI).filter((x) => x.kind === "box");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ x: 500, y: 60, w: 12 });
  });
  it("a scanned underline in stepped, broken pieces is one blank", () => {
    const { g, ink } = page();
    ink(100, 150, 180, 151);
    ink(182, 151, 260, 152); // a one-pixel gap and a one-pixel step
    ink(262, 150, 330, 151);
    const lines = findBlanks(g, W, H, DPI).filter((x) => x.kind === "line");
    expect(lines).toHaveLength(1);
    expect(lines[0].w).toBeGreaterThan(220);
  });
  it("numbers top to bottom, left to right", () => {
    const { g, ink } = page();
    ink(300, 100, 500, 101);
    ink(50, 100, 250, 101);
    ink(50, 200, 250, 201);
    const c = findBlanks(g, W, H, DPI);
    expect(c.map((x) => [x.id, x.x < 280 ? "left" : "right", x.y < 150 ? "top" : "lower"])).toEqual([
      [1, "left", "top"],
      [2, "right", "top"],
      [3, "left", "lower"],
    ]);
  });
  it("a box in pixels becomes PDF points, origin bottom-left", () => {
    expect(toPdfRect({ x: 150, y: 300, w: 300, h: 30 }, 150, 792)).toEqual([72, 792 - 158.4, 144, 14.4]);
  });
});
