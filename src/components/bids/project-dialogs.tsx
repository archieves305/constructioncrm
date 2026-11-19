"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { useBidOptions, useOrganizations, type OrgDetail } from "@/components/partners/use-partners";
import { uploadToLead, useBidProjectAction, useInvalidateBidProjects, type Opportunity, type ProjectDetail, type ScopeStatus } from "./use-bid-projects";

const NONE = "__none";

/** datetime-local → ISO with the browser's offset; a bare date stays a day. */
const instant = (v: string) => (!v ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date(v).toISOString());

function TradeChips({ trades, value, onChange }: { trades: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {trades.map((t) => {
        const on = value.includes(t.value);
        return (
          <Button key={t.value} type="button" size="sm" variant={on ? "default" : "outline"} className="h-7 rounded-full text-xs" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== t.value) : [...value, t.value])}>
            {t.label}
          </Button>
        );
      })}
    </div>
  );
}

// ── New project ──────────────────────────────────────────────────────────

type Match = { id: string; number: string; name: string; matchedBy: "platform" | "address" | "name"; city: string | null };

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">{open && <NewProjectForm onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function NewProjectForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const invalidate = useInvalidateBidProjects();
  const { data: options } = useBidOptions();
  const [f, setF] = useState({ name: "", address1: "", city: "", state: "FL", zipCode: "", county: "", platformRef: "", platformUrl: "", ownerName: "", projectType: "", ownerBidDueAt: "", trades: [] as string[] });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(force: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/bid-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: f.name, address1: f.address1 || null, city: f.city || null, state: f.state || null, zipCode: f.zipCode || null, county: f.county || null,
          source: "PLANHUB", platformRef: f.platformRef || null, platformUrl: f.platformUrl || null, ownerName: f.ownerName || null, projectType: f.projectType || null,
          ownerBidDueAt: instant(f.ownerBidDueAt), scopes: f.trades.map((serviceCategoryId) => ({ serviceCategoryId })), force,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && Array.isArray(body.matches)) {
        setMatches(body.matches);
        if (body.matches.some((m: Match) => m.matchedBy === "platform")) toast.error(body.error);
        return;
      }
      if (!res.ok) throw new Error(body.error ?? `Could not save (${res.status})`);
      invalidate();
      toast.success(`${body.number} created`);
      onClose();
      router.push(`/planhub/projects/${body.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ok = f.name.trim().length >= 2 && f.trades.length > 0;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <DialogHeader>
        <DialogTitle>New bid project</DialogTitle>
        <DialogDescription>The job everyone is bidding. Add each GC you send a price to from the project page — every GC is tracked on its own.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Project name" id="p-name" className="sm:col-span-6"><Input id="p-name" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={200} required /></Field>
        <Field label="Street" id="p-addr" className="sm:col-span-6"><Input id="p-addr" value={f.address1} onChange={(e) => set("address1", e.target.value)} maxLength={200} /></Field>
        <Field label="City" id="p-city" className="sm:col-span-2"><Input id="p-city" value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="State" id="p-state" className="sm:col-span-1"><Input id="p-state" value={f.state} onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))} /></Field>
        <Field label="Zip" id="p-zip" className="sm:col-span-1"><Input id="p-zip" value={f.zipCode} onChange={(e) => set("zipCode", e.target.value)} inputMode="numeric" /></Field>
        <Field label="County" id="p-county" className="sm:col-span-2"><Input id="p-county" value={f.county} onChange={(e) => set("county", e.target.value)} /></Field>
        <Field label="PlanHub project link" id="p-url" className="sm:col-span-4"><Input id="p-url" value={f.platformUrl} onChange={(e) => set("platformUrl", e.target.value)} placeholder="https://app.planhub.com/…" /></Field>
        <Field label="PlanHub project ID" id="p-ref" className="sm:col-span-2"><Input id="p-ref" value={f.platformRef} onChange={(e) => set("platformRef", e.target.value)} /></Field>
        <Field label="Owner / client" id="p-owner" className="sm:col-span-3"><Input id="p-owner" value={f.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></Field>
        <Field label="Project type" id="p-type" className="sm:col-span-3"><Input id="p-type" value={f.projectType} onChange={(e) => set("projectType", e.target.value)} placeholder="Hotel, multifamily, school…" /></Field>
        <Field label="GC bids due to the owner" id="p-due" className="sm:col-span-3"><Input id="p-due" type="datetime-local" value={f.ownerBidDueAt} onChange={(e) => set("ownerBidDueAt", e.target.value)} /></Field>
        <div className="space-y-1.5 sm:col-span-6">
          <Label>Scopes KNU is bidding</Label>
          <TradeChips trades={options?.trades ?? []} value={f.trades} onChange={(v) => set("trades", v)} />
        </div>
      </div>
      {matches && matches.length > 0 && (
        <div className="rounded-md border border-tone-warning-fg/30 bg-tone-warning-soft p-3 text-sm">
          <p className="font-medium">This may already be here:</p>
          <ul className="mt-1 space-y-1">
            {matches.map((m) => (
              <li key={m.id}>
                <a className="underline" href={`/planhub/projects/${m.id}`}>{m.number} · {m.name}</a> <span className="text-muted-foreground">({m.matchedBy === "platform" ? "same PlanHub project" : m.matchedBy === "address" ? "same address" : "similar name"}{m.city ? ` · ${m.city}` : ""})</span>
              </li>
            ))}
          </ul>
          {!matches.some((m) => m.matchedBy === "platform") && <Button type="button" size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => save(true)}>It is a different project — create it</Button>}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="brand" disabled={!ok || busy}>Create project</Button>
      </DialogFooter>
    </form>
  );
}

// ── Add a GC ─────────────────────────────────────────────────────────────

export function AddGcDialog({ project, open, onOpenChange }: { project: ProjectDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">{open && <AddGcForm project={project} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function AddGcForm({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const { data: options } = useBidOptions();
  const taken = new Set(project.opportunities.map((o) => o.organizationId));
  const accounts = useOrganizations(new URLSearchParams({ pageSize: "500" }));
  const [f, setF] = useState({ organizationId: "", contactId: NONE, estimatorUserId: NONE, pmUserId: NONE, scopeIds: project.scopes.map((s) => s.id), bidDueAt: "", expectedAwardAt: "", platformUrl: "", scheduleNotes: "" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const org = useQuery<OrgDetail>({ queryKey: ["partners", "detail", f.organizationId], queryFn: () => fetchJson(`/api/partners/${f.organizationId}`), retry: retryServerErrors, enabled: Boolean(f.organizationId) });
  const contacts = useMemo(() => (org.data?.organization.contacts ?? []).filter((c) => c.isActive), [org.data]);
  const add = useBidProjectAction<Record<string, unknown>, Opportunity>(`/api/bid-projects/${project.id}/opportunities`, "POST", (o) => `${o.number} added`);
  const accountItems = (accounts.data?.rows ?? []).filter((o) => !taken.has(o.id)).map((o) => ({ value: o.id, label: o.name }));
  const contactItems = [{ value: NONE, label: "No one yet" }, ...contacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}${c.email ? "" : " (no email)"}` }))];
  const people = [{ value: NONE, label: "Not assigned" }, ...(options?.owners ?? [])];
  const pick = (v: string) => (v === NONE ? null : v);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate(
          { organizationId: f.organizationId, contactId: pick(f.contactId), estimatorUserId: pick(f.estimatorUserId), pmUserId: pick(f.pmUserId), scopeIds: f.scopeIds, bidDueAt: instant(f.bidDueAt), expectedAwardAt: f.expectedAwardAt || null, platformUrl: f.platformUrl || null, scheduleNotes: f.scheduleNotes || null, status: "INVITED" },
          { onSuccess: onClose },
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Add a GC</DialogTitle>
        <DialogDescription>A general contractor bidding {project.name}. Its price, contacts, deadline and follow-ups stay separate from every other GC on the project.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="General contractor" className="sm:col-span-2">
          <Select items={accountItems} value={f.organizationId || null} onValueChange={(v: string | null) => setF((x) => ({ ...x, organizationId: v ?? "", contactId: NONE }))}>
            <SelectTrigger className="w-full" aria-label="General contractor"><SelectValue placeholder={accounts.isLoading ? "Loading…" : "Pick the GC (add new GCs under Business Development)"} /></SelectTrigger>
            <SelectContent>{accountItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="GC estimator (sends to)">
          <Select items={contactItems} value={f.contactId} onValueChange={(v: string | null) => set("contactId", v ?? NONE)} disabled={!f.organizationId}>
            <SelectTrigger className="w-full" aria-label="GC estimator"><SelectValue /></SelectTrigger>
            <SelectContent>{contactItems.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Sub proposals due to this GC" id="g-due"><Input id="g-due" type="datetime-local" value={f.bidDueAt} onChange={(e) => set("bidDueAt", e.target.value)} /></Field>
        <Field label="KNU owner / estimator">
          <Select items={people} value={f.estimatorUserId} onValueChange={(v: string | null) => set("estimatorUserId", v ?? NONE)}>
            <SelectTrigger className="w-full" aria-label="KNU owner"><SelectValue /></SelectTrigger>
            <SelectContent>{people.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="KNU project manager (optional)">
          <Select items={people} value={f.pmUserId} onValueChange={(v: string | null) => set("pmUserId", v ?? NONE)}>
            <SelectTrigger className="w-full" aria-label="KNU project manager"><SelectValue /></SelectTrigger>
            <SelectContent>{people.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Expected decision" id="g-award"><Input id="g-award" type="date" value={f.expectedAwardAt} onChange={(e) => set("expectedAwardAt", e.target.value)} /></Field>
        <Field label="This GC's PlanHub link" id="g-url"><Input id="g-url" value={f.platformUrl} onChange={(e) => set("platformUrl", e.target.value)} /></Field>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Scopes bid to this GC</Label>
          <TradeChips trades={project.scopes.map((s) => ({ value: s.id, label: s.label }))} value={f.scopeIds} onChange={(v) => set("scopeIds", v)} />
        </div>
        <Field label="GC-specific instructions" id="g-notes" className="sm:col-span-2"><Textarea id="g-notes" value={f.scheduleNotes} onChange={(e) => set("scheduleNotes", e.target.value)} rows={2} placeholder="Their form, their deadline rules, who to copy…" /></Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="brand" disabled={!f.organizationId || f.scopeIds.length === 0 || add.isPending}>Add GC</Button>
      </DialogFooter>
    </form>
  );
}

// ── Award ────────────────────────────────────────────────────────────────

export function AwardDialog({ opp, open, onOpenChange, canConfirm }: { opp: Opportunity; open: boolean; onOpenChange: (o: boolean) => void; canConfirm: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">{open && <AwardForm opp={opp} canConfirm={canConfirm} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function AwardForm({ opp, canConfirm, onClose }: { opp: Opportunity; canConfirm: boolean; onClose: () => void }) {
  const pending = opp.scopes.filter((s) => s.status === "PENDING");
  const [kind, setKind] = useState<"VERBAL" | "WRITTEN" | "EXECUTED">(canConfirm ? "WRITTEN" : "VERBAL");
  const [scopeIds, setScopeIds] = useState(pending.map((s) => s.scope.id));
  const [amount, setAmount] = useState(opp.latestAmount ? String(opp.latestAmount) : "");
  const [awardedAt, setAwardedAt] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const award = useBidProjectAction<Record<string, unknown>, { job: { jobNumber: string } | null }>(`/api/bids/${opp.id}/awards`, "POST", (o) => (o.job ? `Award recorded — ${o.job.jobNumber} created` : "Verbal selection recorded"));
  const confirmed = kind !== "VERBAL";
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const evidenceFileId = file ? await uploadToLead(opp.leadId, file) : null;
          award.mutate({ kind, scopeIds, amount: Number(amount), awardedAt, evidenceFileId, notes: notes || null }, { onSuccess: onClose });
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Record an award — {opp.organization.name}</DialogTitle>
        <DialogDescription>A verbal selection creates no job. A written award or a signed subcontract (with the document attached) creates the job for the scopes awarded.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <Field label="What was received">
          <Select items={[{ value: "VERBAL", label: "Verbal selection (no paperwork yet)" }, ...(canConfirm ? [{ value: "WRITTEN", label: "Written award / LOI" }, { value: "EXECUTED", label: "Signed subcontract" }] : [])]} value={kind} onValueChange={(v: string | null) => setKind((v as typeof kind) ?? "VERBAL")}>
            <SelectTrigger className="w-full" aria-label="What was received"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="VERBAL">Verbal selection (no paperwork yet)</SelectItem>
              {canConfirm && <SelectItem value="WRITTEN">Written award / LOI</SelectItem>}
              {canConfirm && <SelectItem value="EXECUTED">Signed subcontract</SelectItem>}
            </SelectContent>
          </Select>
        </Field>
        <div className="space-y-1.5">
          <Label>Scopes awarded</Label>
          <TradeChips trades={pending.map((s) => ({ value: s.scope.id, label: s.scope.label }))} value={scopeIds} onChange={setScopeIds} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Awarded amount" id="a-amt"><Input id="a-amt" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
          <Field label="Date" id="a-date"><Input id="a-date" type="date" value={awardedAt} onChange={(e) => setAwardedAt(e.target.value)} /></Field>
        </div>
        <Field label={confirmed ? "Award letter, LOI or subcontract (required)" : "Document (optional)"} id="a-file"><Input id="a-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} accept=".pdf,image/*,.doc,.docx" /></Field>
        <Field label="Notes" id="a-notes"><Textarea id="a-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="brand" disabled={busy || award.isPending || scopeIds.length === 0 || !(Number(amount) > 0) || (confirmed && !file)}>{confirmed ? "Record award and create the job" : "Record verbal selection"}</Button>
      </DialogFooter>
    </form>
  );
}

/** Confirm a verbal selection with its document → the job. */
export function ConfirmAwardDialog({ opp, awardId, amount, open, onOpenChange }: { opp: Opportunity; awardId: string; amount: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [kind, setKind] = useState<"WRITTEN" | "EXECUTED">("WRITTEN");
  const [value, setValue] = useState(String(amount));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useBidProjectAction<Record<string, unknown>, { job: { jobNumber: string } | null }>(`/api/bid-awards/${awardId}/confirm`, "POST", (o) => (o.job ? `${o.job.jobNumber} created` : "Award confirmed"));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file) return;
            setBusy(true);
            try {
              const evidenceFileId = await uploadToLead(opp.leadId, file);
              confirm.mutate({ kind, amount: Number(value), evidenceFileId }, { onSuccess: () => onOpenChange(false) });
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Confirm the award in writing</DialogTitle>
            <DialogDescription>Attach what {opp.organization.name} sent. Confirming creates the job.</DialogDescription>
          </DialogHeader>
          <Field label="Received">
            <Select items={[{ value: "WRITTEN", label: "Written award / LOI" }, { value: "EXECUTED", label: "Signed subcontract" }]} value={kind} onValueChange={(v: string | null) => setKind((v as typeof kind) ?? "WRITTEN")}>
              <SelectTrigger className="w-full" aria-label="Received"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="WRITTEN">Written award / LOI</SelectItem><SelectItem value="EXECUTED">Signed subcontract</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Amount" id="c-amt"><Input id="c-amt" type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          <Field label="Document" id="c-file"><Input id="c-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} accept=".pdf,image/*,.doc,.docx" required /></Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="brand" disabled={!file || busy || confirm.isPending}>Confirm and create the job</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── A scope's decision (lost, withdrawn…) ───────────────────────────────

export function ScopeDecisionDialog({ oppScopeId, label, open, onOpenChange, current }: { oppScopeId: string; label: string; current: ScopeStatus; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: options } = useBidOptions();
  const [status, setStatus] = useState<"PENDING" | "LOST" | "WITHDRAWN" | "NO_BID" | "CANCELLED">(current === "PENDING" || current === "VERBAL" ? "LOST" : "PENDING");
  const [lossReason, setLossReason] = useState<string>("PRICE");
  const [note, setNote] = useState("");
  const save = useBidProjectAction<Record<string, unknown>>(`/api/bid-scopes/${oppScopeId}/status`, "POST", "Scope updated");
  const items = current === "PENDING" || current === "VERBAL" ? [{ value: "LOST", label: "Lost" }, { value: "WITHDRAWN", label: "We withdrew" }, { value: "NO_BID", label: "Not bid after all" }, { value: "CANCELLED", label: "Cancelled by the GC" }] : [{ value: "PENDING", label: "Back to pending (reopen)" }];
  const reasons = (options?.lossReasons ?? []).filter((r) => r.value !== "WITHDRAWN");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate({ status, lossReason: status === "LOST" ? lossReason : null, note: note || null }, { onSuccess: () => onOpenChange(false) }); }}>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>Silence is never a loss: record one only when the GC says so.</DialogDescription>
          </DialogHeader>
          <Field label="Decision">
            <Select items={items} value={status} onValueChange={(v: string | null) => setStatus((v as typeof status) ?? status)}>
              <SelectTrigger className="w-full" aria-label="Decision"><SelectValue /></SelectTrigger>
              <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {status === "LOST" && (
            <Field label="Why">
              <Select items={reasons} value={lossReason} onValueChange={(v: string | null) => setLossReason(v ?? "PRICE")}>
                <SelectTrigger className="w-full" aria-label="Why"><SelectValue /></SelectTrigger>
                <SelectContent>{reasons.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Note" id="s-note"><Textarea id="s-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Who told you, the winning number if known…" /></Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="brand" disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Project stage ────────────────────────────────────────────────────────

export function ProjectStageDialog({ project, open, onOpenChange }: { project: ProjectDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [stage, setStage] = useState<"OPEN" | "POSTPONED" | "REBIDDING" | "CANCELLED">(project.stage === "POSTPONED" || project.stage === "REBIDDING" || project.stage === "CANCELLED" || project.stage === "CLOSED" ? "OPEN" : "POSTPONED");
  const [reason, setReason] = useState("");
  const [reviewAt, setReviewAt] = useState("");
  const save = useBidProjectAction<Record<string, unknown>>(`/api/bid-projects/${project.id}/stage`, "POST", "Project updated");
  const items = [{ value: "POSTPONED", label: "Postponed" }, { value: "REBIDDING", label: "Rebidding" }, { value: "CANCELLED", label: "Cancelled (closes every GC)" }, { value: "OPEN", label: "Open again" }];
  const waits = stage === "POSTPONED" || stage === "REBIDDING";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate({ stage, reason: reason || null, reviewAt: reviewAt || null }, { onSuccess: () => onOpenChange(false) }); }}>
          <DialogHeader>
            <DialogTitle>Project status</DialogTitle>
            <DialogDescription>For the project as a whole. One GC losing the job is recorded on that GC, not here.</DialogDescription>
          </DialogHeader>
          <Field label="Status">
            <Select items={items} value={stage} onValueChange={(v: string | null) => setStage((v as typeof stage) ?? stage)}>
              <SelectTrigger className="w-full" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {stage !== "OPEN" && <Field label="Why" id="st-why"><Textarea id="st-why" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required /></Field>}
          {waits && <Field label="Look at it again on" id="st-rev"><Input id="st-rev" type="date" value={reviewAt} onChange={(e) => setReviewAt(e.target.value)} required /></Field>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant={stage === "CANCELLED" ? "destructive" : "brand"} disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
