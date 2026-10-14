"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/shared/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Sheet } from "./use-plan-sets";

/**
 * Which roof plans the AI analysis reads. A set often draws the same roof
 * twice (a general roof plan beside drainage plans of its parts), and every
 * sheet read gives its own proposals, so the person picks. Any other sheet of
 * the set may be ticked too and becomes a roof plan of the takeoff. The
 * specifications are always read. A sheet read before costs nothing again
 * unless it changed.
 */
export function AnalyzeDialog({ open, onOpenChange, roofPlans, otherSheets, sheetsRead, pending, onStart }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roofPlans: Sheet[];
  otherSheets: Sheet[];
  sheetsRead: readonly string[];
  pending: boolean;
  onStart: (planSheetIds: string[]) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(roofPlans.map((s) => s.id)));
  const toggle = (id: string, on: boolean) => setChosen((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
  const [showOthers, setShowOthers] = useState(false);
  const picked = [...roofPlans, ...otherSheets].filter((s) => chosen.has(s.id));
  const row = (s: Sheet) => (
    <li key={s.id}>
      <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
        <Checkbox checked={chosen.has(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} aria-label={s.sheetNumber ?? `Page ${s.pageNumber}`} />
        <span className="font-mono text-xs">{s.sheetNumber ?? `p.${s.pageNumber}`}</span>
        <span className="min-w-0 flex-1 truncate">{s.title ?? ""}</span>
        {!s.ptPerFt ? <span className="text-xs text-tone-warning-fg">not calibrated — skipped</span> : sheetsRead.includes(s.id) ? <span className="text-xs text-muted-foreground">read before</span> : null}
      </label>
    </li>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="analyze-dialog">
        <DialogHeader>
          <DialogTitle>Analyze with AI</DialogTitle>
          <DialogDescription>The model reads the specifications and labels the roof plans you tick. Code measures what it names; every row arrives as a proposal to review.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-2 text-sm">
          {roofPlans.length > 1 && <Callout tone="info" title="Tick each roof once">If one sheet shows the whole roof and others show parts of it, analyze one or the other — each sheet read gives its own areas and drains.</Callout>}
          {!roofPlans.length && <Callout tone="warning" title="No roof plan found">None of this takeoff&apos;s sheets is titled as a roof plan. Pick the sheet that draws the roof below.</Callout>}
          {roofPlans.length > 0 && <ul className="divide-y rounded-md border">{roofPlans.map(row)}</ul>}
          {otherSheets.length > 0 && (
            <div>
              {roofPlans.length > 0 && (
                <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers}>
                  {showOthers ? "Hide the other sheets" : `Show the other sheets (${otherSheets.length})`}
                </button>
              )}
              {(showOthers || !roofPlans.length) && <ul className="mt-1 max-h-60 divide-y overflow-y-auto rounded-md border">{otherSheets.map(row)}</ul>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!picked.length || pending} onClick={() => onStart(picked.map((s) => s.id))} data-testid="analyze-start">
            <Sparkles className="mr-1 h-3 w-3" /> Analyze {picked.length} sheet{picked.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
