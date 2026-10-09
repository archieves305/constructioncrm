/**
 * The viewer's coordinate model. Client-safe and pure.
 *
 * A sheet is laid out at its size in points; the view scales and translates
 * it. `s` is CSS px per sheet point; `tx`, `ty` are CSS px. Everything drawn
 * on the overlay is in sheet points, so no shape ever needs its own math.
 */
export type View = { s: number; tx: number; ty: number };
export type Pt = { x: number; y: number };
export type Rect = { width: number; height: number };

export const MAX_SCALE = 8;

export function screenToSheet(p: Pt, view: View): Pt {
  return { x: (p.x - view.tx) / view.s, y: (p.y - view.ty) / view.s };
}

export function sheetToScreen(p: Pt, view: View): Pt {
  return { x: p.x * view.s + view.tx, y: p.y * view.s + view.ty };
}

/** The view that shows the whole sheet centred in the container with a small margin. */
export function fitView(container: Rect, sheet: Rect, margin = 0.97): View {
  if (!container.width || !container.height || !sheet.width || !sheet.height) return { s: 1, tx: 0, ty: 0 };
  const s = Math.min(container.width / sheet.width, container.height / sheet.height) * margin;
  return { s, tx: (container.width - sheet.width * s) / 2, ty: (container.height - sheet.height * s) / 2 };
}

/** Zoom by `factor` keeping the sheet point under `anchor` (screen px) where it is. */
export function zoomAt(view: View, anchor: Pt, factor: number, minScale: number, maxScale = MAX_SCALE): View {
  const s = Math.min(maxScale, Math.max(minScale, view.s * factor));
  if (s === view.s) return view;
  const under = screenToSheet(anchor, view);
  return { s, tx: anchor.x - under.x * s, ty: anchor.y - under.y * s };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, tx: view.tx + dx, ty: view.ty + dy };
}

/** The render level to show: 144 dpi once the sheet is drawn larger than its 72 dpi pixels. */
export function renderLevel(view: View, devicePixelRatio: number): 72 | 144 {
  return view.s * devicePixelRatio > 1.1 ? 144 : 72;
}

export function polylineLength(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}

/** Shoelace area of a simple polygon, in square sheet points. */
export function polygonArea(points: readonly Pt[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}
