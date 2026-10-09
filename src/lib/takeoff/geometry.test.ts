import { describe, expect, it } from "vitest";
import { fitView, panBy, polygonArea, polylineLength, renderLevel, screenToSheet, sheetToScreen, zoomAt } from "./geometry";

describe("viewer geometry", () => {
  const sheet = { width: 2524.8, height: 1656.24 };

  it("fits the sheet in the container and round-trips points", () => {
    const view = fitView({ width: 1280, height: 800 }, sheet);
    expect(view.s).toBeCloseTo(Math.min(1280 / 2524.8, 800 / 1656.24) * 0.97, 5);
    expect(view.ty).toBeGreaterThan(0);
    for (const p of [{ x: 0, y: 0 }, { x: 1262.4, y: 828.12 }, { x: 2524.8, y: 1656.24 }]) {
      const back = screenToSheet(sheetToScreen(p, view), view);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
    const phone = fitView({ width: 400, height: 700 }, sheet);
    expect(phone.s).toBeLessThan(view.s);
    expect(fitView({ width: 0, height: 0 }, sheet)).toEqual({ s: 1, tx: 0, ty: 0 });
  });

  it("zooms about the anchor and clamps the scale", () => {
    const view = fitView({ width: 1280, height: 800 }, sheet);
    const anchor = { x: 640, y: 400 };
    const under = screenToSheet(anchor, view);
    const zoomed = zoomAt(view, anchor, 2, view.s);
    expect(zoomed.s).toBeCloseTo(view.s * 2, 6);
    const after = screenToSheet(anchor, zoomed);
    expect(after.x).toBeCloseTo(under.x, 6);
    expect(after.y).toBeCloseTo(under.y, 6);
    expect(zoomAt(view, anchor, 0.1, view.s).s).toBe(view.s);
    expect(zoomAt(view, anchor, 1000, view.s).s).toBe(8);
    expect(panBy(view, 10, -5)).toEqual({ ...view, tx: view.tx + 10, ty: view.ty - 5 });
  });

  it("picks the 144 dpi render once the sheet is drawn larger than its 72 dpi pixels", () => {
    expect(renderLevel({ s: 0.5, tx: 0, ty: 0 }, 2)).toBe(72);
    expect(renderLevel({ s: 0.6, tx: 0, ty: 0 }, 2)).toBe(144);
    expect(renderLevel({ s: 1.2, tx: 0, ty: 0 }, 1)).toBe(144);
  });

  it("measures lengths and areas in sheet points", () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 18 }, { x: 0, y: 18 }])).toBe(324);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 0, y: 18 }, { x: 18, y: 18 }, { x: 18, y: 0 }])).toBe(324);
  });
});
