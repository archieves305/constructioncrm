"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, MapPin, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { fetchJson } from "@/lib/fetch-json";
import { formatAddressLine, type AddressInput } from "@/lib/labels/address";
import { mapsHref } from "@/components/shared/contact-card";

type Job = {
  id: string;
  ownedPurpose?: "FLIP" | "RENTAL" | null;
  purchasePrice?: string | number | null;
  afterRepairValue?: string | number | null;
  salePrice?: string | number | null;
  saleDate?: string | null;
  monthlyRent?: string | number | null;
  lead: AddressInput & { county?: string | null };
};

const money = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : `$${Math.round(Number(v)).toLocaleString("en-US")}`);
const asInput = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
const parse = (v: string): number | null => {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return v.trim() && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * One of our own projects in place of the customer card: the property, what
 * we paid for it, and what it should sell or let for. The figures feed the
 * all-in cost and returns on the Money tab. Editing is for the money roles.
 */
export function OwnedPropertyCard({ job, canEdit }: { job: Job; canEdit: boolean }) {
  const qc = useQueryClient();
  const flip = job.ownedPurpose !== "RENTAL";
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({
    purchasePrice: asInput(job.purchasePrice),
    afterRepairValue: asInput(job.afterRepairValue),
    salePrice: asInput(job.salePrice),
    saleDate: job.saleDate ? job.saleDate.slice(0, 10) : "",
    monthlyRent: asInput(job.monthlyRent),
  }));

  const save = useMutation({
    mutationFn: () =>
      fetchJson(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchasePrice: parse(form.purchasePrice),
          ...(flip
            ? { afterRepairValue: parse(form.afterRepairValue), salePrice: parse(form.salePrice), saleDate: form.saleDate || null }
            : { monthlyRent: parse(form.monthlyRent) }),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", job.id] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Property figures saved");
      setEditing(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const address = formatAddressLine(job.lead);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm">{flip ? "Our flip" : "Our rental"}</CardTitle>
        {canEdit && !editing && (
          <Button variant="ghost" size="icon-sm" aria-label="Edit property figures" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <div>{address || "No address"}</div>
            {job.lead.county && <div className="text-xs text-muted-foreground">{job.lead.county} County</div>}
            {address && (
              <a href={mapsHref(job.lead)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-fg hover:underline">
                Open in Maps <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>

        {editing ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Purchase price" id="own-purchase" labelClassName="text-xs">
              <Input id="own-purchase" inputMode="decimal" value={form.purchasePrice} onChange={set("purchasePrice")} placeholder="$" />
            </Field>
            {flip ? (
              <>
                <Field label="After-repair value" id="own-arv" labelClassName="text-xs">
                  <Input id="own-arv" inputMode="decimal" value={form.afterRepairValue} onChange={set("afterRepairValue")} placeholder="$" />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Sold for" id="own-sale" labelClassName="text-xs">
                    <Input id="own-sale" inputMode="decimal" value={form.salePrice} onChange={set("salePrice")} placeholder="$" />
                  </Field>
                  <Field label="Sale date" id="own-sale-date" labelClassName="text-xs">
                    <Input id="own-sale-date" type="date" value={form.saleDate} onChange={set("saleDate")} />
                  </Field>
                </div>
              </>
            ) : (
              <Field label="Monthly rent" id="own-rent" labelClassName="text-xs">
                <Input id="own-rent" inputMode="decimal" value={form.monthlyRent} onChange={set("monthlyRent")} placeholder="$" />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="brand" size="sm" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <dt className="text-muted-foreground">Purchase price</dt>
            <dd className="text-right tabular-nums">{money(job.purchasePrice)}</dd>
            {flip ? (
              <>
                <dt className="text-muted-foreground">After-repair value</dt>
                <dd className="text-right tabular-nums">{money(job.afterRepairValue)}</dd>
                <dt className="text-muted-foreground">Sold for</dt>
                <dd className="text-right tabular-nums">
                  {money(job.salePrice)}
                  {job.saleDate && <span className="block text-2xs text-muted-foreground">{new Date(job.saleDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>}
                </dd>
              </>
            ) : (
              <>
                <dt className="text-muted-foreground">Monthly rent</dt>
                <dd className="text-right tabular-nums">{money(job.monthlyRent)}</dd>
              </>
            )}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
