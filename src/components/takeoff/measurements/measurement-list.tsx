"use client";

import { useState } from "react";
import { Check, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { formatValue } from "@/lib/takeoff/measurement-value";
import { METRICS, type TradeName, type Unit } from "@/lib/takeoff/metrics";
import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "@/lib/ui/tones";
import { colorFor } from "../viewer/shapes";
import type { Measurement } from "../use-takeoff";

const STATUS: Record<string, { tone: Tone; label: string }> = {
  AI_GENERATED: { tone: "info", label: "AI proposal" },
  REVIEWED: { tone: "success", label: "Reviewed" },
  MODIFIED: { tone: "success", label: "Modified" },
  APPROVED: { tone: "success", label: "Approved" },
  EXCLUDED: { tone: "neutral", label: "Excluded" },
  NEEDS_CLARIFICATION: { tone: "warning", label: "Needs clarification" },
};

export function ReviewStatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: "neutral" as Tone, label: status };
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", toneClasses(s.tone).pill)}>{s.label}</span>;
}

export function ConfidenceBadge({ value }: { value: string }) {
  const tone: Tone = value === "HIGH" ? "success" : value === "MEDIUM" ? "info" : "warning";
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", toneClasses(tone).pill)}>{value === "LOW" ? "Review required" : value.toLowerCase()}</span>;
}

