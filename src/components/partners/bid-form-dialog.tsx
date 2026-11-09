"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { useBidOptions, useInvalidateBids, useOrganizations, type Bid, type BidPlatform, type OrgDetail } from "./use-partners";
import { Field } from "@/components/ui/field";

const NONE = "__none";
const local = (iso: string | null | undefined) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : "");
const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
/** datetime-local → an instant; empty → clear. */
const instant = (v: string) => (v ? new Date(v).toISOString() : "");

export type BidFormPrefill = Partial<Form>;

type Form = {
  organizationId: string;
  contactId: string | null;
  projectName: string;
  projectType: string;
  scopeSummary: string;
  tradeIds: string[];
  address1: string;
  city: string;
  state: string;
  zipCode: string;
  county: string;
  estimatedContractValue: string;
  invitedAt: string;
  bidDueAt: string;
  siteWalkAt: string;
  preBidMeetingAt: string;
  rfiDueAt: string;
  addendaDeadlineAt: string;
  interviewAt: string;
  expectedAwardAt: string;
  addendaCount: string;
  platform: BidPlatform;
  platformUrl: string;
  platformRef: string;
  estimatorUserId: string | null;
  specsReceived: boolean;
  siteVisitRequired: boolean;
  bondRequired: boolean;
  prevailingWage: boolean;
  unionRequired: boolean;
  insuranceNotes: string;
  scheduleNotes: string;
  tracking: boolean;
};

function initialForm(bid: Bid | null, organizationId: string | null): Form {
  return {
    organizationId: bid?.organizationId ?? organizationId ?? "",
    contactId: bid?.contactId ?? null,
    projectName: bid?.projectName ?? "",
    projectType: bid?.projectType ?? "",
    scopeSummary: bid?.scopeSummary ?? "",
    tradeIds: bid?.lead.trades.map((t) => t.id) ?? [],
    address1: bid?.lead.propertyAddress1 ?? "",
    city: bid?.lead.city ?? "",
    state: bid?.lead.state ?? "FL",
    zipCode: bid?.lead.zipCode ?? "",
    county: bid?.lead.county ?? "",
    estimatedContractValue: bid?.lead.estimatedJobValue != null ? String(bid.lead.estimatedJobValue) : "",
    invitedAt: dayOf(bid?.invitedAt) || (bid ? "" : format(new Date(), "yyyy-MM-dd")),
    bidDueAt: local(bid?.bidDueAt),
    siteWalkAt: local(bid?.siteWalkAt),
    preBidMeetingAt: local(bid?.preBidMeetingAt),
    rfiDueAt: dayOf(bid?.rfiDueAt),
    addendaDeadlineAt: dayOf(bid?.addendaDeadlineAt),
    interviewAt: local(bid?.interviewAt),
    expectedAwardAt: dayOf(bid?.expectedAwardAt),
    addendaCount: String(bid?.addendaCount ?? 0),
    platform: bid?.platform ?? "BUILDINGCONNECTED",
    platformUrl: bid?.platformUrl ?? "",
    platformRef: bid?.platformRef ?? "",
    estimatorUserId: bid?.estimatorUserId ?? null,
    specsReceived: bid?.specsReceived ?? false,
    siteVisitRequired: bid?.siteVisitRequired ?? false,
    bondRequired: bid?.bondRequired ?? false,
    prevailingWage: bid?.prevailingWage ?? false,
    unionRequired: bid?.unionRequired ?? false,
    insuranceNotes: bid?.insuranceNotes ?? "",
    scheduleNotes: bid?.scheduleNotes ?? "",
    tracking: bid ? bid.status === "TRACKING" : false,
  };
}

