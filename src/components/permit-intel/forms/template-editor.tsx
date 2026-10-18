"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyPlus, ExternalLink, Loader2, Pencil, Send, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Callout } from "@/components/shared/callout";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { DICT_GROUP_LABEL, DICTIONARY, dictKey, type DictGroup } from "@/lib/permit-intel/data-dictionary";
import { mappingProblem, parseMapping, type FillValue, type InventoryField } from "@/lib/permit-intel/field-fill";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { formKeys, whereUsed } from "./form-templates";
import { FILL_STATUS, type FieldMapRow, type TemplateDetail } from "./types";

type Filter = "all" | "mapped" | "blank" | "check";

/** "Property owner name", "Fixed: Primary Permit", "Ticked when Permit type code is reroof", "Left for a person". */
export function describeMapping(dataKey: string | null, transform: string | null): string {
  const m = parseMapping(dataKey);
  const t = transform ? ` · ${transformLabel(transform)}` : "";
  if (m.kind === "none") return "Left for a person";
  if (m.kind === "literal") return `Fixed: ${m.text}${t}`;
  if (m.kind === "when") return `Ticked when ${dictKey(m.key)?.label ?? m.key} is ${m.equals}`;
  return `${dictKey(m.key)?.label ?? m.key}${t}`;
}

function transformLabel(t: string): string {
  if (t.startsWith("char:")) return `character ${t.slice(5)}`;
  if (t.startsWith("map:")) return `translated (${t.slice(4).split("|").length})`;
  return { upper: "capitals", date: "MM/DD/YYYY", phone: "(561) 555-0100", money: "12,345.00", digits: "digits only" }[t] ?? t;
}

/**
 * One form template: its fields as the PDF has them, beside what each is
 * filled with. A draft is mapped (by the AI, then by hand) and published; a
 * published form is kept as it is — editing starts its next version.
 */
