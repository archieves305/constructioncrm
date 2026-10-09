"use client";

import { Hash, Magnet, MousePointer2, Pentagon, Ruler, Spline } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Tool } from "./use-drawing";

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { tool: "select", label: "Select", key: "V", icon: MousePointer2 },
  { tool: "area", label: "Area", key: "A", icon: Pentagon },
  { tool: "linear", label: "Linear", key: "L", icon: Spline },
  { tool: "count", label: "Count", key: "C", icon: Hash },
  { tool: "calibrate", label: "Calibrate", key: "K", icon: Ruler },
];

export function DrawToolbar({ tool, onTool, snap, onSnap, snapAvailable, disabledReason }: { tool: Tool; onTool: (t: Tool) => void; snap: boolean; onSnap: (v: boolean) => void; snapAvailable: boolean; disabledReason?: string | null }) {
  return (
    <div className="absolute left-3 top-3 flex flex-col gap-1 rounded-md border bg-background/95 p-1 shadow-sm" data-testid="draw-toolbar">
      {TOOLS.map(({ tool: t, label, key, icon: Icon }) => (
        <Button key={t} size="icon" variant={tool === t ? "default" : "ghost"} className="h-8 w-8" title={`${label} (${key})`} aria-label={label} aria-pressed={tool === t} disabled={!!disabledReason && t !== "select" && t !== "calibrate"} onClick={() => onTool(t)}>
          <Icon className="h-4 w-4" />
        </Button>
      ))}
      <div className="my-0.5 border-t" />
      <Button size="icon" variant={snap ? "default" : "ghost"} className={cn("h-8 w-8", !snapAvailable && "opacity-50")} title={snapAvailable ? `Snap to drawn lines (S)` : "No vector geometry on this sheet"} aria-label="Snap" aria-pressed={snap} disabled={!snapAvailable} onClick={() => onSnap(!snap)}>
        <Magnet className="h-4 w-4" />
      </Button>
    </div>
  );
}
