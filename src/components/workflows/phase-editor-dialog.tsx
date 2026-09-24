"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Callout } from "@/components/shared/callout";
import { LEGAL_NO_PERMIT_WARNING, PHASE_BANDS } from "@/lib/workflows/templates/types";
import type { EditorPhase, PhaseInput } from "./types";

export const BAND_OPTIONS: { value: number; label: string }[] = [
  { value: PHASE_BANDS.JOB_SETUP, label: "Job setup (100)" },
  { value: PHASE_BANDS.PRECONSTRUCTION, label: "Preconstruction (200)" },
  { value: PHASE_BANDS.SCOPE_REVIEW, label: "Scope review (300)" },
  { value: PHASE_BANDS.PERMITTING, label: "Permitting (400)" },
  { value: PHASE_BANDS.PROCUREMENT, label: "Procurement (500)" },
  { value: PHASE_BANDS.PRODUCTION_READINESS, label: "Production readiness (600)" },
  { value: PHASE_BANDS.CORE_PRODUCTION, label: "Production (700)" },
  { value: PHASE_BANDS.INSTALLATION, label: "Installation / construction (800)" },
  { value: PHASE_BANDS.TRADE_CLOSEOUT, label: "Trade closeout (900)" },
  { value: PHASE_BANDS.CORE_CLOSEOUT, label: "Final closeout (1000)" },
];

export function bandLabel(band: number): string {
  return BAND_OPTIONS.find((b) => b.value === band)?.label ?? `band ${band}`;
}

/** Add or edit a phase: name, ordering band, permit branch, note. */
export function PhaseEditorDialog({ phase, open, onOpenChange, onSave, pending }: { phase: EditorPhase | null; open: boolean; onOpenChange: (o: boolean) => void; onSave: (input: PhaseInput) => void; pending?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">{open && <Body phase={phase} onCancel={() => onOpenChange(false)} onSave={onSave} pending={pending} />}</DialogContent>
    </Dialog>
  );
}

function Body({ phase, onCancel, onSave, pending }: { phase: EditorPhase | null; onCancel: () => void; onSave: (input: PhaseInput) => void; pending?: boolean }) {
  const [name, setName] = useState(phase?.name ?? "");
  const [band, setBand] = useState<number>(phase?.band ?? PHASE_BANDS.SCOPE_REVIEW);
  const [permit, setPermit] = useState<"none" | "REQUIRED" | "NOT_REQUIRED">(phase?.conditionPermit ?? "none");
  const [note, setNote] = useState(phase?.note ?? "");
  const [description, setDescription] = useState(phase?.description ?? "");

  function choosePermit(v: "none" | "REQUIRED" | "NOT_REQUIRED") {
    setPermit(v);
    if (v === "NOT_REQUIRED" && !note.trim()) setNote(LEGAL_NO_PERMIT_WARNING);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{phase ? "Edit phase" : "New phase"}</DialogTitle>
        <DialogDescription>Phases group steps and set where they sit when Core and trades interleave.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label htmlFor="ph-name" className="text-xs">
            Name
          </Label>
          <Input id="ph-name" autoFocus className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Roofing Procurement" />
          {phase && <p className="mt-0.5 text-[11px] text-muted-foreground">Key: {phase.key}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Ordering band</Label>
            <Select value={String(band)} onValueChange={(v: string | null) => v && setBand(Number(v))}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => bandLabel(Number(v))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {BAND_OPTIONS.map((b) => (
                  <SelectItem key={b.value} value={String(b.value)}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Permit branch</Label>
            <Select value={permit} onValueChange={(v: string | null) => v && choosePermit(v as typeof permit)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => (v === "REQUIRED" ? "Only when a permit is required" : v === "NOT_REQUIRED" ? "Only when no permit is required" : "Always")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Always</SelectItem>
                <SelectItem value="REQUIRED">Only when a permit is required</SelectItem>
                <SelectItem value="NOT_REQUIRED">Only when no permit is required</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {permit === "NOT_REQUIRED" && <Callout tone="warning">A no-permit phase must carry the legal warning as its note. The standard wording is filled in below.</Callout>}
        <div>
          <Label htmlFor="ph-note" className="text-xs">
            Note (shown under the phase heading)
          </Label>
          <Textarea id="ph-note" rows={2} className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ph-desc" className="text-xs">
            Description (optional)
          </Label>
          <Textarea id="ph-desc" rows={2} className="mt-1" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!name.trim() || pending} onClick={() => onSave({ name: name.trim(), band, conditionPermit: permit === "none" ? null : permit, note: note.trim() || null, description: description.trim() || null })}>
          {pending ? "Saving…" : phase ? "Save phase" : "Add phase"}
        </Button>
      </div>
    </>
  );
}
