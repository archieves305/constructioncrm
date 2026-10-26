"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Callout } from "@/components/shared/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";
import type { LeftOutReason } from "@/lib/takeoff/roofing/to-measurement";

type Preview = {
  takeoff: { id: string; number: string };
  sheets: { id: string; sheetNumber: string | null; title: string | null; roofAreaSf: number; rows: number }[];
  sheetIds: string[];
  values: Record<string, number | string | null | undefined>;
  pitchBands: { pitch: string; areaSqFt: number }[] | null;
  counted: number;
  leftOut: { id: string; label: string; sheetNumber: string | null; reason: LeftOutReason }[];
  notPriced: { label: string; value: number; unit: string }[];
  warnings: string[];
};

const PITCHES = [{ value: "0", label: "Low-slope (under 2/12)" }, ...[3, 4, 5, 6, 7, 8, 9, 10, 12].map((r) => ({ value: String(r), label: `${r}/12` }))];

const REASON: Record<LeftOutReason, string> = {
  not_reviewed: "not reviewed",
  excluded: "excluded",
  needs_clarification: "needs clarification",
  sheet_not_chosen: "sheet not ticked",
  not_used: "not used by roofing",
};

const SHOWN: { key: string; label: string; unit: string }[] = [
  { key: "roofAreaSqFt", label: "Roof area", unit: "SF" },
  { key: "totalSquares", label: "Squares", unit: "sq" },
  { key: "eavesLf", label: "Eaves", unit: "LF" },
  { key: "rakesLf", label: "Rakes", unit: "LF" },
  { key: "ridgesLf", label: "Ridges", unit: "LF" },
  { key: "hipsLf", label: "Hips", unit: "LF" },
  { key: "valleysLf", label: "Valleys", unit: "LF" },
  { key: "flashingLf", label: "Wall / parapet flashing", unit: "LF" },
  { key: "penetrations", label: "Penetrations", unit: "EA" },
  { key: "skylights", label: "Skylights", unit: "EA" },
];

const num = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * "Use for an estimate": the takeoff's reviewed rows on the ticked sheets
 * become a roof measurement on the lead, which the estimate builder's "Add
 * roofing section from measurement" prices like a Roofr report. The preview is
 * read again whenever a sheet or the pitch changes; nothing is written until
 * Create.
 */
export function EstimateFromTakeoffDialog({ takeoffId, leadId, onOpenChange }: { takeoffId: string; leadId: string; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [sheetIds, setSheetIds] = useState<string[] | null>(null);
  const [rise, setRise] = useState("0");
  const body = JSON.stringify({ ...(sheetIds ? { sheetIds } : {}), defaultRise: Number(rise) });

  const preview = useQuery<{ preview: Preview }>({
    queryKey: ["takeoff-roof-measurement", takeoffId, body],
    queryFn: () => fetchJson(`/api/takeoffs/${takeoffId}/roof-measurement?preview=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body }),
    placeholderData: (prev) => prev,
  });
  const p = preview.data?.preview;
  const chosen = new Set(sheetIds ?? p?.sheetIds ?? []);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    setSheetIds([...next]);
  };

  const create = useMutation({
    mutationFn: () => fetchJson<{ measurement: { id: string; label: string } }>(`/api/takeoffs/${takeoffId}/roof-measurement`, { method: "POST", headers: { "Content-Type": "application/json" }, body }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["roof-measurements", leadId] });
      toast.success(`"${r.measurement.label}" is on the lead — pick it under Estimates → Add roofing section from measurement`, {
        action: { label: "Open estimates", onClick: () => router.push(`/leads/${leadId}?tab=estimates`) },
        duration: 12_000,
      });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leftOut = (p?.leftOut ?? []).reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.reason]: (acc[l.reason] ?? 0) + 1 }), {});
  const shown = SHOWN.filter((s) => typeof p?.values[s.key] === "number");

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="estimate-from-takeoff">
        <DialogHeader>
          <DialogTitle>Use for an estimate</DialogTitle>
          <DialogDescription>The reviewed rows on the sheets you tick become a roof measurement on the lead. The estimate builder prices it with the takeoff rules and the price book, as it does a Roofr report.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3 text-sm">
          {preview.isError && !p && <Callout tone="danger" title="Couldn't read the takeoff">{(preview.error as Error).message}</Callout>}
          {!p && preview.isLoading && <p className="text-xs text-muted-foreground">Reading the takeoff…</p>}
          {p && (
            <>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Sheets to count</p>
                <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
                  {p.sheets.map((s) => (
                    <li key={s.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                        <Checkbox checked={chosen.has(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} aria-label={s.sheetNumber ?? "Sheet"} />
                        <span className="font-mono text-xs">{s.sheetNumber ?? "—"}</span>
                        <span className="min-w-0 flex-1 truncate">{s.title ?? ""}</span>
                        <span className="text-xs text-muted-foreground">{s.roofAreaSf ? `${num(s.roofAreaSf)} SF` : `${s.rows} row${s.rows === 1 ? "" : "s"}`}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1">
                <Label htmlFor="takeoff-rise">Pitch for an area the plans give no slope</Label>
                <Select items={PITCHES} value={rise} onValueChange={(v) => v && setRise(v)}>
                  <SelectTrigger id="takeoff-rise" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{PITCHES.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {p.warnings.map((w) => <Callout key={w} tone="warning">{w}</Callout>)}
              {shown.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border p-3" data-testid="takeoff-values">
                  {shown.map((s) => (
                    <div key={s.key} className="flex justify-between gap-2"><dt className="text-muted-foreground">{s.label}</dt><dd className="font-mono">{num(p.values[s.key] as number)} {s.unit}</dd></div>
                  ))}
                  {p.pitchBands && p.pitchBands.length > 1 && <div className="col-span-2 text-xs text-muted-foreground">By pitch: {p.pitchBands.map((b) => `${b.pitch} ${num(b.areaSqFt)} SF`).join(" · ")}</div>}
                </dl>
              )}
              {p.notPriced.length > 0 && <p className="text-xs text-muted-foreground">Measured but not priced by a takeoff rule (add them to the estimate by hand): {p.notPriced.map((n) => `${n.label} ${num(n.value)} ${n.unit}`).join(", ")}.</p>}
              {Object.keys(leftOut).length > 0 && <p className="text-xs text-muted-foreground">Left out: {Object.entries(leftOut).map(([r, c]) => `${c} ${REASON[r as LeftOutReason]}`).join(", ")}.</p>}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!p?.pitchBands || preview.isFetching || create.isPending} onClick={() => create.mutate()} data-testid="estimate-from-takeoff-create">
            <Calculator className="mr-1 h-3 w-3" /> Create the measurement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
