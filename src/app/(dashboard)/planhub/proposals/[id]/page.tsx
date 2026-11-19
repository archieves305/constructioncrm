"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, FileText, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { baseTotal, confirmProblems, LINE_KINDS, type ReviewDraft, type ReviewFieldKey } from "@/lib/bids/proposal-plan";
import { useOrganizations, type OrgDetail } from "@/components/partners/use-partners";
import { Pill } from "@/components/bids/pill";
import { usd, useInvalidateBidProjects } from "@/components/bids/use-bid-projects";

type Match = { id: string; number: string; name: string; matchedBy: "platform" | "address" | "name"; city: string | null };
type View = {
  id: string;
  version: number;
  status: "EXTRACTING" | "REVIEW" | "VERIFIED" | "FAILED" | "SUPERSEDED";
  extractError: string | null;
  bidProjectId: string | null;
  file: { id: string; fileName: string } | null;
  proposal: { id: string; number: string | null; title: string; bidProject: { id: string; number: string; name: string } | null };
  draft: ReviewDraft;
  hasAiReading: boolean;
  projectMatches: Match[];
  gcMatches: { id: string; name: string; how: string; contactId: string | null }[];
  supporting: { id: string; fileName: string }[];
  trades: { value: string; label: string }[];
  total: number | null;
  lines: { id: string; kind: string; description: string | null; amount: number; scope: { label: string } | null }[];
  canManage: boolean;
};
type GcRow = { organizationId: string; contactId: string; bidDueAt: string };

const BUNDLE = "__bundle";
const NEW = "__new";
const NONE = "__none";
const KIND_LABEL: Record<(typeof LINE_KINDS)[number], string> = { BASE: "Base", ALTERNATE: "Alternate", ALLOWANCE: "Allowance", UNIT: "Unit price" };
const FIELD_LABEL: Record<ReviewFieldKey, string> = {
  projectName: "Project name", address1: "Street", city: "City", state: "State", zipCode: "Zip", county: "County", projectType: "Project type", ownerName: "Owner / client",
  proposalNumber: "Proposal number", proposalDate: "Proposal date", validUntil: "Price good until", baseBid: "Total base bid", gcCompany: "GC (as written)", subDeadline: "Sub proposals due to the GC",
  ownerDeadline: "GC bids due to the owner", expectedAwardDate: "Expected award", expectedStartDate: "Expected start", planhubProjectId: "PlanHub project ID", planhubUrl: "PlanHub link",
};
const PROJECT_FIELDS: ReviewFieldKey[] = ["projectName", "address1", "city", "state", "zipCode", "county", "projectType", "ownerName", "planhubProjectId", "planhubUrl", "ownerDeadline", "expectedAwardDate", "expectedStartDate"];
const PROPOSAL_FIELDS: ReviewFieldKey[] = ["proposalNumber", "proposalDate", "validUntil", "gcCompany", "subDeadline"];

