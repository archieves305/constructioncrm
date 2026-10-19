"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, ListChecks, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { permitIntelKeys, useJurisdictions, usePermitTypes, type JurisdictionOption } from "@/components/permit-intel/use-permit-intel";
import { METHOD_LABEL } from "@/components/permit-intel/types";
import { FormTemplates } from "@/components/permit-intel/forms/form-templates";
import { KnowledgeAdmin } from "@/components/permit-intel/knowledge-admin";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { PERMIT_DOC_TYPES, permitDocLabel } from "@/lib/permit-intel/doc-types";

type Requirement = {
  id: string;
  jurisdictionId: string | null;
  permitTypeKey: string | null;
  title: string;
  body: string | null;
  documentType: string | null;
  required: boolean;
  reliability: "OFFICIAL" | "INTERNAL" | "OBSERVED";
  sourceUrl: string | null;
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "RETIRED";
  sortOrder: number;
  jurisdiction: { id: string; name: string } | null;
};

const ANY = "__any";
const KIND_ITEMS = ["CITY", "TOWN", "VILLAGE", "COUNTY", "STATE", "OTHER"].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }));
const METHOD_ITEMS = Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }));
const RELIABILITY_ITEMS = [
  { value: "INTERNAL", label: "KNU practice" },
  { value: "OFFICIAL", label: "Published rule (give the source)" },
  { value: "OBSERVED", label: "Reviewers have asked for it" },
];
const DOC_ITEMS = [{ value: ANY, label: "No document — a note to check" }, ...PERMIT_DOC_TYPES.map((t) => ({ value: t.key, label: t.label }))];

/**
 * The building departments KNU files with, and what each one asks for. The
 * checklist on every permit is built from these rows: the most specific row
 * for a document type wins (this department and type → this department →
 * this type → everyone).
 */
export default function PermitSettingsPage() {
  const url = useSearchParamState();
  const tab = (["requirements", "forms", "knowledge"] as const).find((t) => t === url.get("tab")) ?? "jurisdictions";
  return (
    <div className="space-y-4">
      <PageHeader title="Permits" description="The building departments KNU files with, the documents each one asks for, and their application forms." />
      <Tabs value={tab} onValueChange={(v) => v && url.set("tab", v === "jurisdictions" ? null : String(v))}>
        <TabsList>
          <TabsTrigger value="jurisdictions">Jurisdictions</TabsTrigger>
          <TabsTrigger value="requirements">Requirements</TabsTrigger>
          <TabsTrigger value="forms">Forms</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
        </TabsList>
        <TabsContent value="jurisdictions" className="mt-4">
          <Jurisdictions />
        </TabsContent>
        <TabsContent value="requirements" className="mt-4">
          <Requirements />
        </TabsContent>
        <TabsContent value="forms" className="mt-4">
          <FormTemplates />
        </TabsContent>
        <TabsContent value="knowledge" className="mt-4">
          <KnowledgeAdmin />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useSave(keys: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ url, method, body }: { url: string; method: "POST" | "PATCH"; body: unknown }) => fetchJson(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k })),
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Jurisdictions ──────────────────────────────────────────────────────────

