"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Pt } from "@/lib/takeoff/geometry";
import { computeValue, formatValue, minPoints } from "@/lib/takeoff/measurement-value";
import type { MeasurementKindName } from "@/lib/takeoff/metrics";
import type { SnapIndex, SnapTarget } from "@/lib/takeoff/snap";

export type Tool = "select" | "area" | "linear" | "count" | "calibrate";

export const TOOL_KIND: Record<Exclude<Tool, "select" | "calibrate">, MeasurementKindName> = { area: "AREA", linear: "LENGTH", count: "COUNT" };

/** What is being drawn: the committed vertices and the cursor's next one. */
export type Draft = { tool: Tool; points: Pt[]; cursor: Pt | null; snap: SnapTarget | null };

/**
 * Drawing state for the overlay: vertices accumulate on taps (snapped when
 * the index has something close), the cursor shows the next edge, Enter or a
 * double-tap finishes, Backspace undoes a vertex, Escape cancels. A count
 * tool commits on every tap; the calibrate tool commits after two.
 */
export function useDrawing(input: {
  tool: Tool;
  snapIndex: SnapIndex | null;
  snapOn: boolean;
  /** CSS px per sheet point — tolerances are given in screen px. */
  scale: number;
  ptPerFt: number | null;
  onCommit: (tool: Tool, points: Pt[]) => void;
}) {
  const { tool, snapIndex, snapOn, scale, ptPerFt, onCommit } = input;
  const [state, setDraft] = useState<Draft>({ tool, points: [], cursor: null, snap: null });
  // a tool change drops any half-drawn shape: a draft made with another tool reads as empty
  const draft: Draft = state.tool === tool ? state : { tool, points: [], cursor: null, snap: null };
  const commitRef = useRef(onCommit);
  useEffect(() => { commitRef.current = onCommit; }, [onCommit]);

  const snapped = useCallback((p: Pt, vertices: Pt[]): { point: Pt; snap: SnapTarget | null } => {
    if (!snapOn || !snapIndex) return { point: p, snap: null };
    const s = snapIndex.snap(p, 10 / scale, 6 / scale, vertices);
    return s ? { point: s.point, snap: s } : { point: p, snap: null };
  }, [snapOn, snapIndex, scale]);

  const onHover = useCallback((p: Pt | null) => {
    if (tool === "select") return;
    setDraft((d0) => {
      const d = d0.tool === tool ? d0 : { tool, points: [], cursor: null, snap: null };
      if (!p) return d.cursor ? { ...d, cursor: null, snap: null } : d;
      const s = snapped(p, d.points);
      return { ...d, cursor: s.point, snap: s.snap };
    });
  }, [tool, snapped]);

  const finish = useCallback((points: Pt[]) => {
    const kind = tool === "calibrate" ? null : TOOL_KIND[tool as keyof typeof TOOL_KIND];
    const need = tool === "calibrate" ? 2 : kind ? minPoints(kind) : 1;
    if (points.length >= need) commitRef.current(tool, points);
    setDraft({ tool, points: [], cursor: null, snap: null });
  }, [tool]);

  const onTap = useCallback((p: Pt) => {
    if (tool === "select") return;
    const s = snapped(p, draft.points);
    if (tool === "count") { finish([s.point]); return; }
    // closing an area by tapping its first vertex
    if (tool === "area" && draft.points.length >= 3 && Math.hypot(s.point.x - draft.points[0].x, s.point.y - draft.points[0].y) < 8 / scale) { finish(draft.points); return; }
    const points = [...draft.points, s.point];
    if (tool === "calibrate" && points.length === 2) { finish(points); return; }
    setDraft({ tool, points, cursor: s.point, snap: s.snap });
  }, [tool, draft.points, snapped, finish, scale]);

  const onDoubleTap = useCallback((): boolean => {
    if (tool === "area" || tool === "linear") { finish(draft.points); return true; }
    return false;
  }, [tool, draft.points, finish]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (tool === "select") return;
      if (e.key === "Escape") setDraft({ tool, points: [], cursor: null, snap: null });
      else if (e.key === "Enter") { e.preventDefault(); finish(draft.points); }
      else if (e.key === "Backspace") { e.preventDefault(); setDraft((d) => (d.tool === tool ? { ...d, points: d.points.slice(0, -1) } : d)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, draft.points, finish]);

  // the live readout: the shape as it stands, cursor included
  const livePoints = draft.cursor && tool !== "count" ? [...draft.points, draft.cursor] : draft.points;
  const kind = tool in TOOL_KIND ? TOOL_KIND[tool as keyof typeof TOOL_KIND] : null;
  const value = kind && kind !== "COUNT" ? computeValue(kind, { points: livePoints }, ptPerFt) : null;
  const readout = tool === "calibrate" && livePoints.length === 2 ? `${Math.hypot(livePoints[1].x - livePoints[0].x, livePoints[1].y - livePoints[0].y).toFixed(1)} pt` : value ? formatValue(value.valueRaw, value.unit) : kind && kind !== "COUNT" && livePoints.length >= 2 && !ptPerFt ? "Not calibrated" : null;

  return { draft, livePoints, readout, onTap, onHover, onDoubleTap, cancel: () => setDraft({ tool, points: [], cursor: null, snap: null }) };
}