export function TemplateEditor({ id }: { id: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: t, isLoading, error } = useQuery({
    queryKey: formKeys.one(id),
    queryFn: () => fetchJson<TemplateDetail>(`/api/permit-forms/${id}`),
    retry: retryServerErrors,
    refetchInterval: (q) => (q.state.data?.mapState === "MAPPING" ? 4_000 : false),
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<InventoryField | null>(null);
  const [permitId, setPermitId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"publish" | "retire" | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: permits = [] } = useQuery({ queryKey: ["permits", "for-preview"], queryFn: () => fetchJson<{ id: string; permitType: string | null; municipality: string; job: { jobNumber: string; lead: { propertyAddress1: string } } }[]>("/api/permits"), staleTime: 60_000 });
  const { data: preview } = useQuery({
    queryKey: ["permit-forms", id, "preview", permitId, t?.fields],
    queryFn: () => fetchJson<{ values: FillValue[] }>(`/api/permit-forms/${id}/preview?permitId=${permitId}`),
    enabled: !!permitId && !!t,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: formKeys.one(id) });
    qc.invalidateQueries({ queryKey: formKeys.list });
  };
  const act = async (path: string, ok: string, then?: (r: { id?: string }) => void) => {
    setBusy(true);
    try {
      const r = await fetchJson<{ id?: string }>(`/api/permit-forms/${id}/${path}`, { method: "POST" });
      toast.success(ok);
      refresh();
      then?.(r);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const maps = useMemo(() => new Map((t?.fields ?? []).map((f) => [f.fieldName, f])), [t?.fields]);
  const previewOf = useMemo(() => new Map((preview?.values ?? []).map((v) => [v.field, v])), [preview]);

  if (isLoading) return <ListSkeleton rows={8} />;
  if (error || !t) return <Callout tone="danger" title="The form did not load">{(error as Error | null)?.message ?? "Try again."}</Callout>;

  const draft = t.status === "DRAFT";
  const mapped = t.fields.filter((f) => f.dataKey).length;
  const unsure = (f: InventoryField) => {
    const m = maps.get(f.name);
    return f.type !== "signature" && !!m?.aiSuggested && ((m.confidence ?? 1) < 0.7 || /^Left blank:/.test(m.rationale ?? ""));
  };
  const shown = t.fieldInventory.filter((f) => {
    const m = maps.get(f.name);
    if (filter === "mapped") return !!m?.dataKey;
    if (filter === "blank") return !m?.dataKey && f.type !== "signature";
    if (filter === "check") return unsure(f);
    return true;
  });
  const pages = [...new Set(shown.map((f) => f.page))].sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Permit settings", href: "/admin/permits?tab=forms" }, { label: t.name }]}
        title={t.name}
        description={`${whereUsed(t)}${t.permitTypeKeys.length ? ` · ${t.permitTypeKeys.join(", ")}` : " · every permit type"} · version ${t.version}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" render={<a href={`/api/permit-forms/${id}/file`} target="_blank" rel="noreferrer" />} nativeButton={false}>
              <ExternalLink className="size-3.5" /> The blank form
            </Button>
            {draft ? (
              <>
                <Button variant="outline" size="sm" disabled={busy || t.mapState === "MAPPING"} onClick={() => act("map", "The AI is mapping the form")}>
                  <Sparkles className="size-3.5" /> {t.fields.some((f) => f.aiSuggested) ? "Map again with AI" : "Map with AI"}
                </Button>
                <Button variant="brand" size="sm" disabled={busy || t.mapState === "MAPPING" || !mapped} onClick={() => setConfirm("publish")}>
                  <Send className="size-3.5" /> Publish
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => act("revise", "A new version to edit", (r) => r.id && router.push(`/admin/permits/forms/${r.id}`))}>
                  <CopyPlus className="size-3.5" /> Edit (new version)
                </Button>
                {t.status === "PUBLISHED" && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm("retire")}>
                    <Trash2 className="size-3.5" /> Retire
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={t.status === "PUBLISHED" ? "default" : "outline"}>{t.status === "DRAFT" ? "Draft" : t.status === "PUBLISHED" ? "Published" : "Retired"}</Badge>
        <span className="text-muted-foreground">
          {t.fieldInventory.length} fields · {mapped} filled from records · {t.pageCount} page{t.pageCount === 1 ? "" : "s"} · {t._count.fills} filled on permits
          {t.publishedAt && t.publishedBy ? ` · published ${format(new Date(t.publishedAt), "MMM d, yyyy")} by ${t.publishedBy.firstName} ${t.publishedBy.lastName}` : ""}
        </span>
      </div>
      {t.mapState === "MAPPING" && (
        <Callout tone="info" icon={Loader2} title="The AI is mapping the fields">
          A long form takes a minute or two. Fields you mapped by hand are kept as they are.
        </Callout>
      )}
      {t.mapState === "FAILED" && <Callout tone="danger" title="The mapping did not finish">{t.mapError}</Callout>}
      {!draft && <Callout tone="info">A published form does not change, so fills already made stay as they were. “Edit (new version)” copies it as a draft; publishing that retires this one.</Callout>}

      <Card className="min-w-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <SegmentedControl<Filter>
            value={filter}
            onValueChange={setFilter}
            size="sm"
            ariaLabel="Which fields"
            options={[
              { value: "all", label: `All (${t.fieldInventory.length})` },
              { value: "mapped", label: `Filled (${mapped})` },
              { value: "blank", label: "Left for a person" },
              { value: "check", label: `Check these (${t.fieldInventory.filter(unsure).length})` },
            ]}
          />
          <div className="flex min-w-0 items-center gap-2">
            <Label htmlFor="try-permit" className="shrink-0 text-xs">
              Try on a permit
            </Label>
            <Select items={permits.map((p) => ({ value: p.id, label: `${p.job.lead.propertyAddress1} — ${p.permitType ?? "Permit"}` }))} value={permitId} onValueChange={(v: string | null) => setPermitId(v)}>
              <SelectTrigger id="try-permit" className="h-8 w-[240px] max-w-full text-xs">
                <SelectValue placeholder="Pick a permit" />
              </SelectTrigger>
              <SelectContent>
                {permits.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.job.lead.propertyAddress1} — {p.permitType ?? "Permit"} ({p.municipality})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {pages.map((page) => (
            <section key={page} className="min-w-0">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Page {page + 1}</h3>
              <ul className="divide-y rounded-md border">
                {shown
                  .filter((f) => f.page === page)
                  .map((f) => (
                    <FieldRow key={f.name} field={f} map={maps.get(f.name)} preview={previewOf.get(f.name)} canEdit={draft && t.mapState !== "MAPPING"} onEdit={() => setEditing(f)} />
                  ))}
              </ul>
            </section>
          ))}
          {!shown.length && <p className="text-sm text-muted-foreground">No fields here.</p>}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">{editing && <FieldMapForm templateId={id} field={editing} map={maps.get(editing.name)} onClose={() => setEditing(null)} />}</DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirm === "publish"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Publish this form?"
        description={`It will be offered on every permit it applies to (${whereUsed(t)}), filled field by field from the records as mapped here. It does not change afterwards.`}
        confirmLabel="Publish"
        pending={busy}
        onConfirm={() => act("publish", "Published")}
      />
      <ConfirmDialog
        open={confirm === "retire"}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone="warning"
        title="Retire this form?"
        description="It is no longer offered on permits. Forms already filled from it stay."
        confirmLabel="Retire"
        pending={busy}
        onConfirm={() => act("retire", "Retired")}
      />
    </div>
  );
}

function FieldRow({ field: f, map, preview, canEdit, onEdit }: { field: InventoryField; map?: FieldMapRow; preview?: FillValue; canEdit: boolean; onEdit: () => void }) {
  const low = !!map?.aiSuggested && (map.confidence ?? 1) < 0.7;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate text-sm font-medium">{f.label ?? f.name}</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {f.name} · {f.type}
          {f.options?.length ? ` · ${f.options.join(" / ")}` : ""}
        </p>
      </div>
      <div className="min-w-0 flex-1 basis-56">
        <p className={cn("text-sm", !map?.dataKey && "text-muted-foreground")}>{f.type === "signature" ? "Signed by hand" : describeMapping(map?.dataKey ?? null, map?.transform ?? null)}</p>
        {map?.aiSuggested && map.rationale && (
          <p className={cn("text-[11px]", low ? "text-tone-warning-fg" : "text-muted-foreground")}>
            <Sparkles className="mr-0.5 inline size-3" />
            {map.rationale}
            {map.confidence != null ? ` · ${Math.round(map.confidence * 100)}%` : ""}
          </p>
        )}
        {preview && (
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
            <span className={cn("rounded-full px-1.5 py-0.5 font-medium", toneClasses(FILL_STATUS[preview.status].tone).pill)}>{FILL_STATUS[preview.status].label}</span>
            {preview.value != null && <span className="truncate font-medium">{preview.value || "(empty)"}</span>}
          </p>
        )}
      </div>
      {canEdit && f.type !== "signature" && (
        <Button size="icon-sm" variant="ghost" aria-label={`Edit the mapping of ${f.label ?? f.name}`} onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
      )}
    </li>
  );
}

type Mode = "key" | "literal" | "when" | "none";
const TRANSFORMS = [
  { value: "none", label: "As recorded" },
  { value: "upper", label: "CAPITALS" },
  { value: "date", label: "Date MM/DD/YYYY" },
  { value: "phone", label: "Phone (561) 555-0100" },
  { value: "money", label: "Amount 12,345.00" },
  { value: "digits", label: "Digits only" },
  { value: "char", label: "One character (a number printed per box)" },
  { value: "map", label: "Translate values to the form's options" },
];
const GROUPS = Object.keys(DICT_GROUP_LABEL) as DictGroup[];
const KEY_ITEMS = DICTIONARY.map((d) => ({ value: d.key, label: d.label }));

function FieldMapForm({ templateId, field: f, map, onClose }: { templateId: string; field: InventoryField; map?: FieldMapRow; onClose: () => void }) {
  const qc = useQueryClient();
  const m = parseMapping(map?.dataKey ?? null);
  const [mode, setMode] = useState<Mode>(m.kind);
  const [key, setKey] = useState(m.kind === "key" || m.kind === "when" ? m.key : "");
  const [text, setText] = useState(m.kind === "literal" ? m.text : m.kind === "when" ? m.equals : "");
  const t0 = map?.transform ?? "";
  const [tKind, setTKind] = useState(t0.startsWith("char:") ? "char" : t0.startsWith("map:") ? "map" : t0 || "none");
  const [tArg, setTArg] = useState(t0.startsWith("char:") ? t0.slice(5) : t0.startsWith("map:") ? t0.slice(4) : "");
  const [busy, setBusy] = useState(false);

  const dataKey = mode === "none" ? null : mode === "literal" ? `literal:${text}` : mode === "when" ? `when:${key}=${text.trim()}` : key || null;
  const transform = mode === "key" || mode === "literal" ? (tKind === "none" ? null : tKind === "char" ? `char:${tArg}` : tKind === "map" ? `map:${tArg}` : tKind) : null;
  const problem = mode !== "none" && !dataKey ? "Choose what the field holds" : mappingProblem(f, dataKey, transform);
  const modes: { value: Mode; label: string }[] = [
    { value: "key", label: "From the records" },
    ...(f.type === "radio" || f.type === "dropdown" || f.type === "checkbox" || f.type === "text" ? [{ value: "literal" as Mode, label: "Always the same" }] : []),
    ...(f.type === "checkbox" ? [{ value: "when" as Mode, label: "Ticked when…" }] : []),
    { value: "none", label: "Left for a person" },
  ];

  const save = async () => {
    setBusy(true);
    try {
      await fetchJson(`/api/permit-forms/${templateId}/fields`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: [{ fieldName: f.name, dataKey, transform }] }) });
      qc.invalidateQueries({ queryKey: formKeys.one(templateId) });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const keySelect = (
    <Select items={KEY_ITEMS} value={key || null} onValueChange={(v: string | null) => v && setKey(v)}>
      <SelectTrigger className="w-full" aria-label="Data key">
        <SelectValue placeholder="Choose a piece of information" />
      </SelectTrigger>
      <SelectContent>
        {GROUPS.map((g) => (
          <SelectGroup key={g}>
            <SelectLabel>{DICT_GROUP_LABEL[g]}</SelectLabel>
            {DICTIONARY.filter((d) => d.group === g).map((d) => (
              <SelectItem key={d.key} value={d.key}>
                {d.label}
                {d.protected ? " (records only)" : ""}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-6">{f.label ?? f.name}</DialogTitle>
        <DialogDescription className="font-mono text-[11px]">
          {f.name} · {f.type} · page {f.page + 1}
          {f.options?.length ? ` · ${f.options.join(" / ")}` : ""}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <SegmentedControl<Mode> value={mode} onValueChange={setMode} size="sm" options={modes} ariaLabel="What the field holds" className="flex-wrap" />
        {mode === "key" && keySelect}
        {mode === "literal" &&
          (f.options?.length ? (
            <Select items={f.options.map((o) => ({ value: o, label: o }))} value={text || null} onValueChange={(v: string | null) => v && setText(v)}>
              <SelectTrigger className="w-full" aria-label="Option">
                <SelectValue placeholder="Choose the option" />
              </SelectTrigger>
              <SelectContent>
                {f.options.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : f.type === "checkbox" ? (
            <SegmentedControl value={text === "Yes" ? "Yes" : "Off"} onValueChange={setText} size="sm" options={[{ value: "Yes", label: "Ticked" }, { value: "Off", label: "Not ticked" }]} />
          ) : (
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="The text every permit gets" aria-label="Fixed text" />
          ))}
        {mode === "when" && (
          <div className="space-y-2">
            {keySelect}
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="…has this value (e.g. reroof)" aria-label="Value" />
          </div>
        )}
        {(mode === "key" || mode === "literal") && f.type !== "checkbox" && (
          <div className="space-y-2">
            <Label className="text-xs">Written as</Label>
            <Select items={TRANSFORMS} value={tKind} onValueChange={(v: string | null) => v && setTKind(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSFORMS.map((x) => (
                  <SelectItem key={x.value} value={x.value}>
                    {x.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tKind === "char" && <Input inputMode="numeric" value={tArg} onChange={(e) => setTArg(e.target.value.replace(/\D/g, ""))} placeholder="Which character (1 = the first box)" aria-label="Character number" />}
            {tKind === "map" && <Input value={tArg} onChange={(e) => setTArg(e.target.value)} placeholder="reroof=Roofing|building=Structural" aria-label="Translation" />}
          </div>
        )}
        {mode === "key" && key && dictKey(key)?.protected && <Callout tone="info">Licence and qualifier fields are filled only from what a person recorded — the permit&apos;s qualifier, else the company profile — and left blank otherwise.</Callout>}
        {problem && <p className="text-xs text-tone-danger-fg">{problem}</p>}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="brand" disabled={busy || !!problem} onClick={save}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