/** An ISO date-time the model gave → datetime-local; a bare day stays a day. */
const toLocalInput = (v: string) => {
  if (!v || /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toInstant = (v: string) => (!v ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date(v).toISOString());
const dayOnly = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export default function ProposalReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery<View>({
    queryKey: ["bid-projects", "proposal", id],
    queryFn: () => fetchJson(`/api/bid-proposals/${id}`),
    retry: retryServerErrors,
    refetchInterval: (query) => (query.state.data?.status === "EXTRACTING" ? 3000 : false),
  });
  if (q.isLoading) return <ListSkeleton rows={6} />;
  if (q.isError || !q.data) return <EmptyState icon={FileText} title="This upload could not be loaded" description={(q.error as Error | null)?.message ?? "Not found"} action={<Button variant="outline" render={<Link href="/planhub" />} nativeButton={false}>Back</Button>} />;
  const v = q.data;
  if (v.status === "EXTRACTING") {
    return (
      <div className="space-y-4">
        <PageHeader title="Reading the estimate…" breadcrumb={[{ label: "PlanHub Bids", href: "/planhub" }, { label: "Upload" }]} description={v.file?.fileName ?? ""} />
        <Card><CardContent className="flex items-center gap-3 p-6 text-sm"><Loader2 className="size-5 animate-spin" /> The AI is reading the document. This usually takes under a minute; the page updates by itself.</CardContent></Card>
      </div>
    );
  }
  if (v.status === "VERIFIED" || v.status === "SUPERSEDED") return <Confirmed v={v} />;
  return <Review key={`${v.id}-${v.hasAiReading}`} v={v} />;
}

function Confirmed({ v }: { v: View }) {
  return (
    <div className="space-y-4">
      <PageHeader title={`${v.proposal.title} — v${v.version}`} badge={<Pill tone={v.status === "VERIFIED" ? "success" : "neutral"}>{v.status === "VERIFIED" ? "Checked" : "Superseded"}</Pill>} breadcrumb={[{ label: "PlanHub Bids", href: "/planhub" }, ...(v.proposal.bidProject ? [{ label: v.proposal.bidProject.number, href: `/planhub/projects/${v.proposal.bidProject.id}` }] : []), { label: `v${v.version}` }]} description="A confirmed proposal is never edited. A revision is a new upload." />
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <p>Total base bid: <strong>{usd(v.total)}</strong></p>
          <ul className="space-y-1">{v.lines.map((l) => <li key={l.id}>{l.scope?.label ?? "Bundle"} · {l.kind.toLowerCase()} · {usd(l.amount)}{l.description ? ` — ${l.description}` : ""}</li>)}</ul>
          {v.file && <a className="underline" href={`/api/files/${v.file.id}`} target="_blank" rel="noreferrer">Open the document</a>}
        </CardContent>
      </Card>
    </div>
  );
}

function stateTone(state: string, required: boolean) {
  if (state === "missing") return required ? "danger" : "neutral";
  return state === "uncertain" ? "warning" : "success";
}

function Review({ v }: { v: View }) {
  const router = useRouter();
  const qc = useQueryClient();
  const invalidate = useInvalidateBidProjects();
  const [draft, setDraft] = useState<ReviewDraft>(v.draft);
  const firstMatch = v.projectMatches.find((m) => m.matchedBy === "platform") ?? v.projectMatches[0] ?? null;
  const [project, setProject] = useState<string>(v.bidProjectId ?? firstMatch?.id ?? NEW);
  const [variantOrg, setVariantOrg] = useState<string>(NONE);
  const [gcs, setGcs] = useState<GcRow[]>(() => (v.gcMatches[0] ? [{ organizationId: v.gcMatches[0].id, contactId: v.gcMatches[0].contactId ?? NONE, bidDueAt: toLocalInput(v.draft.fields.subDeadline.value) }] : []));
  const accounts = useOrganizations(new URLSearchParams({ pageSize: "500" }));
  const platformTaken = v.projectMatches.some((m) => m.matchedBy === "platform");

  const setField = (k: ReviewFieldKey, value: string) => setDraft((d) => ({ ...d, fields: { ...d.fields, [k]: { ...d.fields[k], value, state: value.trim() ? "ok" : "missing" } } }));
  const setLine = (i: number, patch: Partial<ReviewDraft["lines"][number]>) => setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch, confidence: null } : l)) }));

  const total = Number(draft.fields.baseBid.value.replace(/[$,\s]/g, "")) || 0;
  const linesSum = baseTotal(draft.lines);
  const bundleAdjustment = Math.round((total - linesSum) * 100) / 100;
  const creating = project === NEW;
  const problems = useMemo(() => {
    const p = confirmProblems({ total, bundleAdjustment: bundleAdjustment <= 0 ? bundleAdjustment : 0, lines: draft.lines.map((l) => ({ serviceCategoryId: l.serviceCategoryId, kind: l.kind, description: l.description, amount: l.amount })), projectName: draft.fields.projectName.value, creatingProject: creating, gcs: gcs.map((g) => ({ organizationId: g.organizationId || null, bidDueAt: g.bidDueAt || null })) });
    if (bundleAdjustment > 0.5) p.push(`The lines add up to ${usd(linesSum)}, less than the total ${usd(total)}: add the missing line or correct the total`);
    if (creating && platformTaken) p.push("A project with this PlanHub ID is already here — file under it");
    return p;
  }, [draft, total, linesSum, bundleAdjustment, creating, gcs, platformTaken]);

  const save = useMutation({
    mutationFn: () => fetchJson(`/api/bid-proposals/${v.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }),
    onSuccess: () => toast.success("Saved"),
    onError: (e: Error) => toast.error(e.message),
  });
  const reread = useMutation({
    mutationFn: () => fetchJson(`/api/bid-proposals/${v.id}/reread`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Reading it again");
      qc.invalidateQueries({ queryKey: ["bid-projects", "proposal", v.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const confirm = useMutation({
    mutationFn: () => {
      const f = draft.fields;
      const create = { name: f.projectName.value, address1: f.address1.value || null, city: f.city.value || null, state: f.state.value.slice(0, 2).toUpperCase() || null, zipCode: f.zipCode.value || null, county: f.county.value || null, source: "PLANHUB", platformRef: f.planhubProjectId.value || null, platformUrl: /^https?:\/\//.test(f.planhubUrl.value) ? f.planhubUrl.value : null, ownerName: f.ownerName.value || null, projectType: f.projectType.value || null, ownerBidDueAt: toInstant(toLocalInput(f.ownerDeadline.value)), expectedPrimeAwardAt: dayOnly(f.expectedAwardDate.value), expectedStartAt: dayOnly(f.expectedStartDate.value) };
      return fetchJson<{ projectId: string; opportunities: { number: string; status: string; ready: string[] }[] }>(`/api/bid-proposals/${v.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: creating ? { create, force: true } : { id: project },
          proposalNumber: f.proposalNumber.value || null,
          proposalDate: dayOnly(f.proposalDate.value),
          validUntil: dayOnly(f.validUntil.value),
          total,
          bundleAdjustment: Math.min(0, bundleAdjustment),
          lines: draft.lines.map((l) => ({ serviceCategoryId: l.serviceCategoryId, kind: l.kind, description: l.description || null, amount: l.amount })),
          inclusions: draft.inclusions || null,
          exclusions: draft.exclusions || null,
          alternates: draft.alternates || null,
          clarifications: draft.clarifications || null,
          organizationId: variantOrg === NONE ? null : variantOrg,
          gcs: gcs.map((g) => ({ organizationId: g.organizationId, contactId: g.contactId === NONE ? null : g.contactId, bidDueAt: toInstant(g.bidDueAt) })),
        }),
      });
    },
    onSuccess: (r) => {
      invalidate();
      const notReady = r.opportunities.filter((o) => o.status !== "READY_TO_SUBMIT");
      toast.success(`Proposal checked${r.opportunities.length ? ` — ${r.opportunities.length - notReady.length} of ${r.opportunities.length} GC(s) ready to submit` : ""}`);
      router.push(`/planhub/projects/${r.projectId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const accountItems = (accounts.data?.rows ?? []).map((o) => ({ value: o.id, label: o.name }));
  const tradeItems = [...v.trades, { value: BUNDLE, label: "Bundle (no split)" }];

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Check: ${v.file?.fileName ?? v.proposal.title}`}
        badge={<Pill tone={v.status === "FAILED" ? "danger" : "warning"}>{v.status === "FAILED" ? "Not read — type the values" : "Needs checking"}</Pill>}
        breadcrumb={[{ label: "PlanHub Bids", href: "/planhub" }, { label: "Upload" }]}
        description={draft.summary || "Check each value against the document. Amber = check it, red = required and missing. Nothing is filed until you confirm."}
        actions={
          v.canManage ? (
            <div className="flex flex-wrap gap-2">
              {v.file && <Button variant="outline" size="sm" render={<a href={`/api/files/${v.file.id}`} target="_blank" rel="noreferrer" />} nativeButton={false}><FileText className="mr-1.5 size-4" /> Open document</Button>}
              <Button variant="outline" size="sm" onClick={() => reread.mutate()} disabled={reread.isPending}><RefreshCw className="mr-1.5 size-4" /> Read again</Button>
              <Button variant="outline" size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save draft</Button>
            </div>
          ) : undefined
        }
      />
      {v.extractError && <div className="rounded-md border bg-tone-danger-soft p-3 text-sm">{v.extractError}</div>}
      {draft.documentKind === "invitation" || draft.documentKind === "other" ? <div className="rounded-md border bg-tone-warning-soft p-3 text-sm">The main document does not look like an estimate or proposal ({draft.documentKind}). Check you uploaded the right file.</div> : null}
      {draft.conflicts.length > 0 && (
        <Card className="border-tone-warning-fg/30">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4" /> Read two ways — pick the right one</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {draft.conflicts.map((c, i) => (
              <p key={i}><strong>{FIELD_LABEL[c.field as ReviewFieldKey] ?? c.field}:</strong> {c.values.map((x) => `${x.value}${x.source ? ` (${x.source})` : ""}`).join("  vs  ")}</p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader><CardTitle className="text-base">Project</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {v.bidProjectId ? (
              <p className="text-sm">Filed under <Link className="underline" href={`/planhub/projects/${v.bidProjectId}`}>{v.proposal.bidProject?.number} · {v.proposal.bidProject?.name}</Link></p>
            ) : (
              <div className="space-y-1.5 text-sm" role="radiogroup" aria-label="Project">
                {v.projectMatches.map((m) => (
                  <label key={m.id} className="flex items-start gap-2">
                    <input type="radio" name="project" checked={project === m.id} onChange={() => setProject(m.id)} />
                    <span>{m.number} · {m.name} <span className="text-muted-foreground">({m.matchedBy === "platform" ? "same PlanHub project" : m.matchedBy === "address" ? "same address" : "similar name"})</span></span>
                  </label>
                ))}
                <label className="flex items-start gap-2">
                  <input type="radio" name="project" checked={project === NEW} onChange={() => setProject(NEW)} disabled={platformTaken} />
                  <span>A new project from the fields below{v.projectMatches.length ? " — it is not one of these" : ""}</span>
                </label>
              </div>
            )}
            <div className={cn("grid gap-3 sm:grid-cols-2", !creating && "opacity-70")}>
              {PROJECT_FIELDS.map((k) => <ReviewInput key={k} k={k} draft={draft} onChange={setField} required={creating && k === "projectName"} />)}
            </div>
            {!creating && <p className="text-xs text-muted-foreground">Filing under an existing project keeps that project&rsquo;s details; these values are for reference.</p>}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader><CardTitle className="text-base">Proposal</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <ReviewInput k="baseBid" draft={draft} onChange={setField} required />
              {PROPOSAL_FIELDS.map((k) => <ReviewInput key={k} k={k} draft={draft} onChange={setField} />)}
            </div>
            <Field label="Priced for">
              <Select items={[{ value: NONE, label: "Every GC on the project" }, ...accountItems]} value={variantOrg} onValueChange={(x: string | null) => setVariantOrg(x ?? NONE)}>
                <SelectTrigger className="w-full" aria-label="Priced for"><SelectValue /></SelectTrigger>
                <SelectContent>{[{ value: NONE, label: "Every GC on the project" }, ...accountItems].map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Prices by scope</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {draft.lines.length === 0 && <p className="text-sm text-muted-foreground">No lines yet. Add one per trade (or one bundle line when the price covers several trades with no split).</p>}
          {draft.lines.map((l, i) => (
            <div key={i} className={cn("grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,8rem)_minmax(0,1fr)_minmax(0,8rem)_auto]", l.confidence !== null && l.confidence < 0.7 && "border-tone-warning-fg/40 bg-tone-warning-soft/40")}>
              <Select items={tradeItems} value={l.serviceCategoryId ?? BUNDLE} onValueChange={(x: string | null) => setLine(i, { serviceCategoryId: !x || x === BUNDLE ? null : x })}>
                <SelectTrigger className="w-full" aria-label="Trade"><SelectValue /></SelectTrigger>
                <SelectContent>{tradeItems.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select items={LINE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} value={l.kind} onValueChange={(x: string | null) => setLine(i, { kind: (x as typeof l.kind) ?? "BASE" })}>
                <SelectTrigger className="w-full" aria-label="Kind"><SelectValue /></SelectTrigger>
                <SelectContent>{LINE_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
              </Select>
              <Input aria-label="Description" value={l.description} placeholder={l.tradeText} onChange={(e) => setLine(i, { description: e.target.value })} />
              <Input aria-label="Amount" type="number" step="0.01" value={String(l.amount)} onChange={(e) => setLine(i, { amount: Number(e.target.value) })} />
              <div className="flex items-center gap-1">
                <span className="text-2xs text-muted-foreground">{l.source ?? ""}</span>
                <Button type="button" variant="ghost" size="sm" aria-label="Remove line" onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></Button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, { serviceCategoryId: null, tradeText: "", description: "", kind: "BASE", amount: 0, source: null, confidence: null }] }))}><Plus className="mr-1.5 size-4" /> Add a line</Button>
            <span>Base lines {usd(linesSum)} · total {usd(total)}{bundleAdjustment < -0.5 ? ` · bundle discount ${usd(bundleAdjustment)}` : ""}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {(["inclusions", "exclusions", "alternates", "clarifications"] as const).map((k) => (
          <Field key={k} label={k[0]!.toUpperCase() + k.slice(1)} id={`r-${k}`}>
            <Textarea id={`r-${k}`} rows={4} value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
          </Field>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">GCs this proposal goes to</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {v.gcMatches.length > 0 && <p className="text-xs text-muted-foreground">Suggested from the documents: {v.gcMatches.map((m) => `${m.name} (${m.how})`).join(", ")}. A GC that is not in the CRM yet is added under Business Development first.</p>}
          {draft.gcContacts.length > 0 && <p className="text-xs text-muted-foreground">People named in the documents: {draft.gcContacts.map((c) => [c.name, c.email].filter(Boolean).join(" ")).join("; ")}</p>}
          {gcs.map((g, i) => <GcRowEditor key={i} row={g} accounts={accountItems} onChange={(row) => setGcs((x) => x.map((r, j) => (j === i ? row : r)))} onRemove={() => setGcs((x) => x.filter((_, j) => j !== i))} />)}
          <Button type="button" variant="outline" size="sm" onClick={() => setGcs((x) => [...x, { organizationId: "", contactId: NONE, bidDueAt: toLocalInput(draft.fields.subDeadline.value) }])}><Plus className="mr-1.5 size-4" /> Add a GC</Button>
          <p className="text-xs text-muted-foreground">Confirming adds these GCs to the project (or updates them) and marks each Ready to submit when someone there has an email. It does not record anything as sent.</p>
        </CardContent>
      </Card>

      {problems.length > 0 && (
        <div className="rounded-md border bg-tone-danger-soft p-3 text-sm">
          <p className="font-medium">Before confirming:</p>
          <ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {v.canManage && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>Save draft</Button>
          <Button variant="brand" onClick={() => confirm.mutate()} disabled={problems.length > 0 || confirm.isPending}>{confirm.isPending ? "Filing…" : "Confirm the values"}</Button>
        </div>
      )}
    </div>
  );
}

function ReviewInput({ k, draft, onChange, required }: { k: ReviewFieldKey; draft: ReviewDraft; onChange: (k: ReviewFieldKey, v: string) => void; required?: boolean }) {
  const f = draft.fields[k];
  const tone = stateTone(f.state, Boolean(required));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`f-${k}`} className="text-sm font-medium">{FIELD_LABEL[k]}{required ? " *" : ""}</label>
        {(f.state !== "ok" || f.source) && <Pill tone={tone as "danger"}>{f.state === "missing" ? (required ? "Required" : "Not found") : f.state === "uncertain" ? `Check${f.source ? ` · ${f.source}` : ""}` : f.source}</Pill>}
      </div>
      <Input id={`f-${k}`} value={f.value} onChange={(e) => onChange(k, e.target.value)} className={cn(f.state === "uncertain" && "border-tone-warning-fg/60", f.state === "missing" && required && "border-tone-danger-fg/60")} />
    </div>
  );
}

function GcRowEditor({ row, accounts, onChange, onRemove }: { row: GcRow; accounts: { value: string; label: string }[]; onChange: (r: GcRow) => void; onRemove: () => void }) {
  const org = useQuery<OrgDetail>({ queryKey: ["partners", "detail", row.organizationId], queryFn: () => fetchJson(`/api/partners/${row.organizationId}`), retry: retryServerErrors, enabled: Boolean(row.organizationId) });
  const contacts = (org.data?.organization.contacts ?? []).filter((c) => c.isActive);
  const contactItems = [{ value: NONE, label: "No one yet" }, ...contacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}${c.email ? "" : " (no email)"}` }))];
  useEffect(() => {
    if (row.contactId !== NONE && contacts.length && !contacts.some((c) => c.id === row.contactId)) onChange({ ...row, contactId: NONE });
  }, [contacts, row, onChange]);
  return (
    <div className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,12rem)_auto]">
      <Select items={accounts} value={row.organizationId || null} onValueChange={(x: string | null) => onChange({ ...row, organizationId: x ?? "", contactId: NONE })}>
        <SelectTrigger className="w-full" aria-label="GC"><SelectValue placeholder="Pick the GC" /></SelectTrigger>
        <SelectContent>{accounts.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
      </Select>
      <Select items={contactItems} value={row.contactId} onValueChange={(x: string | null) => onChange({ ...row, contactId: x ?? NONE })} disabled={!row.organizationId}>
        <SelectTrigger className="w-full" aria-label="GC contact"><SelectValue /></SelectTrigger>
        <SelectContent>{contactItems.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
      </Select>
      <Input aria-label="Sub proposals due" type="datetime-local" value={row.bidDueAt} onChange={(e) => onChange({ ...row, bidDueAt: e.target.value })} />
      <Button type="button" variant="ghost" size="sm" aria-label="Remove GC" onClick={onRemove}><Trash2 className="size-4" /></Button>
    </div>
  );
}
