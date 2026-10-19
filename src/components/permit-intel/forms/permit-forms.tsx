"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, ChevronDown, ChevronRight, FileInput, FileText, Lock, PenLine, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Callout } from "@/components/shared/callout";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { formatFileSize } from "@/lib/files/limits";
import { CHECKED, UNCHECKED, type FillValue } from "@/lib/permit-intel/field-fill";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { permitIntelKeys } from "../use-permit-intel";
import type { PermitDetail } from "../types";
import { FILL_STATUS, type FillRow, type FillsData } from "./types";

const fillsKey = (permitId: string) => ["permit", permitId, "form-fills"] as const;

/** What a person must look at: missing, disagreeing, impossible, licences, signatures. */
const needsAPerson = (v: FillValue) => v.status === "MISSING" || v.status === "CONFLICT" || v.status === "UNMATCHED" || v.status === "SIGN_BY_HAND" || v.protected;

/**
 * The permit's application forms: the published forms that apply to its
 * jurisdiction and type, filled from the records field by field. A person
 * reads what was filled, types what is missing, signs by hand, and
 * finalises; the PDF lands on the permit's documents.
 */
export function PermitForms({ detail }: { detail: PermitDetail }) {
  const { permit } = detail;
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: fillsKey(permit.id), queryFn: () => fetchJson<FillsData>(`/api/permits/${permit.id}/form-fills`), retry: retryServerErrors });
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading) return <ListSkeleton rows={3} />;
  if (error || !data) return <Callout tone="danger" title="The forms did not load">{(error as Error | null)?.message ?? "Try again."}</Callout>;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: fillsKey(permit.id) });
    qc.invalidateQueries({ queryKey: permitIntelKeys.permit(permit.id), exact: true });
  };
  const start = async (templateId: string) => {
    setBusy(true);
    try {
      const f = await fetchJson<FillRow>(`/api/permits/${permit.id}/form-fills`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId }) });
      refresh();
      setOpen(f.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {data.permissions.canEdit && data.available.length > 0 && (
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Forms for this permit</CardTitle>
            <p className="text-xs text-muted-foreground">Published under Admin → Permits → Forms for {permit.jurisdiction?.name ?? permit.municipality}{permit.jurisdiction?.county ? ` and ${permit.jurisdiction.county} County` : ""}.</p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {data.available.map((t) => (
              <Button key={t.id} size="sm" variant="outline" disabled={busy} onClick={() => start(t.id)}>
                <FileInput className="size-3.5" /> Fill: {t.name}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
      {data.available.length === 0 && (
        <Callout tone="info" title="No form is published for this permit yet">
          {permit.jurisdictionId ? "An administrator uploads the department's blank application under Admin → Permits → Forms (or makes one from the Document assistant) and publishes it." : "Give the permit its jurisdiction first (Overview), so the right forms are offered."}
        </Callout>
      )}
      {data.fills.length === 0 ? (
        <EmptyState icon={FileText} title="No forms filled" description="Filling a form reads the owner, the property, the contractor's details and licence, and the scope from the records. You check it, add what is missing and finalise it." />
      ) : (
        data.fills.map((f) => <FillCard key={f.id} fill={f} leadId={permit.job.leadId} open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} permissions={data.permissions} onChanged={refresh} />)
      )}
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }) {
  if (!n) return null;
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses(tone).pill)}>{`${n} ${label}`}</span>;
}

function FillCard({ fill: f, leadId, open, onToggle, permissions, onChanged }: { fill: FillRow; leadId: string; open: boolean; onToggle: () => void; permissions: FillsData["permissions"]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"final" | "delete" | null>(null);
  const [only, setOnly] = useState<"attention" | "all">("attention");
  const draft = f.status === "DRAFT";
  const s = f.summary;
  const run = async (path: string, method: "POST" | "DELETE", ok: string) => {
    setBusy(true);
    try {
      const r = await fetchJson<{ skipped?: string[] }>(path, { method });
      toast.success(ok + (r?.skipped?.length ? ` (${r.skipped.length} field${r.skipped.length === 1 ? "" : "s"} the PDF refused — see the list)` : ""));
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const shown = f.values.filter((v) => only === "all" || needsAPerson(v));
  const pages = [...new Set(shown.map((v) => v.page))].sort((a, b) => a - b);

  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-1 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onToggle} className="flex min-w-0 items-center gap-1 text-left" aria-expanded={open}>
            {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
            <CardTitle className="truncate text-sm">{f.template.name}</CardTitle>
          </button>
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses(draft ? "warning" : "success").pill)}>
            {draft ? "Draft" : <><Lock className="size-3" /> Final</>}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Count n={s.FILLED} label="from records" tone="success" />
          <Count n={s.OVERRIDDEN} label="typed" tone="info" />
          <Count n={s.MISSING} label="missing" tone="warning" />
          <Count n={s.CONFLICT} label="disagree" tone="danger" />
          <Count n={s.UNMATCHED} label="not an option" tone="danger" />
          <Count n={s.SIGN_BY_HAND} label="to sign" tone="neutral" />
          <Count n={s.BLANK} label="left blank" tone="neutral" />
        </div>
        <p className="text-xs text-muted-foreground">
          Started {format(new Date(f.createdAt), "MMM d")} by {f.createdBy.firstName} {f.createdBy.lastName}
          {f.finalizedAt && f.finalizedBy ? ` · finalised ${format(new Date(f.finalizedAt), "MMM d, yyyy")} by ${f.finalizedBy.firstName} ${f.finalizedBy.lastName}` : ""}
        </p>
        {(f.flattenedFile || f.outputFile) && (
          <div className="flex flex-wrap gap-3 text-xs">
            {f.flattenedFile && (
              <a href={`/api/files/${f.flattenedFile.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                <FileText className="size-3" /> {f.flattenedFile.fileName} ({formatFileSize(f.flattenedFile.fileSize)})
              </a>
            )}
            {f.outputFile && (
              <a href={`/api/files/${f.outputFile.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:underline">
                editable copy
              </a>
            )}
          </div>
        )}
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 pt-0">
          {f.problems.length > 0 && draft && <Callout tone="warning" title="Before it can be finalised">{f.problems.join(". ")}.</Callout>}
          <Callout tone="info" icon={ShieldCheck}>
            Licences and the qualifier come only from what a person recorded (the permit&apos;s Parties, the company profile); signatures and notary blocks are completed by hand on the printed form.
          </Callout>
          <SegmentedControl
            value={only}
            onValueChange={setOnly}
            size="sm"
            ariaLabel="Which fields"
            options={[
              { value: "attention", label: `Needs a person (${f.values.filter(needsAPerson).length})` },
              { value: "all", label: `Every field (${f.values.length})` },
            ]}
          />
          {pages.map((p) => (
            <section key={p} className="min-w-0">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Page {p + 1}</h3>
              <ul className="divide-y rounded-md border">
                {shown
                  .filter((v) => v.page === p)
                  .map((v) => (
                    <ValueRow key={v.field} fill={f} value={v} leadId={leadId} canEdit={draft && permissions.canEdit} onChanged={onChanged} />
                  ))}
              </ul>
            </section>
          ))}
          {!shown.length && <p className="text-sm text-muted-foreground">Nothing needs a person.</p>}
          {draft && permissions.canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm("delete")}>
                <Trash2 className="size-3.5" /> Remove
              </Button>
              <span className="flex-1" />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(`/api/form-fills/${f.id}/render`, "POST", "The PDF is on the permit's Documents")}>
                <FileText className="size-3.5" /> {f.flattenedFile ? "Write the PDF again" : "Write the PDF"}
              </Button>
              {permissions.canFinalize && (
                <Button size="sm" variant="brand" disabled={busy || f.problems.length > 0} onClick={() => setConfirm("final")}>
                  <CheckCheck className="size-3.5" /> Finalise
                </Button>
              )}
            </div>
          )}
        </CardContent>
      )}
      <ConfirmDialog
        open={confirm === "final"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Finalise this form?"
        description={`It is written once more from the records as they stand and then kept as it is.${s.MISSING ? ` ${s.MISSING} field${s.MISSING === 1 ? " is" : "s are"} still empty and will print blank.` : ""}`}
        confirmLabel="Finalise"
        pending={busy}
        onConfirm={() => run(`/api/form-fills/${f.id}/finalize`, "POST", "Finalised")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone="warning"
        title="Remove this draft?"
        description="Its typed values and the PDFs it wrote go with it (a PDF already sent in a package stays)."
        confirmLabel="Remove"
        pending={busy}
        onConfirm={() => run(`/api/form-fills/${f.id}`, "DELETE", "Removed")}
      />
    </Card>
  );
}

