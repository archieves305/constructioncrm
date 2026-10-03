"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { AlertTriangle, History, Plus, RotateCcw, Star } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Callout } from "@/components/shared/callout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchJson, HttpError } from "@/lib/fetch-json";
import { ROOF_TYPES, type RoofType } from "@/lib/roofing/types";

type Material = {
  id: string;
  category: string;
  name: string;
  sku: string | null;
  roofType: RoofType | null;
  unitType: string;
  isPreferred: boolean;
  isActive: boolean;
  notes: string | null;
  vendor: { id: string; name: string } | null;
  prices: { id: string; unitCost: number; effectiveDate: string; source: string; note: string | null; createdBy: { firstName: string; lastName: string } | null }[];
  currentPrice: { unitCost: number; effectiveDate: string; ageDays: number | null; stale: boolean } | null;
};

type Rule = {
  key: string;
  roofType: RoofType | null;
  label: string;
  category: string;
  description?: string;
  kind: string;
  unit?: string;
  value: number;
  defaultValue: number;
  active: boolean;
  changed: boolean;
  updatedAt: string | null;
  updatedBy: { firstName: string; lastName: string } | null;
};

type Takeoff = {
  wasteFactorPct: number;
  subtotal: number;
  warnings: string[];
  reportWastePct: number | null;
  items: { category: string; name: string; unitType: string; baseQuantity: number; quantity: number; unitCost: number; lineTotal: number; wasteApplied: boolean; calcNote?: string }[];
};

type MeasurementOption = { id: string; source: string; label: string | null; totalSquares: number | null; address: string; customer: string; createdAt: string };

