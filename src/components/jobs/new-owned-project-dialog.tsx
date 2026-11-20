"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Field } from "@/components/ui/field";
import { fetchJson } from "@/lib/fetch-json";

type Purpose = "FLIP" | "RENTAL";
type Line = { name: string; category: string; amount: string };

const PURPOSE_OPTIONS: { value: Purpose; label: string }[] = [
  { value: "FLIP", label: "Flip" },
  { value: "RENTAL", label: "Rental" },
];

const money = (v: string): number | null => {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return v.trim() && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Start one of our own projects. No customer, no deposit, no contract: an
 * address, flip or rental, the budget and what the property cost. It lands
 * on the Planning stage with the workflow's customer steps left out.
 */
export function NewOwnedProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">{open && <NewOwnedProjectForm onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function NewOwnedProjectForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [purpose, setPurpose] = useState<Purpose>("FLIP");
  const [address, setAddress] = useState({ propertyAddress1: "", propertyAddress2: "", city: "", zipCode: "" });
  const [purchasePrice, setPurchasePrice] = useState("");
  const [arv, setArv] = useState("");
  const [rent, setRent] = useState("");
  const [targetStart, setTargetStart] = useState("");
  const [byCategory, setByCategory] = useState(false);
  const [budgetTotal, setBudgetTotal] = useState("");
  const [lines, setLines] = useState<Line[]>([{ name: "", category: "", amount: "" }]);

  const linesTotal = lines.reduce((s, l) => s + (money(l.amount) ?? 0), 0);

  const create = useMutation({
    mutationFn: () =>
      fetchJson<{ id: string; jobNumber: string }>("/api/jobs/owned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose,
          propertyAddress1: address.propertyAddress1,
          propertyAddress2: address.propertyAddress2 || null,
          city: address.city,
          zipCode: address.zipCode,
          purchasePrice: money(purchasePrice),
          afterRepairValue: purpose === "FLIP" ? money(arv) : null,
          monthlyRent: purpose === "RENTAL" ? money(rent) : null,
          targetStartDate: targetStart || null,
          ...(byCategory
            ? {
                budgetLines: lines
                  .filter((l) => l.name.trim() && money(l.amount) !== null)
                  .map((l) => ({ name: l.name.trim(), category: l.category.trim() || null, amount: money(l.amount)! })),
              }
            : { budgetTotal: money(budgetTotal) }),
        }),
      }),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(`${purpose === "FLIP" ? "Flip" : "Rental"} ${job.jobNumber} started`);
      onClose();
      router.push(`/jobs/${job.id}?tab=money&sub=budget`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!address.propertyAddress1.trim() || !address.city.trim() || !address.zipCode.trim()) return toast.error("Enter the property's street, city and ZIP");
        create.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>One of our own properties: no customer, no deposit, no invoices. It is tracked by its budget against what it costs.</DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label>Kind</Label>
        <div>
          <SegmentedControl ariaLabel="Project kind" value={purpose} onValueChange={setPurpose} options={PURPOSE_OPTIONS} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Street" id="op-street" className="sm:col-span-4">
          <Input id="op-street" value={address.propertyAddress1} onChange={(e) => setAddress((a) => ({ ...a, propertyAddress1: e.target.value }))} autoFocus maxLength={200} />
        </Field>
        <Field label="Unit" id="op-unit" className="sm:col-span-2">
          <Input id="op-unit" value={address.propertyAddress2} onChange={(e) => setAddress((a) => ({ ...a, propertyAddress2: e.target.value }))} maxLength={200} />
        </Field>
        <Field label="City" id="op-city" className="sm:col-span-4">
          <Input id="op-city" value={address.city} onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))} maxLength={100} />
        </Field>
        <Field label="ZIP" id="op-zip" className="sm:col-span-2">
          <Input id="op-zip" inputMode="numeric" value={address.zipCode} onChange={(e) => setAddress((a) => ({ ...a, zipCode: e.target.value }))} maxLength={10} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Purchase price" id="op-purchase" help="What we paid for the property.">
          <Input id="op-purchase" inputMode="decimal" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="$" />
        </Field>
        {purpose === "FLIP" ? (
          <Field label="After-repair value" id="op-arv" help="What it should sell for.">
            <Input id="op-arv" inputMode="decimal" value={arv} onChange={(e) => setArv(e.target.value)} placeholder="$" />
          </Field>
        ) : (
          <Field label="Monthly rent" id="op-rent" help="Expected rent once let.">
            <Input id="op-rent" inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} placeholder="$" />
          </Field>
        )}
        <Field label="Target start" id="op-start">
          <Input id="op-start" type="date" value={targetStart} onChange={(e) => setTargetStart(e.target.value)} />
        </Field>
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Rehab budget</Label>
          <SegmentedControl
            ariaLabel="Budget entry"
            size="sm"
            value={byCategory ? "lines" : "total"}
            onValueChange={(v) => setByCategory(v === "lines")}
            options={[
              { value: "total", label: "One total" },
              { value: "lines", label: "By category" },
            ]}
          />
        </div>
        {!byCategory ? (
          <Input aria-label="Budget total" inputMode="decimal" value={budgetTotal} onChange={(e) => setBudgetTotal(e.target.value)} placeholder="$ total rehab budget" />
        ) : (
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_7rem_auto] gap-2 max-sm:grid-cols-[1fr_6rem_auto]">
                <Input aria-label="Line" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="Kitchen" />
                <Input aria-label="Category" className="max-sm:hidden" value={l.category} onChange={(e) => setLine(i, { category: e.target.value })} placeholder="Category (optional)" />
                <Input aria-label="Amount" inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="$" />
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { name: "", category: "", amount: "" }])}>
                <Plus className="mr-1 size-4" /> Add a line
              </Button>
              <span className="text-sm tabular-nums text-muted-foreground">Total ${Math.round(linesTotal).toLocaleString("en-US")}</span>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">You can change the budget, or import one, from the job&apos;s Budget tab.</p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="brand" disabled={create.isPending}>
          {create.isPending ? "Starting…" : "Start project"}
        </Button>
      </DialogFooter>
    </form>
  );
}
