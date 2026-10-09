"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Sheet } from "../use-plan-sets";
import { usePanZoom } from "./use-pan-zoom";

/**
 * One sheet: the server's PNG under a CSS transform, the 72 dpi level first
 * and the 144 dpi level faded in once the sheet is drawn larger than its
 * 72 dpi pixels. The same transform will carry the SVG overlay (M2); for now
 * the overlay slot is empty.
 */
export function PlanViewer({ sheet, className, overlay }: { sheet: Sheet | null; className?: string; overlay?: React.ReactNode }) {
  const size = sheet ? { width: sheet.widthPt, height: sheet.heightPt } : null;
  const { view, containerProps, fit, zoomBy, level } = usePanZoom(size);
  const want144 = level === 144 && !!sheet && !sheet.isRaster;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "f" || e.key === "F") fit();
      if (e.key === "+" || e.key === "=") zoomBy(1.25);
      if (e.key === "-") zoomBy(0.8);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit, zoomBy]);

  return (
    <div className={cn("relative h-full w-full bg-muted/40", className)}>
      <div {...containerProps} className="h-full w-full" data-testid="plan-viewer">
        {sheet && (
          <div
            data-testid="sheet-layer"
            style={{ position: "absolute", left: 0, top: 0, width: sheet.widthPt, height: sheet.heightPt, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, transformOrigin: "0 0", willChange: "transform", background: "white", boxShadow: "0 1px 6px rgba(0,0,0,0.18)" }}
          >
            <SheetImages key={sheet.id} sheet={sheet} want144={want144} />
            <svg viewBox={`0 0 ${sheet.widthPt} ${sheet.heightPt}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }} data-testid="sheet-overlay">
              {overlay}
            </svg>
          </div>
        )}
        {!sheet && <p className="flex h-full items-center justify-center text-sm text-muted-foreground">Pick a sheet</p>}
      </div>
      <div className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-md border bg-background/95 p-1 shadow-sm">
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Zoom out" onClick={() => zoomBy(0.8)}><Minus className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Fit sheet" onClick={fit}><Maximize2 className="h-4 w-4" /></Button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-background/90 px-2 py-0.5 text-xs text-muted-foreground">{Math.round(view.s * 100)}% · {level} dpi</div>
    </div>
  );
}


/** The two render levels of one sheet. Keyed by sheet id by the viewer, so a new sheet starts with fresh load state. */
function SheetImages({ sheet, want144 }: { sheet: Sheet; want144: boolean }) {
  const [loaded72, setLoaded72] = useState(false);
  const [loaded144, setLoaded144] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      {!loaded72 && !failed && <Skeleton className="absolute inset-0" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/plan-sheets/${sheet.id}/render?dpi=72`}
        alt={sheet.sheetNumber ? `Sheet ${sheet.sheetNumber}` : `Page ${sheet.pageNumber}`}
        data-level="72"
        draggable={false}
        onLoad={() => setLoaded72(true)}
        onError={() => setFailed(true)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      {want144 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/plan-sheets/${sheet.id}/render?dpi=144`}
          alt=""
          data-level="144"
          draggable={false}
          onLoad={() => setLoaded144(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: loaded144 ? 1 : 0, transition: "opacity 150ms" }}
        />
      )}
      {failed && <p className="absolute inset-x-0 top-3 text-center text-sm text-tone-danger-fg" style={{ fontSize: 24 }}>Couldn&apos;t render this sheet.</p>}
    </>
  );
}
