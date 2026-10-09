"use client";

import type { Pt } from "@/lib/takeoff/geometry";
import type { SnapTarget } from "@/lib/takeoff/snap";
import type { Measurement } from "../use-takeoff";

/**
 * Measurements drawn on the sheet overlay, in sheet points. Strokes stay the
 * same width at any zoom (`non-scaling-stroke`); labels scale with 1/s so
 * they read the same too. AI proposals are dashed until someone accepts
 * them (the OpenTakeoff "pencil" idea); approved shapes are solid.
 */
const COLOR: Record<string, string> = {
  roof: "#1d4ed8",
  "roof.parapet": "#4338ca",
  "roof.drain": "#d97706",
  "roof.overflow": "#7c3aed",
  "roof.scupper": "#d97706",
  "pipe.san": "#15803d",
  "pipe.vent": "#65a30d",
  "pipe.sewer": "#166534",
  "pipe.cw": "#0284c7",
  "pipe.hw": "#dc2626",
  "pipe.hwr": "#db2777",
  "pipe.gas": "#d97706",
  fixture: "#7c3aed",
  device: "#6b7280",
};

export function colorFor(metricKey: string): string {
  return COLOR[metricKey] ?? COLOR[metricKey.split(".")[0]] ?? "#475569";
}

const PROPOSED = new Set(["AI_GENERATED", "NEEDS_CLARIFICATION"]);

export function MeasurementShape({ m, scale, selected, hovered, dimmed, editable, onSelect, onHover, onVertexDrag, onVertexDragEnd }: {
  m: Measurement;
  scale: number;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
  editable: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onVertexDrag?: (id: string, index: number, p: Pt) => void;
  onVertexDragEnd?: (id: string) => void;
}) {
  const color = colorFor(m.metricKey);
  const pts = m.geometry.points;
  const dashed = PROPOSED.has(m.reviewStatus);
  const excluded = m.reviewStatus === "EXCLUDED";
  const width = (selected ? 3 : hovered ? 3 : 2);
  const common = {
    stroke: excluded ? "#9ca3af" : color,
    strokeWidth: width,
    strokeDasharray: excluded ? "2 4" : dashed ? "6 4" : undefined,
    vectorEffect: "non-scaling-stroke" as const,
    opacity: dimmed ? 0.3 : dashed ? 0.8 : 1,
    style: { cursor: "pointer" },
    onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); onSelect(m.id); },
    onPointerEnter: () => onHover(m.id),
    onPointerLeave: () => onHover(null),
  };
  const label = m.kind === "COUNT" ? null : `${m.label} · ${m.valueRaw.toLocaleString("en-US", { maximumFractionDigits: m.unit === "SF" ? 0 : 1 })} ${m.unit}`;
  const centre = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  const fontSize = 12 / scale;
  return (
    <g data-measurement={m.id} data-status={m.reviewStatus}>
      {m.kind === "AREA" && <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill={color} fillOpacity={dimmed ? 0.04 : selected ? 0.2 : 0.12} {...common} />}
      {m.kind === "LENGTH" && (
        <>
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" style={{ cursor: "pointer" }} onPointerDown={common.onPointerDown} onPointerEnter={common.onPointerEnter} onPointerLeave={common.onPointerLeave} />
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" {...common} />
        </>
      )}
      {m.kind === "COUNT" && pts[0] && (
        <g {...common}>
          <circle cx={pts[0].x} cy={pts[0].y} r={9 / scale} fill="white" fillOpacity={0.9} />
          <text x={pts[0].x} y={pts[0].y} fontSize={10 / scale} textAnchor="middle" dominantBaseline="central" fill={excluded ? "#9ca3af" : color} fontWeight={700} style={{ pointerEvents: "none" }}>{(m.attributes?.tag as string | undefined)?.slice(0, 3) ?? m.label.slice(0, 2).toUpperCase()}</text>
        </g>
      )}
      {label && (hovered || selected || scale > 0.8) && (
        <text x={centre.x} y={centre.y} fontSize={fontSize} textAnchor="middle" fill={color} fontWeight={600} style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 / scale, pointerEvents: "none" }}>{label}{dashed ? " ?" : ""}</text>
      )}
      {selected && editable && m.kind !== "COUNT" && pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={6 / scale} fill="white" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: "move" }} data-vertex={i}
          onPointerDown={(e) => { e.stopPropagation(); if (!onVertexDrag) return; const target = e.currentTarget as SVGCircleElement; target.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (!onVertexDrag || !(e.currentTarget as SVGCircleElement).hasPointerCapture(e.pointerId)) return; const svg = (e.currentTarget as SVGCircleElement).ownerSVGElement!; const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const sp = pt.matrixTransform(svg.getScreenCTM()!.inverse()); onVertexDrag(m.id, i, { x: Math.round(sp.x * 100) / 100, y: Math.round(sp.y * 100) / 100 }); }}
          onPointerUp={(e) => { (e.currentTarget as SVGCircleElement).releasePointerCapture(e.pointerId); onVertexDragEnd?.(m.id); }}
        />
      ))}
      {selected && editable && m.kind === "COUNT" && pts[0] && (
        <circle cx={pts[0].x} cy={pts[0].y} r={14 / scale} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" style={{ cursor: "move" }}
          onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (!onVertexDrag || !(e.currentTarget as SVGCircleElement).hasPointerCapture(e.pointerId)) return; const svg = (e.currentTarget as SVGCircleElement).ownerSVGElement!; const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const sp = pt.matrixTransform(svg.getScreenCTM()!.inverse()); onVertexDrag(m.id, 0, { x: Math.round(sp.x * 100) / 100, y: Math.round(sp.y * 100) / 100 }); }}
          onPointerUp={(e) => { (e.currentTarget as SVGCircleElement).releasePointerCapture(e.pointerId); onVertexDragEnd?.(m.id); }}
        />
      )}
    </g>
  );
}

/** The shape being drawn: committed vertices, the rubber-band edge to the cursor, and the snap target. */
export function DraftShape({ points, cursor, snap, kind, scale, color = "#0f172a" }: { points: Pt[]; cursor: Pt | null; snap: SnapTarget | null; kind: "area" | "linear" | "count" | "calibrate"; scale: number; color?: string }) {
  const all = cursor && kind !== "count" ? [...points, cursor] : points;
  return (
    <g data-testid="draft-shape" style={{ pointerEvents: "none" }}>
      {kind === "area" && all.length >= 2 && <polygon points={all.map((p) => `${p.x},${p.y}`).join(" ")} fill={color} fillOpacity={0.08} stroke={color} strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
      {(kind === "linear" || kind === "calibrate") && all.length >= 2 && <polyline points={all.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={kind === "calibrate" ? "#d97706" : color} strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4 / scale} fill={color} />)}
      {snap && cursor && (
        <g transform={`translate(${cursor.x} ${cursor.y})`}>
          <line x1={-8 / scale} x2={8 / scale} y1={0} y2={0} stroke="#16a34a" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <line y1={-8 / scale} y2={8 / scale} x1={0} x2={0} stroke="#16a34a" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {snap.kind !== "segment" && <circle r={5 / scale} fill="none" stroke="#16a34a" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        </g>
      )}
      {cursor && !snap && kind !== "count" && <circle cx={cursor.x} cy={cursor.y} r={3 / scale} fill={color} fillOpacity={0.6} />}
    </g>
  );
}
