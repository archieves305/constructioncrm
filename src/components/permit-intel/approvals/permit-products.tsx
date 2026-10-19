"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, FileCheck2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { AUTHORITY_LABEL, CATEGORY_LABEL } from "@/lib/permit-intel/approvals-plan";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { permitIntelKeys } from "../use-permit-intel";
import type { PermitDetail } from "../types";
import { READ_STATE, type ApprovalRow, type PermitProductRow } from "./types";

const productsKey = (permitId: string) => ["permit", permitId, "products"] as const;
const n = (v: string | null) => (v == null ? null : Number(v));

/**
 * The products on a permit — each a link to its approval in the repository —
 * with the pressures the engineer's wind-load document requires, and the
 * checks a person should read before the package goes in. Every check is
 * advice, never an engineering determination.
 */
export function PermitProducts({ detail }: { detail: PermitDetail }) {
  const { permit } = detail;
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: productsKey(permit.id), queryFn: () => fetchJson<{ products: PermitProductRow[]; advisory: string; permissions: { canEdit: boolean } }>(`/api/permits/${permit.id}/products`), retry: retryServerErrors });
  const [adding, setAdding] = useState(false);
  if (isLoading) return <ListSkeleton rows={3} />;
  if (error || !data) return <Callout tone="danger" title="The products did not load">{(error as Error | null)?.message ?? "Try again."}</Callout>;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: productsKey(permit.id) });
    qc.invalidateQueries({ queryKey: permitIntelKeys.permit(permit.id), exact: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{data.advisory}</p>
        {data.permissions.canEdit && (
          <Button size="sm" variant="brand" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add a product
          </Button>
        )}
      </div>
      {permit.jurisdiction?.hvhz && <Callout tone="info">{permit.jurisdiction.name} is in the High Velocity Hurricane Zone: each product needs an approval that says HVHZ.</Callout>}
      {data.products.length === 0 ? (
        <EmptyState icon={BadgeCheck} title="No products yet" description="Add the underlayment, roof covering, windows or doors this permit is for, from the product approval repository. Enter the pressures the engineer's wind-load document requires to have them checked against each approval." />
      ) : (
        data.products.map((p) => <ProductCard key={p.id} p={p} canEdit={data.permissions.canEdit} onChanged={refresh} />)
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {adding && (
            <AddProduct
              permitId={permit.id}
              onClose={() => setAdding(false)}
              onAdded={() => {
                setAdding(false);
                refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductCard({ p, canEdit, onChanged }: { p: PermitProductRow; canEdit: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (url: string, init: RequestInit, ok?: string) => {
    setBusy(true);
    try {
      await fetchJson(url, init);
      if (ok) toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: Record<string, unknown>) => run(`/api/permit-products/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const a = p.approval;
  const st = READ_STATE[a.readState];
  const pressure = (v: string | null) => (v == null ? "" : String(Math.abs(Number(v))));

  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-1 pb-2">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm">
              <Link href={`/permits/products/${a.id}`} className="hover:underline">
                {a.productName ?? p.label}
              </Link>
              {p.usedAs ? <span className="font-normal text-muted-foreground"> — {p.usedAs}</span> : null}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {a.manufacturer ?? "—"} · {AUTHORITY_LABEL[a.authority]} {a.approvalNumber ?? ""}
              {a.revision ? ` ${a.revision}` : ""} · {CATEGORY_LABEL[a.category]}
              {a.expiresAt ? ` · expires ${format(new Date(a.expiresAt), "MMM d, yyyy")}` : ""}
              {a.designPressurePos || a.designPressureNeg ? ` · ${[n(a.designPressurePos) != null ? `+${n(a.designPressurePos)}` : null, n(a.designPressureNeg)].filter((x) => x != null).join(" / ")} psf` : ""}
            </p>
          </div>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses(st.tone).pill)}>{st.label}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {p.flags.length > 0 ? (
          <ul className="space-y-1">
            {p.flags.map((f) => (
              <li key={f.code} className={cn("flex items-start gap-1.5 rounded-md px-2 py-1 text-xs", toneClasses(f.level).soft, toneClasses(f.level).text)}>
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {f.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-tone-success-fg">Nothing to look at against what is recorded.</p>
        )}
        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          <div className="min-w-0 space-y-1">
            <Label className="text-xs" htmlFor={`use-${p.id}`}>
              Used as
            </Label>
            <Input id={`use-${p.id}`} disabled={!canEdit} defaultValue={p.usedAs} placeholder="underlayment" onBlur={(e) => e.target.value.trim() !== p.usedAs && patch({ usedAs: e.target.value })} />
          </div>
          <div className="min-w-0 space-y-1">
            <Label className="text-xs" htmlFor={`pp-${p.id}`}>
              Required + psf (engineer)
            </Label>
            <Input id={`pp-${p.id}`} inputMode="decimal" disabled={!canEdit} defaultValue={pressure(p.requiredPressurePos)} onBlur={(e) => e.target.value !== pressure(p.requiredPressurePos) && patch({ requiredPressurePos: e.target.value ? Number(e.target.value) : null })} />
          </div>
          <div className="min-w-0 space-y-1">
            <Label className="text-xs" htmlFor={`pn-${p.id}`}>
              Required − psf (engineer)
            </Label>
            <Input id={`pn-${p.id}`} inputMode="decimal" disabled={!canEdit} defaultValue={pressure(p.requiredPressureNeg)} onBlur={(e) => e.target.value !== pressure(p.requiredPressureNeg) && patch({ requiredPressureNeg: e.target.value ? Number(e.target.value) : null })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.inPackage && p.documentFile ? (
            <a href={`/api/files/${p.documentFile.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <FileCheck2 className="size-3.5" /> {p.documentFile.fileName} is among the permit&apos;s documents
            </a>
          ) : (
            canEdit && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(`/api/permit-products/${p.id}/document`, { method: "POST" }, "The approval is on the permit's Documents")}>
                <FileCheck2 className="size-3.5" /> Add the approval to the permit&apos;s documents
              </Button>
            )
          )}
          <span className="flex-1" />
          {canEdit && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(`/api/permit-products/${p.id}`, { method: "DELETE" }, "Removed from the permit")}>
              <Trash2 className="size-3.5" /> Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AddProduct({ permitId, onClose, onAdded }: { permitId: string; onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<ApprovalRow | null>(null);
  const [usedAs, setUsedAs] = useState("");
  const [pos, setPos] = useState("");
  const [neg, setNeg] = useState("");
  const [busy, setBusy] = useState(false);
  const { data = [], isFetching } = useQuery({ queryKey: ["product-approvals", "pick", q], queryFn: () => fetchJson<ApprovalRow[]>(`/api/product-approvals?q=${encodeURIComponent(q)}`), placeholderData: (prev) => prev });

  const add = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await fetchJson(`/api/permits/${permitId}/products`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvalId: picked.id, usedAs, requiredPressurePos: pos ? Number(pos) : null, requiredPressureNeg: neg ? Number(neg) : null }) });
      toast.success("Added to the permit");
      onAdded();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a product</DialogTitle>
        <DialogDescription>From the product approval repository. Not there yet? Add its NOA or FL approval under Permits → Product approvals first.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, manufacturer or product" aria-label="Search approvals" autoFocus />
        <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
          {data.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{isFetching ? "Searching…" : "No approval matches"}</li>}
          {data.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setPicked(a)} className={cn("w-full px-3 py-2 text-left hover:bg-muted/50", picked?.id === a.id && "bg-muted")}>
                <span className="block truncate text-sm font-medium">{a.productName ?? a.fileName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {a.manufacturer ?? "—"} · {a.approvalNumber ?? AUTHORITY_LABEL[a.authority]} · {READ_STATE[a.readState].label}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-1">
          <Label htmlFor="add-used">Used as</Label>
          <Input id="add-used" value={usedAs} onChange={(e) => setUsedAs(e.target.value)} placeholder="underlayment, field tile, front door…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="add-pos">Required + psf</Label>
            <Input id="add-pos" inputMode="decimal" value={pos} onChange={(e) => setPos(e.target.value.replace(/[^\d.]/g, ""))} placeholder="from the engineer" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-neg">Required − psf</Label>
            <Input id="add-neg" inputMode="decimal" value={neg} onChange={(e) => setNeg(e.target.value.replace(/[^\d.\-]/g, ""))} placeholder="from the engineer" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Required pressures are typed from the engineer&apos;s wind-load document; the CRM never works them out.</p>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="brand" disabled={!picked || busy} onClick={add}>
          Add
        </Button>
      </DialogFooter>
    </>
  );
}