const RECORD_LABEL: Record<string, string> = { "lead.parcelNumber": "parcel number", "lead.legalDescription": "legal description" };

function ValueRow({ fill, value: v, leadId, canEdit, onChanged }: { fill: FillRow; value: FillValue; leadId: string; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(v.value ?? "");
  const [busy, setBusy] = useState(false);
  const st = FILL_STATUS[v.status];
  const overridden = Object.prototype.hasOwnProperty.call(fill.overrides, v.field);

  const override = async (value: string | null) => {
    setBusy(true);
    try {
      await fetchJson(`/api/form-fills/${fill.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: v.field, value }) });
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // a missing parcel number belongs on the property, where every later form finds it
  const saveRecord = async () => {
    if (!v.recordField) return;
    setBusy(true);
    try {
      const field = v.recordField.split(".")[1];
      await fetchJson(`/api/leads/${leadId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: text.trim() || null }) });
      toast.success(`Saved on the property: ${RECORD_LABEL[v.recordField] ?? field}`);
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-sm font-medium">
            {v.label ?? v.field}
            {v.protected && <ShieldCheck className="ml-1 inline size-3.5 text-muted-foreground" aria-label="filled from records only" />}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{v.source ?? (v.status === "BLANK" ? "not mapped" : "")}</p>
        </div>
        <div className="min-w-0 flex-1 basis-48">
          <span className={cn("mr-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium", toneClasses(st.tone).pill)}>{st.label}</span>
          {v.status === "SIGN_BY_HAND" ? (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <PenLine className="size-3.5" /> on the printed form
            </span>
          ) : (
            <span className="break-words text-sm">{v.type === "checkbox" ? (v.value === CHECKED ? "☑ ticked" : v.value === UNCHECKED ? "☐ not ticked" : "—") : v.value || "—"}</span>
          )}
          {v.note && <p className="text-[11px] text-tone-warning-fg">{v.note}</p>}
        </div>
        {canEdit && v.type !== "signature" && !editing && (
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(true)}>
              {v.recordField && v.status === "MISSING" ? "Add" : "Change"}
            </Button>
            {overridden && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => override(null)}>
                Use the record
              </Button>
            )}
          </div>
        )}
      </div>
      {canEdit && v.status === "CONFLICT" && v.alternatives && !editing && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Use:</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => override(v.value ?? "")}>
            {v.value} <span className="text-muted-foreground">({v.source})</span>
          </Button>
          {v.alternatives.map((a) => (
            <Button key={a.source} size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => override(a.value)}>
              {a.value} <span className="text-muted-foreground">({a.source})</span>
            </Button>
          ))}
        </div>
      )}
      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          {v.type === "checkbox" ? (
            <SegmentedControl value={text === CHECKED ? CHECKED : UNCHECKED} onValueChange={setText} size="sm" options={[{ value: CHECKED, label: "Ticked" }, { value: UNCHECKED, label: "Not ticked" }]} />
          ) : v.type === "radio" || v.type === "dropdown" ? (
            <OptionSelect value={v} text={text} onText={setText} />
          ) : (
            <Input className="h-8 min-w-0 flex-1 basis-56 text-sm" value={text} onChange={(e) => setText(e.target.value)} aria-label={`Value for ${v.label ?? v.field}`} autoFocus />
          )}
          {v.recordField ? (
            <Button size="sm" variant="brand" className="h-8" disabled={busy || !text.trim()} onClick={saveRecord}>
              Save on the property
            </Button>
          ) : null}
          <Button size="sm" variant={v.recordField ? "outline" : "brand"} className="h-8" disabled={busy} onClick={() => override(text)}>
            {v.recordField ? "Only on this form" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      )}
    </li>
  );
}

function OptionSelect({ value: v, text, onText }: { value: FillValue; text: string; onText: (t: string) => void }) {
  const opts = v.options ?? [];
  if (!opts.length) return <Input className="h-8 min-w-0 flex-1 basis-56 text-sm" value={text} onChange={(e) => onText(e.target.value)} aria-label={`Option for ${v.label ?? v.field}`} />;
  const items = opts.map((o) => ({ value: o, label: o }));
  return (
    <Select items={items} value={text || null} onValueChange={(x: string | null) => x && onText(x)}>
      <SelectTrigger className="h-8 w-[220px] text-sm" aria-label={`Option for ${v.label ?? v.field}`}>
        <SelectValue placeholder="Choose" />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
