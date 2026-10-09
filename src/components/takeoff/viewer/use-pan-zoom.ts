"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fitView, panBy, renderLevel, screenToSheet, zoomAt, type Pt, type View } from "@/lib/takeoff/geometry";

/**
 * Pan and zoom for the sheet viewer, with no library: pointer events (mouse,
 * touch, pen), wheel and trackpad pinch zoom about the cursor, two-finger
 * pinch, double-click to zoom in, `F` to fit. The view it returns is the one
 * transform the image and the SVG overlay share.
 */
export function usePanZoom(sheet: { width: number; height: number } | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const pointers = useRef(new Map<number, Pt>());
  const drag = useRef<{ last: Pt; pinchDist: number | null; moved: boolean } | null>(null);

  // depend on the numbers, not the object: a caller that builds `sheet` inline
  // would otherwise refit (and re-render) on every render
  const sheetW = sheet?.width ?? 0;
  const sheetH = sheet?.height ?? 0;
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || !sheetW || !sheetH) return;
    const rect = { width: el.clientWidth, height: el.clientHeight };
    const v = fitView(rect, { width: sheetW, height: sheetH });
    setSize(rect);
    setFitScale(v.s);
    setView(v);
  }, [sheetW, sheetH]);

  // fit on mount, on sheet change and when the container is resized
  useEffect(() => {
    fit();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const local = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const r = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }, []);

  // React's onWheel is passive, so it cannot stop the page from scrolling: the
  // listener goes on the element itself with passive: false.
  const fitScaleRef = useRef(fitScale);
  useEffect(() => { fitScaleRef.current = fitScale; }, [fitScale]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      if (e.shiftKey && !e.ctrlKey) { setView((v) => panBy(v, -e.deltaY, 0)); return; }
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      setView((v) => zoomAt(v, p, factor, fitScaleRef.current * 0.5));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [local]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    drag.current = { last: pts.length === 2 ? mid(pts[0], pts[1]) : local(e), pinchDist: pts.length === 2 ? dist(pts[0], pts[1]) : null, moved: false };
  }, [local]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !drag.current) return;
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && drag.current.pinchDist) {
      const d = dist(pts[0], pts[1]);
      const m = mid(pts[0], pts[1]);
      const factor = d / drag.current.pinchDist;
      setView((v) => panBy(zoomAt(v, m, factor, fitScale * 0.5), m.x - drag.current!.last.x, m.y - drag.current!.last.y));
      drag.current = { last: m, pinchDist: d, moved: true };
      return;
    }
    const p = pts[0];
    const dx = p.x - drag.current.last.x, dy = p.y - drag.current.last.y;
    if (Math.abs(dx) + Math.abs(dy) > 0) {
      setView((v) => panBy(v, dx, dy));
      drag.current = { ...drag.current, last: p, moved: true };
    }
  }, [local, fitScale]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) drag.current = null;
    else { const pts = [...pointers.current.values()]; drag.current = { last: pts[0], pinchDist: null, moved: true }; }
  }, []);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const p = local(e);
    setView((v) => zoomAt(v, p, 2, fitScale * 0.5));
  }, [local, fitScale]);

  const zoomBy = useCallback((factor: number) => {
    setView((v) => zoomAt(v, { x: size.width / 2, y: size.height / 2 }, factor, fitScale * 0.5));
  }, [size, fitScale]);

  const containerProps = {
    ref: containerRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onDoubleClick,
    style: { touchAction: "none" as const, userSelect: "none" as const, overflow: "hidden" as const, position: "relative" as const, cursor: "grab" as const },
  };

  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return { view, setView, containerRef, containerProps, fit, zoomBy, fitScale, level: renderLevel(view, dpr), screenToSheet: (p: Pt) => screenToSheet(p, view), size };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
