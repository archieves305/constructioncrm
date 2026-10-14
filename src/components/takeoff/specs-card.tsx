"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROOF_ASSEMBLY_LABEL, ROOF_ASSEMBLY_TYPES, type RoofAssemblyType } from "@/lib/takeoff/ai/schemas";
import { assemblyInForce, type TakeoffSpecs } from "@/lib/takeoff/specs";
import { cn } from "@/lib/utils";

/**
 * What the plans say about the roof assembly, as the model read it, and the
 * assembly a person chose when the plans name none. The choice never hides
 * the reading: a chosen assembly is shown as chosen, with who and when.
 */
export function SpecsCard({ specs, canEdit, onChoose, saving }: { specs: TakeoffSpecs | null; canEdit: boolean; onChoose: (choice: { type: RoofAssemblyType; description: string | null } | null) => void; saving: boolean }) {
  const [open, setOpen] = useState(true);
  const [choosing, setChoosing] = useState(false);
  const [type, setType] = useState<RoofAssemblyType>("TPO");
  const [description, setDescription] = useState("");
  const ai = specs?.roofing?.ai ?? null;
  const choice = specs?.roofing?.choice ?? null;
  const inForce = assemblyInForce(specs);
  if (!ai && !choice) return null;
  return (
    <div className="border-b text-sm" data-testid="specs-card">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Specifications</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs", inForce ? "bg-tone-success-soft text-tone-success-fg" : "bg-tone-warning-soft text-tone-warning-fg")}>
          {inForce ? ROOF_ASSEMBLY_LABEL[inForce.type] : "Assembly not specified"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          {choice ? (
            <p className="rounded bg-muted px-2 py-1 text-xs"><span className="font-medium">{ROOF_ASSEMBLY_LABEL[choice.type]}</span>{choice.description ? ` — ${choice.description}` : ""}<br /><span className="text-muted-foreground">chosen by {choice.byName || "a person"}, not from the plans</span></p>
          ) : null}
          {ai ? (
            ai.assembly ? (
              <p className="text-xs"><span className="font-medium">On the plans:</span> {ROOF_ASSEMBLY_LABEL[ai.assembly.type]}{ai.assembly.description ? ` — ${ai.assembly.description}` : ""}{ai.assembly.sourceSheets.length ? <span className="text-muted-foreground"> ({ai.assembly.sourceSheets.join(", ")})</span> : null}</p>
            ) : (
              <p className="text-xs text-tone-warning-fg">The plans do not name the roof covering or membrane. Choose an assembly or ask the architect.</p>
            )
          ) : null}
          {ai && (ai.deck || ai.insulation || ai.parapetDetail || ai.drainage || ai.slopes.length) ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
              {ai.deck && <><dt className="text-muted-foreground">Deck</dt><dd>{ai.deck}</dd></>}
              {ai.insulation && <><dt className="text-muted-foreground">Insulation</dt><dd>{ai.insulation}</dd></>}
              {ai.parapetDetail && <><dt className="text-muted-foreground">Parapet</dt><dd>{ai.parapetDetail}</dd></>}
              {ai.slopes.length ? <><dt className="text-muted-foreground">Slopes</dt><dd>{ai.slopes.join("; ")}</dd></> : null}
              {ai.drainage && <><dt className="text-muted-foreground">Drainage</dt><dd>{ai.drainage}</dd></>}
            </dl>
          ) : null}
          {ai?.notSpecified.length ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Not specified on the plans ({ai.notSpecified.length})</summary>
              <ul className="mt-1 list-disc pl-4">{ai.notSpecified.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </details>
          ) : null}
          {ai?.evidence ? <p className="text-xs text-muted-foreground">“{ai.evidence}”</p> : null}
          {canEdit && !choosing && (
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" onClick={() => { setType(choice?.type ?? "TPO"); setDescription(choice?.description ?? ""); setChoosing(true); }}>{choice ? "Change the chosen assembly" : "Choose an assembly"}</Button>
              {choice && <Button size="sm" variant="ghost" disabled={saving} onClick={() => onChoose(null)}>Clear the choice</Button>}
            </div>
          )}
          {canEdit && choosing && (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); onChoose({ type, description: description.trim() || null }); setChoosing(false); }}>
              <select className="h-8 w-full rounded border bg-background px-2 text-sm" value={type} onChange={(e) => setType(e.target.value as RoofAssemblyType)} aria-label="Roof assembly">
                {ROOF_ASSEMBLY_TYPES.map((t) => <option key={t} value={t}>{ROOF_ASSEMBLY_LABEL[t]}</option>)}
              </select>
              <Input className="h-8" placeholder="Product or note (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
              <div className="flex gap-1">
                <Button size="sm" type="submit" disabled={saving}>Use this assembly</Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setChoosing(false)}>Cancel</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