const ROOF_LABEL: Record<RoofType, string> = { SHINGLE: "Shingle", TILE: "Tile", METAL: "Metal" };
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function errorText(err: unknown): string {
  if (err instanceof HttpError) {
    const body = err.body as { error?: string; fields?: Record<string, string[]> } | undefined;
    const field = body?.fields ? Object.entries(body.fields)[0] : undefined;
    return field ? `${field[0]}: ${field[1][0]}` : (body?.error ?? err.message);
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Roofing prices and takeoff rules: what materials cost, how quantities are worked out, and a way to try both on a real roof. */
export default function RoofingAdminPage() {
  return (
    <div>
      <PageHeader title="Roofing Prices & Takeoff" description="What roofing materials cost and how a roof's measurements become a material list. Changes apply to takeoffs run from now on." />
      <Tabs defaultValue="prices">
        <TabsList>
          <TabsTrigger value="prices">Price book</TabsTrigger>
          <TabsTrigger value="rules">Takeoff rules</TabsTrigger>
          <TabsTrigger value="try">Try a takeoff</TabsTrigger>
        </TabsList>
        <TabsContent value="prices"><PriceBook /></TabsContent>
        <TabsContent value="rules"><Rules /></TabsContent>
        <TabsContent value="try"><TryTakeoff /></TabsContent>
      </Tabs>
    </div>
  );
}

function PriceBook() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<Material[]>({ queryKey: ["roof-materials"], queryFn: () => fetchJson("/api/roofing/materials") });
  const [adding, setAdding] = useState(false);
  const [pricing, setPricing] = useState<Material | null>(null);
  const [history, setHistory] = useState<Material | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["roof-materials"] });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => fetchJson(`/api/roofing/materials/${id}`, json("PATCH", body)),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e)),
  });

  if (error) return <Callout tone="danger" title="Couldn't load the price book">{errorText(error)}</Callout>;
  if (isLoading) return <Skeleton className="h-64" />;
  const rows = (data ?? []).filter((m) => showInactive || m.isActive);
  const unpriced = (data ?? []).filter((m) => m.isActive && !m.currentPrice).length;
  const stale = (data ?? []).filter((m) => m.isActive && m.currentPrice?.stale).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {(data ?? []).filter((m) => m.isActive).length} materials
          {unpriced > 0 && <span className="text-tone-warning-fg"> · {unpriced} with no price</span>}
          {stale > 0 && <span className="text-tone-warning-fg"> · {stale} not updated in over 90 days</span>}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={showInactive} onCheckedChange={(c) => setShowInactive(Boolean(c))} /> Show switched off
          </label>
          <Button variant="brand" size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add material
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border bg-white py-10 text-center text-sm text-muted-foreground">No materials yet. Add what you buy for roofs and what each costs; a takeoff prices its lines from here.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Material</th>
                <th className="px-3 py-2">Used for</th>
                <th className="px-3 py-2">Roof</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((m) => (
                <tr key={m.id} className={m.isActive ? "" : "opacity-60"}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 font-medium">
                      {m.isPreferred && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-label="The takeoff's choice" />}
                      {m.name}
                    </div>
                    {m.sku && <div className="font-mono text-xs text-muted-foreground">{m.sku}</div>}
                  </td>
                  <td className="px-3 py-2">{m.category}</td>
                  <td className="px-3 py-2">{m.roofType ? ROOF_LABEL[m.roofType] : "Any"}</td>
                  <td className="px-3 py-2">{m.vendor?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {m.currentPrice ? (
                      <>
                        <div>{usd(m.currentPrice.unitCost)} / {m.unitType}</div>
                        <div className={`text-xs ${m.currentPrice.stale ? "text-tone-warning-fg" : "text-muted-foreground"}`}>since {format(new Date(m.currentPrice.effectiveDate), "MMM d, yyyy")}</div>
                      </>
                    ) : (
                      <span className="text-tone-warning-fg">No price</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => setPricing(m)}>New price</Button>
                      <Button size="icon" variant="ghost" aria-label={`Price history of ${m.name}`} onClick={() => setHistory(m)}><History className="h-4 w-4" /></Button>
                      {m.isActive && !m.isPreferred && (
                        <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: m.id, body: { isPreferred: true } })}>Use in takeoffs</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: m.id, body: { isActive: !m.isActive } })}>{m.isActive ? "Switch off" : "Switch on"}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MaterialDialog open={adding} onClose={() => setAdding(false)} onSaved={refresh} categories={[...new Set((data ?? []).map((m) => m.category))]} />
      <PriceDialog material={pricing} onClose={() => setPricing(null)} onSaved={refresh} />
      <Dialog open={Boolean(history)} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{history?.name}</DialogTitle>
            <DialogDescription>Every price entered, newest first. Prices are never changed after the fact.</DialogDescription>
          </DialogHeader>
          {history?.prices.length ? (
            <ul className="divide-y text-sm">
              {history.prices.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span>
                    {usd(p.unitCost)} <span className="text-muted-foreground">from {format(new Date(p.effectiveDate), "MMM d, yyyy")}</span>
                    {p.note && <span className="block text-xs text-muted-foreground">{p.note}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{p.createdBy ? `${p.createdBy.firstName} ${p.createdBy.lastName}` : p.source}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No price has been entered.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MaterialDialog({ open, onClose, onSaved, categories }: { open: boolean; onClose: () => void; onSaved: () => void; categories: string[] }) {
  const empty = { name: "", category: "", sku: "", roofType: "", unitType: "", vendorId: "", unitCost: "" };
  const [f, setF] = useState(empty);
  const rules = useQuery<Rule[]>({ queryKey: ["roof-rules"], queryFn: () => fetchJson("/api/roofing/rules"), enabled: open });
  const vendors = useQuery<{ id: string; name: string }[]>({ queryKey: ["vendor-options"], queryFn: () => fetchJson("/api/vendors/options"), enabled: open });
  const allCategories = useMemo(() => [...new Set([...(rules.data ?? []).filter((r) => r.kind !== "waste_pct").map((r) => r.category), ...categories])].sort(), [rules.data, categories]);
  const save = useMutation({
    mutationFn: () =>
      fetchJson("/api/roofing/materials", json("POST", { name: f.name, category: f.category, sku: f.sku || null, roofType: f.roofType || null, unitType: f.unitType, vendorId: f.vendorId || null, unitCost: f.unitCost === "" ? null : Number(f.unitCost) })),
    onSuccess: () => {
      toast.success("Material added");
      setF(empty);
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const ready = f.name.trim() && f.category.trim() && f.unitType.trim() && (f.unitCost === "" || Number(f.unitCost) >= 0);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a material</DialogTitle>
          <DialogDescription>&ldquo;Used for&rdquo; is what ties it to a takeoff rule: a takeoff prices its shingle line from a material used for Shingles.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor="m-name">Name</Label><Input id="m-name" value={f.name} onChange={set("name")} placeholder="GAF Timberline HDZ" /></div>
          <div>
            <Label htmlFor="m-cat">Used for</Label>
            <Input id="m-cat" list="roof-categories" value={f.category} onChange={set("category")} placeholder="Shingles" />
            <datalist id="roof-categories">{allCategories.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <Label htmlFor="m-roof">Roof type</Label>
            <select id="m-roof" className={selectClass} value={f.roofType} onChange={set("roofType")}>
              <option value="">Any</option>
              {ROOF_TYPES.map((t) => <option key={t} value={t}>{ROOF_LABEL[t]}</option>)}
            </select>
          </div>
          <div><Label htmlFor="m-unit">Sold by</Label><Input id="m-unit" value={f.unitType} onChange={set("unitType")} placeholder="bundle" /></div>
          <div><Label htmlFor="m-cost">Price per unit</Label><Input id="m-cost" inputMode="decimal" value={f.unitCost} onChange={set("unitCost")} placeholder="42.00" /></div>
          <div><Label htmlFor="m-sku">SKU</Label><Input id="m-sku" value={f.sku} onChange={set("sku")} /></div>
          <div>
            <Label htmlFor="m-vendor">Supplier</Label>
            <select id="m-vendor" className={selectClass} value={f.vendorId} onChange={set("vendorId")}>
              <option value="">None</option>
              {(vendors.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="brand" disabled={!ready || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Add material"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriceDialog({ material, onClose, onSaved }: { material: Material | null; onClose: () => void; onSaved: () => void }) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [cost, setCost] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => fetchJson(`/api/roofing/materials/${material!.id}/prices`, json("POST", { unitCost: Number(cost), effectiveDate: date, note: note || null })),
    onSuccess: () => {
      toast.success("Price saved");
      setCost("");
      setNote("");
      setDate(today);
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const valid = cost.trim() !== "" && Number.isFinite(Number(cost)) && Number(cost) >= 0;
  return (
    <Dialog open={Boolean(material)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New price for {material?.name}</DialogTitle>
          <DialogDescription>
            {material?.currentPrice ? `Now ${usd(material.currentPrice.unitCost)} per ${material.unitType}. ` : ""}The earlier price stays in the history; takeoffs use the new one from its date.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="p-cost">Price per {material?.unitType}</Label><Input id="p-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          <div><Label htmlFor="p-date">From</Label><Input id="p-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label htmlFor="p-note">Note</Label><Input id="p-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Supplier quote, invoice number…" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="brand" disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save price"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const KIND_HINT: Record<string, string> = {
  per_square: "per square",
  per_lf: "per linear foot",
  per_count: "each",
  per_facet: "per facet",
  squares_per_unit: "squares covered by one",
  lf_per_unit: "feet covered by one",
  fixed: "fixed quantity",
  waste_pct: "fraction (0.10 = 10%)",
};

function Rules() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<Rule[]>({ queryKey: ["roof-rules"], queryFn: () => fetchJson("/api/roofing/rules") });
  const [roof, setRoof] = useState<RoofType>("SHINGLE");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const done = (key: string) => {
    qc.invalidateQueries({ queryKey: ["roof-rules"] });
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  };
  const put = useMutation({
    mutationFn: ({ key, value, active }: { key: string; value: number; active: boolean }) => fetchJson(`/api/roofing/rules/${encodeURIComponent(key)}`, json("PUT", { value, active })),
    onSuccess: (_d, v) => done(v.key),
    onError: (e) => toast.error(errorText(e)),
  });
  const reset = useMutation({
    mutationFn: (key: string) => fetchJson(`/api/roofing/rules/${encodeURIComponent(key)}`, { method: "DELETE" }),
    onSuccess: (_d, key) => done(key),
    onError: (e) => toast.error(errorText(e)),
  });

  if (error) return <Callout tone="danger" title="Couldn't load the rules">{errorText(error)}</Callout>;
  if (isLoading) return <Skeleton className="h-64" />;
  const rows = (data ?? []).filter((r) => r.roofType === roof || r.roofType === null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {ROOF_TYPES.map((t) => (
          <Button key={t} size="sm" variant={roof === t ? "brand" : "outline"} onClick={() => setRoof(t)}>{ROOF_LABEL[t]}</Button>
        ))}
        <p className="text-sm text-muted-foreground">Each rule turns a measurement into a quantity. Change a number, or switch a rule off so it orders nothing.</p>
      </div>
      <ul className="divide-y rounded-lg border bg-white">
        {rows.map((r) => {
          const text = draft[r.key] ?? String(r.value);
          const dirty = r.key in draft && Number(draft[r.key]) !== r.value;
          return (
            <li key={r.key} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${r.active ? "" : "opacity-60"}`}>
              <div className="min-w-[220px] flex-1">
                <p className="text-sm font-medium">
                  {r.label} {r.changed && <Badge variant="outline" className="ml-1">{r.active ? `Changed · was ${r.defaultValue}` : "Switched off"}</Badge>}
                </p>
                {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Input className="h-8 w-24 text-right" inputMode="decimal" aria-label={r.label} value={text} disabled={!r.active} onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))} />
                <span className="w-36 text-xs text-muted-foreground">{KIND_HINT[r.kind] ?? r.kind}{r.unit && r.kind !== "waste_pct" ? ` ${r.unit}` : ""}</span>
                <Button size="sm" variant="outline" disabled={!dirty || put.isPending || !Number.isFinite(Number(text))} onClick={() => put.mutate({ key: r.key, value: Number(text), active: true })}>Save</Button>
                {r.kind !== "waste_pct" && (
                  <Button size="sm" variant="ghost" disabled={put.isPending} onClick={() => put.mutate({ key: r.key, value: r.value, active: !r.active })}>{r.active ? "Switch off" : "Switch on"}</Button>
                )}
                <Button size="icon" variant="ghost" aria-label={`Reset ${r.label}`} title="Back to the standard rule" disabled={!r.changed || reset.isPending} onClick={() => reset.mutate(r.key)}><RotateCcw className="h-4 w-4" /></Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TryTakeoff() {
  const list = useQuery<MeasurementOption[]>({ queryKey: ["roof-measurement-options"], queryFn: () => fetchJson("/api/roofing/measurements") });
  const [measurementId, setMeasurementId] = useState("");
  const [roofType, setRoofType] = useState<RoofType>("SHINGLE");
  const run = useMutation<Takeoff, unknown, void>({
    mutationFn: () => fetchJson("/api/roofing/takeoff-preview", json("POST", { measurementId, roofType })),
    onError: (e) => toast.error(errorText(e)),
  });
  const t = run.data;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Pick a measured roof and see the material list today&apos;s rules and prices give. Nothing is saved.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[260px] flex-1">
          <Label htmlFor="t-m">Measurement</Label>
          <select id="t-m" className={selectClass} value={measurementId} onChange={(e) => setMeasurementId(e.target.value)}>
            <option value="">{list.isLoading ? "Loading…" : list.data?.length ? "Choose a roof" : "No measurements yet — upload a Roofr report on a lead"}</option>
            {(list.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.address || m.customer} · {m.totalSquares ?? "?"} sq · {format(new Date(m.createdAt), "MMM d")}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="t-r">Roof type</Label>
          <select id="t-r" className={selectClass} value={roofType} onChange={(e) => setRoofType(e.target.value as RoofType)}>
            {ROOF_TYPES.map((x) => <option key={x} value={x}>{ROOF_LABEL[x]}</option>)}
          </select>
        </div>
        <Button variant="brand" disabled={!measurementId || run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Working…" : "Run takeoff"}</Button>
      </div>
      {t && (
        <>
          {t.warnings.length > 0 && (
            <Callout tone="warning" title={`${t.warnings.length} thing${t.warnings.length === 1 ? "" : "s"} to check`}>
              <ul className="list-disc pl-4">{t.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </Callout>
          )}
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2">Material</th><th className="px-3 py-2">How it was worked out</th><th className="px-3 py-2 text-right">Quantity</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">Total</th></tr>
              </thead>
              <tbody className="divide-y">
                {t.items.map((i, n) => (
                  <tr key={n}>
                    <td className="px-3 py-2"><div className="font-medium">{i.name}</div><div className="text-xs text-muted-foreground">{i.category}</div></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{i.calcNote}</td>
                    <td className="px-3 py-2 text-right">{i.quantity} {i.unitType}</td>
                    <td className="px-3 py-2 text-right">{i.unitCost > 0 ? usd(i.unitCost) : <span className="inline-flex items-center gap-1 text-tone-warning-fg"><AlertTriangle className="h-3 w-3" /> none</span>}</td>
                    <td className="px-3 py-2 text-right">{usd(i.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t font-medium">
                <tr><td className="px-3 py-2" colSpan={4}>Materials, before tax</td><td className="px-3 py-2 text-right">{usd(t.subtotal)}</td></tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Waste used: {Math.round(t.wasteFactorPct * 100)}%.{t.reportWastePct != null ? ` Roofr recommends ${Math.round(t.reportWastePct * 100)}% for this roof (based on asphalt shingles).` : ""}
          </p>
        </>
      )}
    </div>
  );
}
