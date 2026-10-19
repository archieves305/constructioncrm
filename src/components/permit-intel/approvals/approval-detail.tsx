"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { jobLabel } from "@/lib/labels/job";
import { AUTHORITIES, AUTHORITY_LABEL, CATEGORIES, CATEGORY_LABEL } from "@/lib/permit-intel/approvals-plan";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { READ_STATE, type ApprovalDetail } from "./types";

const key = (id: string) => ["product-approval", id] as const;
const TRI = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unknown", label: "Not stated" },
];
const tri = (v: boolean | null) => (v === true ? "yes" : v === false ? "no" : "unknown");
const fromTri = (v: string) => (v === "yes" ? true : v === "no" ? false : null);
const ymd = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/**
 * One approval: the document on the left, its fields on the right, each with
 * the page and words the reading found it in, so a person checks it against
 * the source before "Mark checked".
 */
export function ApprovalDetailView({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data: a, isLoading, error } = useQuery({
    queryKey: key(id),
    queryFn: () => fetchJson<ApprovalDetail>(`/api/product-approvals/${id}`),
    retry: retryServerErrors,
    refetchInterval: (q) => (q.state.data?.readState === "EXTRACTING" ? 4_000 : false),
  });
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key(id) });
    qc.invalidateQueries({ queryKey: ["product-approvals"] });
  };
  const call = async (path: string, init: RequestInit, ok?: string) => {
    setBusy(true);
    try {
      await fetchJson(`/api/product-approvals/${id}${path}`, init);
      if (ok) toast.success(ok);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: Record<string, unknown>) => call("", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  if (isLoading) return <ListSkeleton rows={8} />;
  if (error || !a) return <Callout tone="danger" title="The approval did not load">{(error as Error | null)?.message ?? "Try again."}</Callout>;
  const can = a.permissions.canManage && a.readState !== "EXTRACTING";
  const ev = a.evidence ?? {};
  const st = READ_STATE[a.readState];

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Permits", href: "/permits" }, { label: "Product approvals", href: "/permits/products" }, { label: a.approvalNumber ?? a.fileName }]}
        title={a.productName ?? a.fileName}
        description={`${a.manufacturer ?? "Manufacturer not read"} · ${AUTHORITY_LABEL[a.authority]} ${a.approvalNumber ?? ""}${a.revision ? ` ${a.revision}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" render={<a href={`/api/product-approvals/${id}/file`} target="_blank" rel="noreferrer" />} nativeButton={false}>
              <ExternalLink className="size-3.5" /> Open the document
            </Button>
            {a.permissions.canManage && a.readState !== "VERIFIED" && a.readState !== "EXTRACTING" && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => call("/reread", { method: "POST" }, "Reading the document again")}>
                <RefreshCw className="size-3.5" /> Read again
              </Button>
            )}
            {a.permissions.canManage && a.readState === "REVIEW" && (
              <Button variant="brand" size="sm" disabled={busy} onClick={() => call("/verify", { method: "POST" }, "Marked checked")}>
                <BadgeCheck className="size-3.5" /> Mark checked
              </Button>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", toneClasses(st.tone).pill)}>{st.label}</span>
        <span className="text-muted-foreground">
          Added {format(new Date(a.createdAt), "MMM d, yyyy")} by {a.createdBy.firstName} {a.createdBy.lastName}
          {a.verifiedAt && a.verifiedBy ? ` · checked ${format(new Date(a.verifiedAt), "MMM d, yyyy")} by ${a.verifiedBy.firstName} ${a.verifiedBy.lastName}` : ""}
          {a.aiCall ? ` · read by the AI for $${a.aiCall.costUsd.toFixed(2)}` : ""}
        </span>
      </div>
      {a.readState === "EXTRACTING" && (
        <Callout tone="info" icon={Loader2} title="The AI is reading the document">
          An 11-page NOA takes about a minute.
        </Callout>
      )}
      {a.readState === "FAILED" && <Callout tone="danger" title="The document was not read">{a.readError}</Callout>}
      {a.readState === "REVIEW" && <Callout tone="warning" title="Check each field against the document">Every value the AI read shows the page and the words it came from. Fix what is wrong, then “Mark checked”.</Callout>}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Card className="hidden min-w-0 overflow-hidden lg:block">
          <iframe title="The approval document" src={`/api/product-approvals/${id}/file`} className="h-[80vh] w-full" />
        </Card>
        <div className="min-w-0 space-y-4">
          {/* a new reading remounts the inputs, which hold what was typed until they lose focus */}
          <Card key={a.readState} className="min-w-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">The approval</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <Field label="Kind" evidence={ev.authority}>
                <PickSelect disabled={!can} value={a.authority} items={AUTHORITIES.map((v) => ({ value: v, label: AUTHORITY_LABEL[v] }))} onPick={(v) => patch({ authority: v })} />
              </Field>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <Field label="Number" evidence={ev.approvalNumber}>
                  <TextSave disabled={!can} value={a.approvalNumber} onSave={(v) => patch({ approvalNumber: v })} />
                </Field>
                <Field label="Revision" evidence={ev.revision}>
                  <TextSave disabled={!can} value={a.revision} onSave={(v) => patch({ revision: v })} />
                </Field>
                <Field label="Manufacturer" evidence={ev.manufacturer}>
                  <TextSave disabled={!can} value={a.manufacturer} onSave={(v) => patch({ manufacturer: v })} />
                </Field>
                <Field label="Product" evidence={ev.productName}>
                  <TextSave disabled={!can} value={a.productName} onSave={(v) => patch({ productName: v })} />
                </Field>
                <Field label="Category" evidence={ev.category}>
                  <PickSelect disabled={!can} value={a.category} items={CATEGORIES.map((v) => ({ value: v, label: CATEGORY_LABEL[v] }))} onPick={(v) => patch({ category: v })} />
                </Field>
                <Field label="Models covered" evidence={ev.models}>
                  <TextSave disabled={!can} value={a.models.join(", ")} onSave={(v) => patch({ models: (v ?? "").split(",").map((m) => m.trim()).filter(Boolean) })} />
                </Field>
                <Field label="Approved for the HVHZ" evidence={ev.hvhzApproved}>
                  <PickSelect disabled={!can} value={tri(a.hvhzApproved)} items={TRI} onPick={(v) => patch({ hvhzApproved: fromTri(v) })} />
                </Field>
                <Field label="Approved outside the HVHZ" evidence={ev.nonHvhzApproved}>
                  <PickSelect disabled={!can} value={tri(a.nonHvhzApproved)} items={TRI} onPick={(v) => patch({ nonHvhzApproved: fromTri(v) })} />
                </Field>
                <Field label="Design pressure + (psf)" evidence={ev.designPressurePos}>
                  <TextSave disabled={!can} numeric value={a.designPressurePos == null ? null : String(Number(a.designPressurePos))} onSave={(v) => patch({ designPressurePos: v ? Number(v) : null })} />
                </Field>
                <Field label="Design pressure − (psf)" evidence={ev.designPressureNeg}>
                  <TextSave disabled={!can} numeric value={a.designPressureNeg == null ? null : String(Number(a.designPressureNeg))} onSave={(v) => patch({ designPressureNeg: v ? Number(v) : null })} />
                </Field>
                <Field label="Impact rated" evidence={ev.impactRated}>
                  <PickSelect disabled={!can} value={tri(a.impactRated)} items={TRI} onPick={(v) => patch({ impactRated: fromTri(v) })} />
                </Field>
                <div />
                <Field label="Approved on" evidence={ev.issuedAt}>
                  <Input type="date" disabled={!can} defaultValue={ymd(a.issuedAt)} onBlur={(e) => e.target.value !== ymd(a.issuedAt) && patch({ issuedAt: e.target.value ? `${e.target.value}T12:00:00.000Z` : null })} />
                </Field>
                <Field label="Expires" evidence={ev.expiresAt}>
                  <Input type="date" disabled={!can} defaultValue={ymd(a.expiresAt)} onBlur={(e) => e.target.value !== ymd(a.expiresAt) && patch({ expiresAt: e.target.value ? `${e.target.value}T12:00:00.000Z` : null })} />
                </Field>
              </div>
              {a.authority === "FL_PRODUCT_APPROVAL" && !a.expiresAt && <p className="text-xs text-muted-foreground">A Florida evaluation report states no expiry; the approval&apos;s status is on floridabuilding.org.</p>}
              <Field label="Limitations and conditions of use" evidence={ev.limitations}>
                <TextSave disabled={!can} multiline value={a.limitations} onSave={(v) => patch({ limitations: v })} />
              </Field>
            </CardContent>
          </Card>

          {a.configurations && a.configurations.length > 0 && (
            <Card className="min-w-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Approved systems ({a.configurations.length})</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="divide-y rounded-md border text-xs">
                  {a.configurations.map((c, i) => (
                    <li key={i} className="space-y-0.5 px-3 py-2">
                      {[["Deck", c.deck], ["Slope", c.slope], ["Underlayment", c.underlayment], ["Fastening", c.fastening], ["Max design pressure", c.maxDesignPressure]]
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                          <p key={k}>
                            <span className="text-muted-foreground">{k}:</span> {v}
                          </p>
                        ))}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {a.permissions.canManage && (
            <Card className="min-w-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Roofing materials it covers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {a.catalog.length === 0 ? (
                  <p className="text-sm text-muted-foreground">The price book has no materials yet.</p>
                ) : (
                  <ul className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
                    {a.catalog.map((m) => {
                      const on = a.materials.some((x) => x.item.id === m.id);
                      return (
                        <li key={m.id}>
                          <label className="flex min-w-0 items-center gap-2 text-sm">
                            <Checkbox
                              checked={on}
                              disabled={busy}
                              onCheckedChange={(v) => {
                                const ids = new Set(a.materials.map((x) => x.item.id));
                                if (v === true) ids.add(m.id);
                                else ids.delete(m.id);
                                call("/materials", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemIds: [...ids] }) });
                              }}
                            />
                            <span className="truncate">{m.name}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="min-w-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Used on permits ({a.permits.length})</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {a.permits.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not on a permit yet. Add it from a permit&apos;s Products tab.</p>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {a.permits.map((p) => (
                    <li key={p.id} className="px-3 py-2">
                      <Link href={`/permits/${p.permit.id}?tab=products`} className="text-primary hover:underline">
                        {jobLabel(p.permit.job, { customer: false, trade: false }).primary}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {p.permit.permitType ?? "Permit"} · {p.permit.municipality}
                        {p.usedAs ? ` · ${p.usedAs}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {a.permissions.canManage && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={!a.isActive} disabled={busy} onCheckedChange={(v) => patch({ isActive: v !== true })} /> Set aside (superseded or not used any more)
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, evidence, children }: { label: string; evidence?: { page: number; quote: string }; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {evidence && (
        <p className="text-[11px] text-muted-foreground" title={evidence.quote}>
          <Sparkles className="mr-0.5 inline size-3" />p. {evidence.page}: “<span className="italic">{evidence.quote.length > 90 ? `${evidence.quote.slice(0, 89)}…` : evidence.quote}</span>”
        </p>
      )}
    </div>
  );
}

function TextSave({ value, onSave, disabled, multiline, numeric }: { value: string | null; onSave: (v: string | null) => void; disabled?: boolean; multiline?: boolean; numeric?: boolean }) {
  const [v, setV] = useState(value ?? "");
  const commit = () => {
    const next = v.trim();
    if (next !== (value ?? "")) onSave(next || null);
  };
  return multiline ? (
    <Textarea rows={4} disabled={disabled} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} />
  ) : (
    <Input disabled={disabled} inputMode={numeric ? "decimal" : undefined} value={v} onChange={(e) => setV(numeric ? e.target.value.replace(/[^\d.\-]/g, "") : e.target.value)} onBlur={commit} />
  );
}

function PickSelect({ value, items, onPick, disabled }: { value: string; items: { value: string; label: string }[]; onPick: (v: string) => void; disabled?: boolean }) {
  return (
    <Select items={items} value={value} disabled={disabled} onValueChange={(v: string | null) => v && v !== value && onPick(v)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
