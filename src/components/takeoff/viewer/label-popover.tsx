"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatValue } from "@/lib/takeoff/measurement-value";
import { METRICS, PIPE_SIZES, sizeLabel, type MeasurementKindName, type MetricDef, type TradeName, type Unit } from "@/lib/takeoff/metrics";

export type LabelChoice = { metricKey: string; label: string; attributes?: Record<string, string | number> };

/**
 * After a shape is drawn: what is it? The metric list for the trade and the
 * shape's kind, a pipe size where that matters, and a label prefilled from
 * them (the nearest text on the sheet when the caller found one).
 */
export function LabelPopover({ trade, kind, value, unit, suggestion, onSave, onCancel }: { trade: TradeName; kind: MeasurementKindName; value: number | null; unit: Unit; suggestion?: string | null; onSave: (c: LabelChoice) => void; onCancel: () => void }) {
  const options = METRICS[trade].filter((m) => m.kind === kind);
  const [metric, setMetricState] = useState<MetricDef>(options[0]);
  const [size, setSizeState] = useState<number>(3);
  // the label follows the type and size until the person types one
  const [typed, setTyped] = useState<string | null>(null);
  const label = typed ?? suggestion ?? (metric.sized ? `${metric.label} ${sizeLabel(size)}` : metric.label);
  const setMetric = (m: MetricDef) => { setMetricState(m); setTyped(null); };
  const setSize = (n: number) => { setSizeState(n); setTyped(null); };
  const setLabel = (v: string) => setTyped(v);
  const groups = [...new Set(options.map((o) => o.group))];
  return (
    <div className="w-72 space-y-3 rounded-md border bg-background p-3 shadow-lg" data-testid="label-popover" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <p className="text-sm font-medium">{value != null ? formatValue(value, unit) : kind === "COUNT" ? "1" : "—"} <span className="font-normal text-muted-foreground">— what is it?</span></p>
      <div className="space-y-1">
        <Label htmlFor="lp-metric">Type</Label>
        <select id="lp-metric" autoFocus className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={metric.key} onChange={(e) => setMetric(options.find((o) => o.key === e.target.value) ?? options[0])}>
          {groups.map((g) => <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>)}
        </select>
      </div>
      {metric.sized && (
        <div className="space-y-1">
          <Label htmlFor="lp-size">Pipe size</Label>
          <select id="lp-size" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {PIPE_SIZES.map((s) => <option key={s} value={s}>{sizeLabel(s)}</option>)}
          </select>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="lp-label">Label</Label>
        <Input id="lp-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={160} onKeyDown={(e) => { if (e.key === "Enter") onSave({ metricKey: metric.key, label: label.trim() || metric.label, attributes: metric.sized ? { sizeIn: size } : undefined }); }} />
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSave({ metricKey: metric.key, label: label.trim() || metric.label, attributes: metric.sized ? { sizeIn: size } : undefined })}>Save</Button>
      </div>
    </div>
  );
}
