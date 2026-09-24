"use client";

import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/shared/callout";
import { STAGE_TONES, type StageToneKey } from "@/lib/ui/stage-colors";
import { cn } from "@/lib/utils";
import type { WorkflowPhaseItem } from "./types";

/** Phase bands map onto the stage colour ramp so Setup reads early and Closeout late. */
export function phaseToneKey(band: number): StageToneKey {
  if (band <= 200) return "phase-0";
  if (band <= 400) return "phase-1";
  if (band <= 600) return "phase-2";
  if (band <= 800) return "phase-3";
  if (band <= 900) return "phase-4";
  return "done";
}

export function PhaseSection({
  phase,
  children,
  visibleCount,
  defaultOpen,
  onAddTask,
  forceOpen,
}: {
  phase: WorkflowPhaseItem;
  children: React.ReactNode;
  /** Rows currently shown (after chip filtering); the header still reports the whole phase. */
  visibleCount: number;
  defaultOpen: boolean;
  onAddTask?: () => void;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const tone = STAGE_TONES[phaseToneKey(phase.band)];
  const p = phase.progress;
  const closed = p.done + p.skipped;
  const isOpen = forceOpen || open;

  return (
    <Collapsible open={isOpen} onOpenChange={setOpen} className="overflow-hidden rounded-lg border bg-white">
      <CollapsibleTrigger className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50">
        <span className={cn("h-8 w-1 shrink-0 rounded-full", tone.bar)} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{phase.name}</span>
            {phase.moduleKey !== "core" && <span className={cn("rounded-full px-1.5 text-[10px] font-medium", tone.pill)}>{phase.moduleName}</span>}
            {phase.conditionPermit === "REQUIRED" && <span className="rounded-full bg-tone-info-soft px-1.5 text-[10px] text-tone-info-fg">permit branch</span>}
            {phase.conditionPermit === "NOT_REQUIRED" && <span className="rounded-full bg-tone-neutral-soft px-1.5 text-[10px] text-tone-neutral-fg">no-permit branch</span>}
            {p.overdue > 0 && <span className="rounded-full bg-tone-danger-soft px-1.5 text-[10px] font-medium text-tone-danger-fg">{p.overdue} overdue</span>}
            {p.blocked > 0 && <span className="rounded-full bg-tone-warning-soft px-1.5 text-[10px] font-medium text-tone-warning-fg">{p.blocked} blocked</span>}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Progress value={closed} max={p.total} className="h-1 w-32" indicatorClassName={closed === p.total ? "bg-tone-success" : tone.bar} label={`${phase.name} ${closed} of ${p.total}`} />
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {closed}/{p.total}
              {p.ready > 0 && ` · ${p.ready} ready`}
              {p.notActive > 0 && ` · ${p.notActive} waiting`}
              {visibleCount !== p.total && ` · showing ${visibleCount}`}
            </span>
          </div>
        </div>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {phase.note && (
          <div className="px-3 pb-2">
            <Callout tone={phase.conditionPermit === "NOT_REQUIRED" ? "warning" : "info"}>{phase.note}</Callout>
          </div>
        )}
        <ul className="divide-y border-t">{children}</ul>
        {onAddTask && (
          <div className="border-t px-3 py-1.5">
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={onAddTask}>
              <Plus className="size-3.5" /> Add task to this phase
            </Button>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
