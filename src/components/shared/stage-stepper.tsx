"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildStageToneMap, PARKED_STAGE_NAMES, type StageLike } from "@/lib/ui/stage-colors";

type Stage = StageLike & { id: string };

/**
 * The pipeline as a row of pills: done ones tinted, the current one solid,
 * the rest muted. Clicking any other stage asks first — a stage change moves
 * money and spawns tasks on jobs, so it should never be a mis-tap.
 */
export function StageStepper({
  stages,
  currentStageId,
  onChange,
  entityLabel,
  disabled,
  confirmNote,
  className,
}: {
  stages: Stage[];
  currentStageId: string;
  onChange: (stageId: string) => void;
  entityLabel: string;
  disabled?: boolean;
  confirmNote?: (from: Stage, to: Stage) => React.ReactNode;
  className?: string;
}) {
  const [pending, setPending] = useState<Stage | null>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const tones = buildStageToneMap(stages);

  const ordered = [...stages].sort((a, b) => a.stageOrder - b.stageOrder);
  const progression = ordered.filter((s) => !s.isClosed && !s.isLost && !s.isWon && !PARKED_STAGE_NAMES.has(s.name));
  const terminal = ordered.filter((s) => s.isClosed || s.isLost || s.isWon || PARKED_STAGE_NAMES.has(s.name));
  const current = stages.find((s) => s.id === currentStageId);
  const currentIndex = progression.findIndex((s) => s.id === currentStageId);
  // Won / Closed means the whole progression is behind us; Lost / On Hold does not.
  const allDone = Boolean(current && (current.isWon || current.isClosed) && !current.isLost);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [currentStageId]);

  function pill(s: Stage, i: number | null) {
    const tone = tones.get(s.id)!;
    const isCurrent = s.id === currentStageId;
    const done = i !== null && (allDone || (currentIndex >= 0 && i < currentIndex));
    return (
      <button
        key={s.id}
        ref={isCurrent ? currentRef : undefined}
        type="button"
        disabled={disabled || isCurrent}
        aria-current={isCurrent ? "step" : undefined}
        title={isCurrent ? `Current stage: ${s.name}` : `Move to ${s.name}`}
        onClick={() => setPending(s)}
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition",
          isCurrent
            ? cn(tone.solid, "ring-2 shadow-sm", tone.ring)
            : done
              ? cn(tone.pill, "hover:brightness-95")
              : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-800",
          "disabled:cursor-default disabled:opacity-100",
        )}
      >
        {done && <Check className="size-3" />}
        {s.name}
      </button>
    );
  }

  return (
    <>
      <div className={cn("flex items-center gap-1 overflow-x-auto py-1 [scrollbar-width:thin]", className)}>
        {progression.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1">
            {i > 0 && <span className={cn("h-px w-3 shrink-0", allDone || i <= currentIndex ? tones.get(s.id)!.bar : "bg-gray-200")} />}
            {pill(s, i)}
          </span>
        ))}
        {terminal.length > 0 && <Separator orientation="vertical" className="mx-2 !h-5" />}
        {terminal.map((s) => pill(s, null))}
      </div>

      <Dialog open={Boolean(pending)} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Move {entityLabel} to {pending?.name}?
            </DialogTitle>
            <DialogDescription>
              {current ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tones.get(current.id)?.pill)}>{current.name}</span>
                  <span className="text-muted-foreground">→</span>
                  {pending && (
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tones.get(pending.id)?.pill)}>{pending.name}</span>
                  )}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {pending && current && pending.stageOrder < current.stageOrder && !pending.isClosed && (
            <p className="text-sm text-tone-warning-fg">This moves the record backwards in the pipeline.</p>
          )}
          {pending && current && confirmNote && <div className="text-sm text-muted-foreground">{confirmNote(current, pending)}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={() => {
                if (pending) onChange(pending.id);
                setPending(null);
              }}
            >
              Move to {pending?.name}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