function Jurisdictions() {
  const { data = [], isLoading, error } = useJurisdictions(true);
  const [editing, setEditing] = useState<{ j: JurisdictionOption | null } | null>(null);
  if (error) return <Callout tone="danger" title="Couldn't load the jurisdictions">{(error as Error).message}</Callout>;
  if (isLoading) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="brand" onClick={() => setEditing({ j: null })}>
          <Plus className="size-3.5" /> Add a jurisdiction
        </Button>
      </div>
      {data.length === 0 ? (
        <EmptyState icon={Landmark} title="No jurisdictions yet" description="Add the building departments KNU files with. Permits typed before this list existed are linked by the backfill." />
      ) : (
        <Card className="min-w-0">
          <CardContent className="overflow-x-auto pt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jurisdiction</TableHead>
                  <TableHead>County</TableHead>
                  <TableHead>Submitted by</TableHead>
                  <TableHead className="text-right">Permits</TableHead>
                  <TableHead className="text-right">Requirements</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((j) => (
                  <TableRow key={j.id} className={j.isActive ? undefined : "opacity-60"}>
                    <TableCell className="font-medium">
                      {j.name} {j.hvhz && <Badge variant="outline" className="ml-1">HVHZ</Badge>} {!j.isActive && <Badge variant="outline" className="ml-1">Off</Badge>}
                    </TableCell>
                    <TableCell>{j.county ?? "—"}</TableCell>
                    <TableCell>{METHOD_LABEL[j.submissionMethod] ?? j.submissionMethod}</TableCell>
                    <TableCell className="text-right tabular-nums">{j._count?.permits ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{j._count?.knowledge ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${j.name}`} onClick={() => setEditing({ j })}>
                        <Pencil className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">{editing && <JurisdictionForm j={editing.j} onClose={() => setEditing(null)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function JurisdictionForm({ j, onClose }: { j: JurisdictionOption | null; onClose: () => void }) {
  const save = useSave([["jurisdictions"]]);
  const [form, setForm] = useState({
    name: j?.name ?? "",
    kind: j?.kind ?? "CITY",
    county: j?.county ?? "",
    hvhz: j?.hvhz ?? false,
    portalUrl: j?.portalUrl ?? "",
    submissionMethod: j?.submissionMethod ?? "UNKNOWN",
    reviewDaysTarget: j?.reviewDaysTarget ? String(j.reviewDaysTarget) : "",
    notes: j?.notes ?? "",
    isActive: j?.isActive ?? true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const body = { ...form, reviewDaysTarget: form.reviewDaysTarget ? Number(form.reviewDaysTarget) : null, ...(j ? {} : { isActive: undefined }) };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{j ? `Edit ${j.name}` : "Add a jurisdiction"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div className="space-y-1.5">
            <Label htmlFor="j-name">Name</Label>
            <Input id="j-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="City of Palm Beach" />
          </div>
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <Select items={KIND_ITEMS} value={form.kind} onValueChange={(v: string | null) => v && set("kind", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_ITEMS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="j-county">County</Label>
            <Input id="j-county" value={form.county} onChange={(e) => set("county", e.target.value)} placeholder="Palm Beach" />
          </div>
          <div className="space-y-1.5">
            <Label>Submitted by</Label>
            <Select items={METHOD_ITEMS} value={form.submissionMethod} onValueChange={(v: string | null) => v && set("submissionMethod", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHOD_ITEMS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="j-portal">Permit portal link</Label>
          <Input id="j-portal" value={form.portalUrl} onChange={(e) => set("portalUrl", e.target.value)} placeholder="https://…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="j-days">Days in review before it counts as slow</Label>
          <Input id="j-days" inputMode="numeric" value={form.reviewDaysTarget} onChange={(e) => set("reviewDaysTarget", e.target.value.replace(/\D/g, ""))} placeholder="Leave empty for the 7 / 14 defaults" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={form.hvhz} onCheckedChange={(v) => set("hvhz", v === true)} /> High-Velocity Hurricane Zone (Miami-Dade, Broward)
        </label>
        {j && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.isActive} onCheckedChange={(v) => set("isActive", v === true)} /> In use (off hides it from the permit form)
          </label>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="j-notes">Notes</Label>
          <Textarea id="j-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={form.name.trim().length < 2 || save.isPending}
          onClick={() => save.mutate({ url: j ? `/api/jurisdictions/${j.id}` : "/api/jurisdictions", method: j ? "PATCH" : "POST", body }, { onSuccess: () => { toast.success(j ? "Saved" : `${form.name} added`); onClose(); } })}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ─── Requirements ───────────────────────────────────────────────────────────

function Requirements() {
  const { data = [], isLoading, error } = useQuery({ queryKey: permitIntelKeys.requirements, queryFn: () => fetchJson<Requirement[]>("/api/permit-requirements"), retry: retryServerErrors });
  const { data: types = [] } = usePermitTypes();
  const [editing, setEditing] = useState<{ r: Requirement | null } | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  if (error) return <Callout tone="danger" title="Couldn't load the requirements">{(error as Error).message}</Callout>;
  if (isLoading) return <Skeleton className="h-48" />;
  const typeName = (k: string | null) => (k ? (types.find((t) => t.key === k)?.name ?? k) : "Every type");
  const rows = data.filter((r) => showRetired || r.status === "APPROVED");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={showRetired} onCheckedChange={(v) => setShowRetired(v === true)} /> Show retired
        </label>
        <Button size="sm" variant="brand" onClick={() => setEditing({ r: null })}>
          <Plus className="size-3.5" /> Add a requirement
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={ListChecks} title="No requirements yet" description="Say what each jurisdiction and permit type asks for. A permit's Documents tab checks its files against these." />
      ) : (
        <Card className="min-w-0">
          <CardContent className="overflow-x-auto pt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requirement</TableHead>
                  <TableHead>Jurisdiction</TableHead>
                  <TableHead>Permit type</TableHead>
                  <TableHead>Met by</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className={r.status === "APPROVED" ? undefined : "opacity-60"}>
                    <TableCell className="min-w-[200px]">
                      <span className="font-medium">{r.title}</span>
                      {!r.required && <span className="text-xs text-muted-foreground"> · optional</span>}
                      {r.reliability === "OFFICIAL" && <Badge variant="outline" className="ml-1">Published</Badge>}
                      {r.status === "RETIRED" && <Badge variant="outline" className="ml-1">Retired</Badge>}
                    </TableCell>
                    <TableCell>{r.jurisdiction?.name ?? "Every jurisdiction"}</TableCell>
                    <TableCell>{typeName(r.permitTypeKey)}</TableCell>
                    <TableCell>{r.documentType ? permitDocLabel(r.documentType) : "A note"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${r.title}`} onClick={() => setEditing({ r })}>
                        <Pencil className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">{editing && <RequirementForm r={editing.r} onClose={() => setEditing(null)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function RequirementForm({ r, onClose }: { r: Requirement | null; onClose: () => void }) {
  const save = useSave([permitIntelKeys.requirements, ["permit"]]);
  const { data: jurisdictions = [] } = useJurisdictions(true);
  const { data: types = [] } = usePermitTypes();
  const [form, setForm] = useState({
    title: r?.title ?? "",
    body: r?.body ?? "",
    jurisdictionId: r?.jurisdictionId ?? ANY,
    permitTypeKey: r?.permitTypeKey ?? ANY,
    documentType: r?.documentType ?? ANY,
    required: r?.required ?? true,
    reliability: r?.reliability ?? "INTERNAL",
    sourceUrl: r?.sourceUrl ?? "",
    sortOrder: String(r?.sortOrder ?? 100),
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const jItems = [{ value: ANY, label: "Every jurisdiction" }, ...jurisdictions.map((j) => ({ value: j.id, label: j.name }))];
  const tItems = [{ value: ANY, label: "Every permit type" }, ...types.map((t) => ({ value: t.key, label: t.name }))];
  const body = {
    title: form.title,
    body: form.body,
    jurisdictionId: form.jurisdictionId === ANY ? null : form.jurisdictionId,
    permitTypeKey: form.permitTypeKey === ANY ? null : form.permitTypeKey,
    documentType: form.documentType === ANY ? null : form.documentType,
    required: form.required,
    reliability: form.reliability,
    sourceUrl: form.sourceUrl,
    sortOrder: Number(form.sortOrder) || 0,
  };
  const pick = (items: { value: string; label: string }[], value: string, onChange: (v: string) => void) => (
    <Select items={items} value={value} onValueChange={(v: string | null) => v && onChange(v)}>
      <SelectTrigger>
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
  return (
    <>
      <DialogHeader>
        <DialogTitle>{r ? "Edit requirement" : "Add a requirement"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="r-title">What is required</Label>
          <Input id="r-title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Recorded notice of commencement" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Jurisdiction</Label>
            {pick(jItems, form.jurisdictionId, (v) => set("jurisdictionId", v))}
          </div>
          <div className="space-y-1.5">
            <Label>Permit type</Label>
            {pick(tItems, form.permitTypeKey, (v) => set("permitTypeKey", v))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Met by a document of type</Label>
          {pick(DOC_ITEMS, form.documentType, (v) => set("documentType", v))}
        </div>
        <div className="space-y-1.5">
          <Label>Where it comes from</Label>
          {pick(RELIABILITY_ITEMS, form.reliability, (v) => set("reliability", v as typeof form.reliability))}
        </div>
        {form.reliability === "OFFICIAL" && (
          <div className="space-y-1.5">
            <Label htmlFor="r-src">Source link</Label>
            <Input id="r-src" value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="The department's published checklist" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="r-body">Details</Label>
          <Textarea id="r-body" rows={2} value={form.body} onChange={(e) => set("body", e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.required} onCheckedChange={(v) => set("required", v === true)} /> Required (off = recommended)
          </label>
          <div className="flex items-center gap-2">
            <Label htmlFor="r-order" className="text-xs">Order</Label>
            <Input id="r-order" className="h-8 w-20" inputMode="numeric" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value.replace(/\D/g, ""))} />
          </div>
        </div>
      </div>
      <DialogFooter className="gap-2">
        {r && r.status === "APPROVED" && (
          <Button variant="ghost" className="mr-auto" disabled={save.isPending} onClick={() => save.mutate({ url: `/api/permit-requirements/${r.id}`, method: "PATCH", body: { status: "RETIRED" } }, { onSuccess: () => { toast.success("Retired"); onClose(); } })}>
            Retire
          </Button>
        )}
        {r && r.status === "RETIRED" && (
          <Button variant="ghost" className="mr-auto" disabled={save.isPending} onClick={() => save.mutate({ url: `/api/permit-requirements/${r.id}`, method: "PATCH", body: { status: "APPROVED" } }, { onSuccess: () => { toast.success("Back in use"); onClose(); } })}>
            Bring back
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={form.title.trim().length < 2 || save.isPending}
          onClick={() => save.mutate({ url: r ? `/api/permit-requirements/${r.id}` : "/api/permit-requirements", method: r ? "PATCH" : "POST", body }, { onSuccess: () => { toast.success("Saved"); onClose(); } })}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}
