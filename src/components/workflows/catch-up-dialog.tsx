"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCatchUp } from "./use-workflow";
import type { CatchUpData, SubjectLike, WorkflowPhaseItem } from "./types";

/**
 * "Complete this phase": the work was done away from the CRM, and the tab
 * should say so without a click per step. The list is a preview from the
 * server — what will complete, and what is held and why (a gate whose
 * record is missing, a step waiting on one that is not ticked). Blocking
 * gates arrive unticked: a gate is completed because somebody said so.
 */
export function CatchUpDialog({ subject, phase, open, onOpenChange }: { subject: SubjectLike; phase: WorkflowPhaseItem | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {open && phase && <Body subject={subject} phase={phase} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ subject, phase, onClose }: { subject: SubjectLike; phase: WorkflowPhaseItem; onClose: () => void }) {
  const preview = useCatchUp(subject, { silent: true });
  const apply = useCatchUp(subject);
  const [data, setData] = useState<CatchUpData | null>(null);
  const load = preview.mutateAsync;

  useEffect(() => {
    let live = true;
    load({ phaseKey: phase.key, dryRun: true })
      .then((d) => live && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [load, phase.key]);

  const steps = data?.steps ?? [];
  const willComplete = steps.filter((s) => s.state === "ok").length;
  const toggle = async (id: string, on: boolean) => {
    const next = steps.filter((s) => (s.id === id ? on : s.selected)).map((s) => s.id);
    setData(await load({ phaseKey: phase.key, taskIds: next, dryRun: true }));
  };
  // A step that can never be caught up, whatever is ticked.
  const fixed = (reason: string | null) => Boolean(reason && (reason.startsWith("Record the inspection") || reason.startsWith("Close the case")));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Complete “{phase.name}”</DialogTitle>
        <DialogDescription>
          For work that was done away from the CRM. Ticked steps are marked complete with their checklists; anything that waits on a record (a payment, a permit number, an inspection result) still needs
          that record.
        </DialogDescription>
      </DialogHeader>

      {!data ? (
        <div className="space-y-2">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every step in this phase is already closed.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2 px-3 py-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={s.selected && !fixed(s.reason)}
                disabled={preview.isPending || apply.isPending || fixed(s.reason)}
                onCheckedChange={(v) => void toggle(s.id, Boolean(v))}
                aria-label={s.title}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {s.blocking && <ShieldAlert className="size-3.5 shrink-0 text-tone-warning-fg" aria-label="Gate" />}
                  <span className={cn(s.state !== "ok" && "text-muted-foreground")}>{s.title}</span>
                </div>
                {s.state === "held" && <p className="text-xs text-tone-warning-fg">Held — {s.reason}</p>}
                {s.state === "unselected" && s.blocking && <p className="text-xs text-muted-foreground">A gate — tick it to complete it with the phase.</p>}
              </div>
              {s.state === "ok" && <span className="shrink-0 rounded-full bg-tone-success-soft px-1.5 text-[10px] font-medium text-tone-success-fg">will complete</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{data ? `${willComplete} of ${steps.length} will be completed` : ""}</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={!data || willComplete === 0 || apply.isPending || preview.isPending}
            onClick={async () => {
              await apply.mutateAsync({ phaseKey: phase.key, taskIds: steps.filter((s) => s.selected).map((s) => s.id) });
              onClose();
            }}
          >
            {apply.isPending ? "Completing…" : `Complete ${willComplete} step${willComplete === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </>
  );
}