/** The measurements on the current sheet (or all), grouped by what they are, with totals per group. */
export function MeasurementList({ measurements, trade, selectedId, onSelect, onHover, sheetFilter }: { measurements: Measurement[]; trade: TradeName; selectedId: string | null; onSelect: (id: string | null) => void; onHover: (id: string | null) => void; sheetFilter: string | null }) {
  const rows = sheetFilter ? measurements.filter((m) => m.planSheetId === sheetFilter) : measurements;
  if (!rows.length) return <EmptyState title="Nothing measured here yet" description="Pick a tool on the sheet to draw an area, a run or a count." className="py-8" />;
  const groups = new Map<string, Measurement[]>();
  for (const m of rows) { const g = groups.get(m.metricKey); if (g) g.push(m); else groups.set(m.metricKey, [m]); }
  const metricLabel = (key: string) => METRICS[trade].find((d) => d.key === key)?.label ?? key;
  return (
    <div className="divide-y text-sm" data-testid="measurement-list">
      {[...groups.entries()].map(([key, ms]) => {
        const live = ms.filter((m) => m.reviewStatus !== "EXCLUDED");
        const total = live.reduce((a, m) => a + m.valueRaw, 0);
        return (
          <div key={key} className="py-1">
            <div className="flex items-center justify-between px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
              <span className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full" style={{ background: colorFor(key) }} />{metricLabel(key)}</span>
              <span>{formatValue(total, (live[0]?.unit ?? ms[0].unit) as Unit)}</span>
            </div>
            {ms.map((m) => (
              <button key={m.id} type="button" onClick={() => onSelect(m.id === selectedId ? null : m.id)} onMouseEnter={() => onHover(m.id)} onMouseLeave={() => onHover(null)}
                className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted", selectedId === m.id && "bg-muted", m.reviewStatus === "EXCLUDED" && "opacity-60")} data-measurement-row={m.id}>
                <span className="min-w-0 flex-1 truncate">{m.label}{!sheetFilter && m.planSheet.sheetNumber ? <span className="text-xs text-muted-foreground"> · {m.planSheet.sheetNumber}</span> : null}</span>
                <span className="tabular-nums">{formatValue(m.valueRaw, m.unit as Unit)}</span>
                {m.confidence === "LOW" && <span className="text-tone-warning-fg" title="Review required">⚠</span>}
                {(m.reviewStatus === "AI_GENERATED" || m.reviewStatus === "NEEDS_CLARIFICATION") && <span className="text-xs text-muted-foreground">?</span>}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** One measurement: edit its label, review it, exclude or delete it. */
export function MeasurementInspector({ m, trade, canEdit, canApprove, onPatch, onDelete, onClose }: { m: Measurement; trade: TradeName; canEdit: boolean; canApprove: boolean; onPatch: (patch: { label?: string; metricKey?: string; reviewStatus?: "REVIEWED" | "APPROVED" | "EXCLUDED" | "NEEDS_CLARIFICATION"; note?: string | null }) => void; onDelete: () => void; onClose: () => void }) {
  const [label, setLabel] = useState(m.label);
  const [confirm, setConfirm] = useState(false);
  const options = METRICS[trade].filter((d) => d.kind === m.kind);
  const note = (m.evidence?.note as string | undefined) ?? null;
  return (
    <div className="space-y-3 border-t p-3 text-sm" data-testid="measurement-inspector">
      <div className="flex items-center justify-between">
        <p className="font-medium">{formatValue(m.valueRaw, m.unit as Unit)}{m.previousValue != null && m.previousValue !== m.valueRaw && <span className="ml-2 text-xs font-normal text-muted-foreground">was {formatValue(m.previousValue, m.unit as Unit)}</span>}</p>
        <div className="flex items-center gap-1"><ReviewStatusBadge status={m.reviewStatus} /><ConfidenceBadge value={m.confidence} /></div>
      </div>
      <p className="text-xs text-muted-foreground">{m.planSheet.sheetNumber ?? `p.${m.planSheet.pageNumber}`} · {m.geometry.points.length} point{m.geometry.points.length === 1 ? "" : "s"}{m.ptPerFt ? ` · ${m.ptPerFt} pt/ft` : ""} · {m.origin === "MANUAL" ? "drawn by hand" : m.origin.toLowerCase()}{m.createdBy ? ` by ${m.createdBy.firstName}` : ""}</p>
      {m.evidence?.summary ? <p className="rounded bg-muted px-2 py-1 text-xs">{String(m.evidence.summary)}</p> : null}
      {canEdit ? (
        <>
          <div className="grid grid-cols-[auto_1fr] items-center gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="mi-type">Type</label>
            <select id="mi-type" className="h-8 rounded border bg-background px-2 text-sm" value={m.metricKey} onChange={(e) => onPatch({ metricKey: e.target.value })}>{options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
            <label className="text-xs text-muted-foreground" htmlFor="mi-label">Label</label>
            <Input id="mi-label" className="h-8" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => { if (label.trim() && label !== m.label) onPatch({ label: label.trim() }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} />
          </div>
          {note && <p className="text-xs"><span className="text-muted-foreground">Note:</span> {note}</p>}
          <div className="flex flex-wrap gap-1">
            {m.reviewStatus !== "APPROVED" && m.reviewStatus !== "EXCLUDED" && (
              canApprove ? <Button size="sm" onClick={() => onPatch({ reviewStatus: "APPROVED" })}><Check className="mr-1 h-3 w-3" /> Approve</Button> : <Button size="sm" onClick={() => onPatch({ reviewStatus: "REVIEWED" })}><Check className="mr-1 h-3 w-3" /> Mark reviewed</Button>
            )}
            {m.reviewStatus !== "EXCLUDED" ? <Button size="sm" variant="outline" onClick={() => onPatch({ reviewStatus: "EXCLUDED" })}><XCircle className="mr-1 h-3 w-3" /> Exclude</Button> : <Button size="sm" variant="outline" onClick={() => onPatch({ reviewStatus: "REVIEWED" })}>Include again</Button>}
            {m.reviewStatus !== "NEEDS_CLARIFICATION" && <Button size="sm" variant="outline" onClick={() => { const n = window.prompt("What needs clarifying?", note ?? ""); if (n != null && n.trim()) onPatch({ reviewStatus: "NEEDS_CLARIFICATION", note: n.trim() }); }}>Needs clarification</Button>}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirm(true)} aria-label="Delete measurement"><Trash2 className="h-4 w-4" /></Button>
          </div>
        </>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this measurement?" description="It is removed from the takeoff. The sheet is not changed." confirmLabel="Delete" tone="danger" onConfirm={() => { setConfirm(false); onDelete(); }} />
    </div>
  );
}