/** Log a bid invitation from a GC (creates the bid package) or edit one. */
export function BidFormDialog({ open, onOpenChange, organizationId, editing, onSaved, prefill, intakeId }: { open: boolean; onOpenChange: (o: boolean) => void; organizationId?: string | null; editing?: Bid | null; onSaved?: (b: Bid) => void; prefill?: BidFormPrefill; intakeId?: string | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {open && <BidForm organizationId={organizationId ?? null} editing={editing ?? null} onSaved={onSaved} prefill={prefill} intakeId={intakeId ?? null} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function BidForm({ organizationId, editing, onSaved, onClose, prefill, intakeId }: { organizationId: string | null; editing: Bid | null; onSaved?: (b: Bid) => void; onClose: () => void; prefill?: BidFormPrefill; intakeId: string | null }) {
  const router = useRouter();
  const invalidate = useInvalidateBids();
  const { data: options } = useBidOptions();
  const [form, setForm] = useState<Form>(() => ({ ...initialForm(editing, organizationId), ...(editing ? {} : prefill) }));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const accountFixed = Boolean(editing || organizationId);
  const accounts = useOrganizations(new URLSearchParams({ pageSize: "500" }), !accountFixed);
  const org = useQuery<OrgDetail>({ queryKey: ["partners", "detail", form.organizationId], queryFn: () => fetchJson(`/api/partners/${form.organizationId}`), retry: retryServerErrors, enabled: Boolean(form.organizationId) });
  const contacts = useMemo(() => (org.data?.organization.contacts ?? []).filter((c) => c.isActive), [org.data]);
  const toggleTrade = (id: string) => set("tradeIds", form.tradeIds.includes(id) ? form.tradeIds.filter((t) => t !== id) : [...form.tradeIds, id]);

  const save = useMutation({
    mutationFn: () => {
      const common = {
        contactId: form.contactId,
        projectName: form.projectName,
        projectType: form.projectType,
        scopeSummary: form.scopeSummary,
        invitedAt: form.invitedAt,
        bidDueAt: instant(form.bidDueAt),
        siteWalkAt: instant(form.siteWalkAt),
        preBidMeetingAt: instant(form.preBidMeetingAt),
        rfiDueAt: form.rfiDueAt,
        addendaDeadlineAt: form.addendaDeadlineAt,
        interviewAt: instant(form.interviewAt),
        expectedAwardAt: form.expectedAwardAt,
        addendaCount: Number(form.addendaCount) || 0,
        platform: form.platform,
        platformUrl: form.platformUrl,
        platformRef: form.platformRef,
        estimatorUserId: form.estimatorUserId,
        specsReceived: form.specsReceived,
        siteVisitRequired: form.siteVisitRequired,
        bondRequired: form.bondRequired,
        prevailingWage: form.prevailingWage,
        unionRequired: form.unionRequired,
        insuranceNotes: form.insuranceNotes,
        scheduleNotes: form.scheduleNotes,
        estimatedContractValue: form.estimatedContractValue ? Number(form.estimatedContractValue) : null,
        tradeIds: form.tradeIds,
      };
      if (editing) return fetchJson<Bid>(`/api/bids/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(common) });
      // From an emailed invitation: the same body, through the intake so the email is filed with the bid.
      return fetchJson<Bid>(intakeId ? `/api/partners/intake/${intakeId}/create` : "/api/bids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...common, organizationId: form.organizationId, status: form.tracking ? "TRACKING" : "INVITED", site: { address1: form.address1, city: form.city, state: form.state, zipCode: form.zipCode, county: form.county } }),
      });
    },
    onSuccess: (b) => {
      invalidate();
      toast.success(editing ? "Bid saved" : `${b.number} created`);
      onSaved?.(b);
      onClose();
      if (!editing && !onSaved) router.push(`/leads/${b.leadId}?tab=bid`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const accountItems = (accounts.data?.rows ?? []).map((o) => ({ value: o.id, label: o.name }));
  const contactItems = [{ value: NONE, label: "No one in particular" }, ...contacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}${c.title ? ` · ${c.title}` : ""}` }))];
  const platformItems = options?.bidPlatforms ?? [];
  const estimatorItems = [{ value: NONE, label: "Not assigned yet" }, ...(options?.owners ?? [])];
  const flags: [keyof Form, string][] = [
    ["specsReceived", "Specs received"],
    ["siteVisitRequired", "Site visit required"],
    ["bondRequired", "Bond required"],
    ["prevailingWage", "Prevailing wage"],
    ["unionRequired", "Union labor"],
  ];
  const canSave = form.projectName.trim().length >= 2 && form.tradeIds.length > 0 && (editing || (form.organizationId && form.address1.trim() && form.city.trim() && form.zipCode.trim().length >= 5));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${editing.number}` : intakeId ? "Create the bid from the email" : "Log a bid invitation"}</DialogTitle>
        <DialogDescription>{editing ? "The package's facts and dates." : intakeId ? "Filled in from the email. Check every field against the invitation: nothing is saved until you press Create bid." : "A GC asked KNU to price a package. This creates the bid and its lead, so the estimators, plan takeoff and files work on it as on any lead."}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        {!accountFixed && (
          <Field label="Account" className="sm:col-span-2">
            <Select items={accountItems} value={form.organizationId || null} onValueChange={(v: string | null) => setForm((f) => ({ ...f, organizationId: v ?? "", contactId: null }))}>
              <SelectTrigger className="w-full" aria-label="Account"><SelectValue placeholder={accounts.isLoading ? "Loading…" : "Pick the GC"} /></SelectTrigger>
              <SelectContent>{accountItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        )}
        <Field label="Project" id="b-project" className="sm:col-span-2">
          <Input id="b-project" value={form.projectName} onChange={(e) => set("projectName", e.target.value)} placeholder="Towne Place Suites Clewiston — drywall" maxLength={200} required />
        </Field>
        <Field label="Invited by">
          <Select items={contactItems} value={form.contactId ?? NONE} onValueChange={(v: string | null) => set("contactId", !v || v === NONE ? null : v)} disabled={!form.organizationId}>
            <SelectTrigger className="w-full" aria-label="Invited by"><SelectValue /></SelectTrigger>
            <SelectContent>{contactItems.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Estimator">
          <Select items={estimatorItems} value={form.estimatorUserId ?? NONE} onValueChange={(v: string | null) => set("estimatorUserId", !v || v === NONE ? null : v)}>
            <SelectTrigger className="w-full" aria-label="Estimator"><SelectValue /></SelectTrigger>
            <SelectContent>{estimatorItems.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Trades in the package</Label>
          <div className="flex flex-wrap gap-1.5">
            {(options?.trades ?? []).map((t) => (
              <Button key={t.value} type="button" size="sm" variant={form.tradeIds.includes(t.value) ? "default" : "outline"} className="h-7 rounded-full text-xs" aria-pressed={form.tradeIds.includes(t.value)} onClick={() => toggleTrade(t.value)}>
                {t.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {!editing && (
        <fieldset className="grid gap-3 sm:grid-cols-6">
          <legend className="mb-1.5 text-sm font-medium">Project site</legend>
          <Field label="Street" id="b-addr" className="sm:col-span-6">
            <Input id="b-addr" value={form.address1} onChange={(e) => set("address1", e.target.value)} maxLength={200} required />
          </Field>
          <Field label="City" id="b-city" className="sm:col-span-2">
            <Input id="b-city" value={form.city} onChange={(e) => set("city", e.target.value)} maxLength={120} required />
          </Field>
          <Field label="State" id="b-state" className="sm:col-span-1">
            <Input id="b-state" value={form.state} onChange={(e) => set("state", e.target.value.toUpperCase())} maxLength={2} />
          </Field>
          <Field label="ZIP" id="b-zip" className="sm:col-span-1">
            <Input id="b-zip" value={form.zipCode} onChange={(e) => set("zipCode", e.target.value)} maxLength={12} required />
          </Field>
          <Field label="County" id="b-county" className="sm:col-span-2">
            <Input id="b-county" value={form.county} onChange={(e) => set("county", e.target.value)} maxLength={80} placeholder="Read by the bid score" />
          </Field>
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Bid due" id="b-due">
          <Input id="b-due" type="datetime-local" value={form.bidDueAt} onChange={(e) => set("bidDueAt", e.target.value)} />
        </Field>
        <Field label="Invited" id="b-invited">
          <Input id="b-invited" type="date" value={form.invitedAt} onChange={(e) => set("invitedAt", e.target.value)} />
        </Field>
        <Field label="Estimated contract value" id="b-value">
          <Input id="b-value" type="number" min={0} step="1000" inputMode="decimal" value={form.estimatedContractValue} onChange={(e) => set("estimatedContractValue", e.target.value)} placeholder="$" />
        </Field>
        <Field label="Site walk" id="b-walk">
          <Input id="b-walk" type="datetime-local" value={form.siteWalkAt} onChange={(e) => set("siteWalkAt", e.target.value)} />
        </Field>
        <Field label="Pre-bid meeting" id="b-prebid">
          <Input id="b-prebid" type="datetime-local" value={form.preBidMeetingAt} onChange={(e) => set("preBidMeetingAt", e.target.value)} />
        </Field>
        <Field label="RFI deadline" id="b-rfi">
          <Input id="b-rfi" type="date" value={form.rfiDueAt} onChange={(e) => set("rfiDueAt", e.target.value)} />
        </Field>
        <Field label="Addenda deadline" id="b-addenda">
          <Input id="b-addenda" type="date" value={form.addendaDeadlineAt} onChange={(e) => set("addendaDeadlineAt", e.target.value)} />
        </Field>
        <Field label="Interview" id="b-interview">
          <Input id="b-interview" type="datetime-local" value={form.interviewAt} onChange={(e) => set("interviewAt", e.target.value)} />
        </Field>
        <Field label="Award expected" id="b-award">
          <Input id="b-award" type="date" value={form.expectedAwardAt} onChange={(e) => set("expectedAwardAt", e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Where it came from">
          <Select items={platformItems} value={form.platform} onValueChange={(v: BidPlatform | null) => v && set("platform", v)}>
            <SelectTrigger className="w-full" aria-label="Platform"><SelectValue /></SelectTrigger>
            <SelectContent>{platformItems.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Link to the invitation" id="b-url" className="sm:col-span-2">
          <Input id="b-url" type="url" value={form.platformUrl} onChange={(e) => set("platformUrl", e.target.value)} placeholder="https://app.buildingconnected.com/…" maxLength={500} />
        </Field>
        <Field label="Their reference" id="b-ref">
          <Input id="b-ref" value={form.platformRef} onChange={(e) => set("platformRef", e.target.value)} maxLength={120} />
        </Field>
        <Field label="Project type" id="b-type">
          <Input id="b-type" value={form.projectType} onChange={(e) => set("projectType", e.target.value)} placeholder="Hotel, multifamily…" maxLength={120} />
        </Field>
        <Field label="Addenda issued" id="b-addcount">
          <Input id="b-addcount" type="number" min={0} max={99} value={form.addendaCount} onChange={(e) => set("addendaCount", e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {flags.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <Checkbox checked={form[k] as boolean} onCheckedChange={(c) => set(k, Boolean(c) as never)} />
            {label}
          </label>
        ))}
        {!editing && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={form.tracking} onCheckedChange={(c) => set("tracking", Boolean(c))} />
            Only tracking (no invitation yet)
          </label>
        )}
      </div>

      <Field label="Scope" id="b-scope">
        <Textarea id="b-scope" value={form.scopeSummary} onChange={(e) => set("scopeSummary", e.target.value)} rows={3} maxLength={5000} placeholder="What the package covers, as the GC describes it" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Insurance requirements" id="b-ins">
          <Textarea id="b-ins" value={form.insuranceNotes} onChange={(e) => set("insuranceNotes", e.target.value)} rows={2} maxLength={2000} />
        </Field>
        <Field label="Schedule" id="b-sched">
          <Textarea id="b-sched" value={form.scheduleNotes} onChange={(e) => set("scheduleNotes", e.target.value)} rows={2} maxLength={2000} />
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!canSave || save.isPending}>{save.isPending ? "Saving…" : editing ? "Save" : "Create bid"}</Button>
      </DialogFooter>
    </form>
  );
}
