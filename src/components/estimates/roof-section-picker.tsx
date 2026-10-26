"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";
import { ROOF_TYPE_LABEL, type RoofSection } from "@/lib/estimates/roof-section";
import { ROOF_TYPES, type RoofType } from "@/lib/roofing/types";
import { type FormSection, uid } from "@/components/estimates/generic-estimate-types";

type MeasurementRow = { id: string; label: string | null; source: string; totalSquares: number | null; createdAt: string; reportWastePct: number | null; file: { fileName: string } | null };
type SectionAnswer = { section: RoofSection; wastePct: number; unpriced: number; warnings: string[] };

const ROOF_ITEMS = ROOF_TYPES.map((t) => ({ value: t, label: ROOF_TYPE_LABEL[t] }));

function measurementName(m: MeasurementRow): string {
  const name = m.label || m.file?.fileName || (m.source === "PLAN_TAKEOFF" ? "From plans" : "Measurement");
  return `${name}${m.totalSquares ? ` · ${m.totalSquares} sq` : ""}`;
}

/**
 * "Add roofing section from measurement" (audit roadmap MVP 5): pick one of
 * the lead's roof measurements and a roof type; the takeoff runs on the server
 * with today's rules and price book and comes back as a section of priced
 * lines the person can then edit like any other.
 */
export function RoofSectionPicker({ leadId, onAdd }: { leadId: string; onAdd: (section: FormSection) => void }) {
  const [open, setOpen] = useState(false);
  const [measurementId, setMeasurementId] = useState<string | null>(null);
  const [roofType, setRoofType] = useState<RoofType>("SHINGLE");
  const [waste, setWaste] = useState("");

  const list = useQuery<MeasurementRow[]>({ queryKey: ["roof-measurements", leadId], queryFn: () => fetchJson(`/api/leads/${leadId}/roof-measurements`), enabled: open });
  const chosen = list.data?.find((m) => m.id === measurementId) ?? null;

  const run = useMutation({
    mutationFn: () =>
      fetchJson<SectionAnswer>(`/api/leads/${leadId}/roof-section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ measurementId, roofType, ...(waste.trim() !== "" ? { wastePct: Number(waste) / 100 } : {}) }),
      }),
    onSuccess: (r) => {
      onAdd({
        uid: uid(),
        title: r.section.title,
        roofMeasurementId: r.section.roofMeasurementId,
        items: r.section.items.map((i) => ({ uid: uid(), description: i.description, unitType: i.unitType, quantity: String(i.quantity), unitPrice: String(i.unitPrice), costType: i.costType, isOptional: i.isOptional, notes: i.notes ?? "" })),
      });
      const summary = `Added ${r.section.items.length} lines at ${Math.round(r.wastePct * 100)}% waste`;
      if (r.unpriced > 0) toast.warning(`${summary}. ${r.unpriced} material${r.unpriced === 1 ? " has" : "s have"} no price in the price book — those lines are $0; enter a cost or add the price under Admin → Roofing.`, { duration: 12_000 });
      else toast.success(summary);
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Ruler className="mr-1 h-4 w-4" />
        Add roofing section from measurement
      </Button>
    );
  }

  const items = (list.data ?? []).map((m) => ({ value: m.id, label: measurementName(m) }));
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <p className="text-sm font-medium">Roofing section from a measurement</p>
      {list.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading measurements…</p>
      ) : list.isError ? (
        <p className="text-xs text-destructive">Couldn&rsquo;t load the measurements: {(list.error as Error).message}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">This lead has no roof measurement yet. Upload a Roofr report on the lead&rsquo;s Roofr tab first.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_110px]">
          <div className="min-w-0 space-y-1">
            <Label className="text-xs">Measurement</Label>
            <Select items={items} value={measurementId} onValueChange={(v) => { setMeasurementId(v); setWaste(""); }}>
              <SelectTrigger aria-label="Measurement"><SelectValue placeholder="Choose a measurement" /></SelectTrigger>
              <SelectContent>
                {items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Roof type</Label>
            <Select items={ROOF_ITEMS} value={roofType} onValueChange={(v) => v && setRoofType(v as RoofType)}>
              <SelectTrigger aria-label="Roof type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROOF_ITEMS.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Waste %</Label>
            <Input inputMode="decimal" aria-label="Waste percent" value={waste} placeholder="rule" onChange={(e) => setWaste(e.target.value)} />
          </div>
        </div>
      )}
      {/* Roofr's waste is a suggestion, never applied by itself: an empty box is the company's rule. */}
      {chosen?.reportWastePct != null && (
        <p className="text-xs text-muted-foreground">
          Roofr recommends {Math.round(chosen.reportWastePct * 100)}% (based on asphalt shingle). Empty uses the company&rsquo;s rule.{" "}
          <button type="button" className="underline" onClick={() => setWaste(String(Math.round((chosen.reportWastePct ?? 0) * 100)))}>Use {Math.round(chosen.reportWastePct * 100)}%</button>
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!measurementId || run.isPending || (waste.trim() !== "" && !(Number(waste) >= 0 && Number(waste) <= 50))} onClick={() => run.mutate()}>
          {run.isPending ? "Working…" : "Add roofing section"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
