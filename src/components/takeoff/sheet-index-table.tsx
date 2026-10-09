"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DISCIPLINE_LABEL, DISCIPLINES, type PlanDisciplineName } from "@/lib/takeoff/types";
import { cn } from "@/lib/utils";
import { CalibrationBadge, ConfidencePill, TextBadge } from "./badges";
import { errorText, useUpdateSheet, type Sheet } from "./use-plan-sets";

type Field = "sheetNumber" | "title" | "scaleText";

/**
 * Every sheet of the set with the index code read and a person's corrections
 * in place: click a number, title or scale to edit it; pick a discipline from
 * the list. A corrected row says so, and keeps what code detected on hover.
 */
export function SheetIndexTable({ planSetId, sheets, canEdit, compact = false, currentSheetId, onOpen }: { planSetId: string; sheets: Sheet[]; canEdit: boolean; compact?: boolean; currentSheetId?: string | null; onOpen?: (sheetId: string) => void }) {
  const update = useUpdateSheet(planSetId);
  const [editing, setEditing] = useState<{ id: string; field: Field; value: string } | null>(null);

  function commit() {
    if (!editing) return;
    const sheet = sheets.find((s) => s.id === editing.id);
    const value = editing.value.trim();
    const current = sheet?.[editing.field] ?? "";
    setEditing(null);
    if (!sheet || value === (current ?? "")) return;
    update.mutate({ id: editing.id, patch: { [editing.field]: value || null } }, { onError: (err) => toast.error(errorText(err)) });
  }

  function cell(s: Sheet, field: Field, placeholder: string, mono = false) {
    const active = editing?.id === s.id && editing.field === field;
    if (active) {
      return (
        <Input
          autoFocus
          className={cn("h-7 text-sm", mono && "font-mono")}
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(null); }}
        />
      );
    }
    const value = s[field];
    const detected = s.detected?.[field === "scaleText" ? "scaleText" : field] ?? null;
    return (
      <button
        type="button"
        disabled={!canEdit}
        title={s.corrected && detected && detected !== value ? `Detected: ${detected}` : undefined}
        className={cn("w-full truncate rounded px-1 py-0.5 text-left", canEdit && "hover:bg-muted", !value && "text-muted-foreground italic", mono && "font-mono")}
        onClick={() => canEdit && setEditing({ id: s.id, field, value: value ?? "" })}
      >
        {value || placeholder}
      </button>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border" data-testid="sheet-index">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            {!compact && <TableHead className="w-24">Preview</TableHead>}
            <TableHead className="w-24">Sheet</TableHead>
            <TableHead>Title</TableHead>
            <TableHead className="w-40">Discipline</TableHead>
            <TableHead className="w-32">Scale</TableHead>
            <TableHead className="w-36">Calibration</TableHead>
            {!compact && <TableHead className="w-24">Text</TableHead>}
            {!compact && <TableHead className="w-20">Index</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sheets.map((s) => (
            <TableRow key={s.id} className={cn(currentSheetId === s.id && "bg-muted/60")} data-sheet-id={s.id}>
              <TableCell className="text-muted-foreground">{s.pageNumber}</TableCell>
              {!compact && (
                <TableCell>
                  {s.rendered ? (
                    <Link href={`/plans/${planSetId}?sheet=${s.id}`} onClick={(e) => { if (onOpen) { e.preventDefault(); onOpen(s.id); } }} className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/plan-sheets/${s.id}/render?dpi=72`} alt="" loading="lazy" className="h-14 w-20 rounded border object-cover object-left-top" />
                    </Link>
                  ) : (
                    <div className="h-14 w-20 rounded border bg-muted" />
                  )}
                </TableCell>
              )}
              <TableCell>{cell(s, "sheetNumber", "—", true)}</TableCell>
              <TableCell>
                {onOpen || compact ? (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">{cell(s, "title", "Untitled")}</div>
                    {onOpen && <button type="button" className="text-xs text-primary hover:underline" onClick={() => onOpen(s.id)}>Open</button>}
                  </div>
                ) : (
                  cell(s, "title", "Untitled")
                )}
              </TableCell>
              <TableCell>
                <select
                  className={cn("h-7 w-full rounded border bg-background px-1 text-sm", !canEdit && "appearance-none border-transparent bg-transparent")}
                  disabled={!canEdit}
                  value={s.discipline}
                  onChange={(e) => update.mutate({ id: s.id, patch: { discipline: e.target.value as PlanDisciplineName } }, { onError: (err) => toast.error(errorText(err)) })}
                >
                  {DISCIPLINES.map((d) => <option key={d} value={d}>{DISCIPLINE_LABEL[d]}</option>)}
                </select>
              </TableCell>
              <TableCell>{cell(s, "scaleText", "No scale")}</TableCell>
              <TableCell><CalibrationBadge source={s.scaleSource} isRaster={s.isRaster} /></TableCell>
              {!compact && <TableCell><TextBadge isRaster={s.isRaster} /></TableCell>}
              {!compact && <TableCell><span className="flex items-center gap-1"><ConfidencePill value={s.indexConfidence} />{s.corrected && <span className="text-xs text-muted-foreground" title="Corrected by a person">✎</span>}</span></TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
