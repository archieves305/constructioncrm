"use client";

import { useRef, useState } from "react";

/**
 * A stored inspection photo with numbered boxes drawn over it. Boxes are in
 * the photo's own pixels (the SVG's viewBox is the photo's size), so they line
 * up at any display size. With `onDraw`, dragging on the photo draws a box.
 */
export type OverlayBox = { key: string; n: number; x1: number; y1: number; x2: number; y2: number; tone: "critical" | "major" | "minor" | "muted"; active?: boolean };

const STROKE: Record<OverlayBox["tone"], string> = {
  critical: "#dc2626",
  major: "#ea580c",
  minor: "#ca8a04",
  muted: "#64748b",
};

export function PhotoWithBoxes({
  url,
  width,
  height,
  boxes,
  onSelect,
  onDraw,
  alt,
  className,
}: {
  url: string;
  width: number;
  height: number;
  boxes: OverlayBox[];
  onSelect?: (key: string) => void;
  onDraw?: (b: { x1: number; y1: number; x2: number; y2: number }) => void;
  alt: string;
  className?: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const stroke = Math.max(3, Math.round(Math.max(width, height) / 300));
  const label = Math.max(28, Math.round(Math.max(width, height) / 40));

  const toPhoto = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  };

  return (
    <div className={`relative w-full ${className ?? ""}`} style={{ aspectRatio: `${width} / ${height}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated file route, sized by its own pixels */}
      <img src={url} alt={alt} className="absolute inset-0 h-full w-full rounded object-contain" draggable={false} />
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        className={`absolute inset-0 h-full w-full ${onDraw ? "cursor-crosshair touch-none" : ""}`}
        onPointerDown={onDraw ? (e) => { const p = toPhoto(e); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); } : undefined}
        onPointerMove={onDraw && drag ? (e) => { const p = toPhoto(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } : undefined}
        onPointerUp={onDraw && drag ? () => { const b = { x1: Math.min(drag.x0, drag.x1), y1: Math.min(drag.y0, drag.y1), x2: Math.max(drag.x0, drag.x1), y2: Math.max(drag.y0, drag.y1) }; setDrag(null); if (b.x2 - b.x1 > 8 && b.y2 - b.y1 > 8) onDraw(b); } : undefined}
        role="img"
        aria-label={`${alt}: ${boxes.length} marked`}
      >
        {boxes.map((b) => (
          <g key={b.key} onClick={onSelect && !onDraw ? () => onSelect(b.key) : undefined} className={onSelect && !onDraw ? "cursor-pointer" : undefined}>
            <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill={b.active ? `${STROKE[b.tone]}22` : "transparent"} stroke={STROKE[b.tone]} strokeWidth={b.active ? stroke * 1.6 : stroke} strokeDasharray={b.tone === "muted" ? `${stroke * 3} ${stroke * 2}` : undefined} />
            <rect x={b.x1} y={Math.max(0, b.y1 - label)} width={label} height={label} fill={STROKE[b.tone]} />
            <text x={b.x1 + label / 2} y={Math.max(0, b.y1 - label) + label * 0.74} textAnchor="middle" fontSize={label * 0.72} fontWeight={700} fill="#fff">
              {b.n}
            </text>
          </g>
        ))}
        {drag ? (
          <rect x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} fill="#2563eb22" stroke="#2563eb" strokeWidth={stroke} />
        ) : null}
      </svg>
    </div>
  );
}
