"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fetchJson } from "@/lib/fetch-json";
import { useInvalidatePartners, usePartnerOptions, type OrgDetail, type OrganizationKind, type PartnerStage, type Priority } from "./use-partners";

export type OrgFormValues = {
  name: string;
  kind: OrganizationKind;
  website: string;
  phone: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  localOffices: string;
  markets: string[];
  tradeIds: string[];
  notes: string;
  ownerUserId: string | null;
  priority: Priority | null;
  stage: PartnerStage;
  potentialAnnualRevenue: string;
  paymentTermsDays: string;
  annualVolume: string;
  companySize: string;
  projectTypes: string;
  typicalProjectSize: string;
  biddingPlatform: string;
  prequalPlatform: string;
  vendorRegistrationUrl: string;
  requirementsNotes: string;
};

const EMPTY: OrgFormValues = {
  name: "",
  kind: "GENERAL_CONTRACTOR",
  website: "",
  phone: "",
  email: "",
  address1: "",
  address2: "",
  city: "",
  state: "FL",
  zipCode: "",
  localOffices: "",
  markets: [],
  tradeIds: [],
  notes: "",
  ownerUserId: null,
  priority: null,
  stage: "TARGET",
  potentialAnnualRevenue: "",
  paymentTermsDays: "",
  annualVolume: "",
  companySize: "",
  projectTypes: "",
  typicalProjectSize: "",
  biddingPlatform: "",
  prequalPlatform: "",
  vendorRegistrationUrl: "",
  requirementsNotes: "",
};

const NONE = "__none";

export function orgFormValues(o: OrgDetail["organization"]): OrgFormValues {
  return {
    name: o.name,
    kind: o.kind,
    website: o.website ?? "",
    phone: o.phone ?? "",
    email: o.email ?? "",
    address1: o.address1 ?? "",
    address2: o.address2 ?? "",
    city: o.city ?? "",
    state: o.state ?? "FL",
    zipCode: o.zipCode ?? "",
    localOffices: o.localOffices ?? "",
    markets: o.markets,
    tradeIds: o.trades.map((t) => t.id),
    notes: o.notes ?? "",
    ownerUserId: o.ownerUserId,
    priority: o.priority,
    stage: o.stage,
    potentialAnnualRevenue: o.potentialAnnualRevenue === null ? "" : String(o.potentialAnnualRevenue),
    paymentTermsDays: o.paymentTermsDays === null ? "" : String(o.paymentTermsDays),
    annualVolume: o.annualVolume ?? "",
    companySize: o.companySize ?? "",
    projectTypes: o.projectTypes.join(", "),
    typicalProjectSize: o.typicalProjectSize ?? "",
    biddingPlatform: o.biddingPlatform ?? "",
    prequalPlatform: o.prequalPlatform ?? "",
    vendorRegistrationUrl: o.vendorRegistrationUrl ?? "",
    requirementsNotes: o.requirementsNotes ?? "",
  };
}

/** Create or edit an account. The GC profile (what they expect of a trade partner) folds away until it is needed. */
export function OrgFormDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
  canAdmin,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId?: string;
  initial?: Partial<OrgFormValues>;
  /** Owner and priority are a manager's call on an existing account. */
  canAdmin: boolean;
  onSaved?: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open && <OrgForm organizationId={organizationId} initial={initial} canAdmin={canAdmin} onSaved={onSaved} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function OrgForm({ organizationId, initial, canAdmin, onSaved, onClose }: { organizationId?: string; initial?: Partial<OrgFormValues>; canAdmin: boolean; onSaved?: (id: string) => void; onClose: () => void }) {
  const invalidate = useInvalidatePartners();
  const { data: options } = usePartnerOptions();
  const [form, setForm] = useState<OrgFormValues>({ ...EMPTY, ...initial });
  const [profileOpen, setProfileOpen] = useState(Boolean(initial?.biddingPlatform || initial?.prequalPlatform || initial?.annualVolume || initial?.requirementsNotes));
  const set = <K extends keyof OrgFormValues>(key: K, value: OrgFormValues[K]) => setForm((f) => ({ ...f, [key]: value }));
  const editing = Boolean(organizationId);
  const ownerLocked = editing && !canAdmin;

  const save = useMutation({
    mutationFn: () => {
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      const body: Record<string, unknown> = {
        name: form.name,
        kind: form.kind,
        website: form.website,
        phone: form.phone,
        email: form.email,
        address1: form.address1,
        address2: form.address2,
        city: form.city,
        state: form.state,
        zipCode: form.zipCode,
        localOffices: form.localOffices,
        markets: form.markets,
        tradeIds: form.tradeIds,
        notes: form.notes,
        priority: form.priority,
        potentialAnnualRevenue: num(form.potentialAnnualRevenue),
        paymentTermsDays: num(form.paymentTermsDays),
        annualVolume: form.annualVolume,
        companySize: form.companySize,
        projectTypes: form.projectTypes.split(",").map((s) => s.trim()).filter(Boolean),
        typicalProjectSize: form.typicalProjectSize,
        biddingPlatform: form.biddingPlatform,
        prequalPlatform: form.prequalPlatform,
        vendorRegistrationUrl: form.vendorRegistrationUrl,
        requirementsNotes: form.requirementsNotes,
      };
      if (!ownerLocked) body.ownerUserId = form.ownerUserId;
      if (!editing) body.stage = form.stage;
      return fetchJson<OrgDetail>(organizationId ? `/api/partners/${organizationId}` : "/api/partners", { method: organizationId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    },
    onSuccess: (r) => {
      invalidate();
      toast.success(editing ? "Account saved" : `${r.organization.name} added`);
      onSaved?.(r.organization.id);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const field = (key: keyof OrgFormValues, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`org-${key}`}>{label}</Label>
      <Input id={`org-${key}`} value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value as never)} {...props} />
    </div>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (form.name.trim().length < 2) return toast.error("Give the account a name");
        save.mutate();
      }}
      className="space-y-5"
    >
      <DialogHeader>
        <DialogTitle>{editing ? "Edit account" : "New GC account"}</DialogTitle>
        <DialogDescription>{editing ? "Company details, the relationship, and what they expect of a trade partner." : "A general contractor, developer or other company KNU wants work from."}</DialogDescription>
      </DialogHeader>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="org-name">Name</Label>
            <Input id="org-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Kaufman Lynn Construction" autoFocus maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <Select items={options?.kinds ?? []} value={form.kind} onValueChange={(v: OrganizationKind | null) => v && set("kind", v)}>
              <SelectTrigger className="w-full" aria-label="Kind"><SelectValue /></SelectTrigger>
              <SelectContent>{(options?.kinds ?? []).map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {field("website", "Website", { placeholder: "https://…", type: "url" })}
          {field("phone", "Phone", { type: "tel", maxLength: 40 })}
          {field("email", "Email", { type: "email", maxLength: 200 })}
          {field("address1", "Address", { maxLength: 200 })}
          {field("address2", "Suite / floor", { maxLength: 200 })}
          {field("city", "City", { maxLength: 120 })}
          <div className="grid grid-cols-2 gap-3">
            {field("state", "State", { maxLength: 2 })}
            {field("zipCode", "ZIP", { maxLength: 12 })}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="org-localOffices">Local offices</Label>
            <Input id="org-localOffices" value={form.localOffices} onChange={(e) => set("localOffices", e.target.value)} placeholder="Boca Raton · Orlando" maxLength={1000} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relationship</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Relationship owner</Label>
            <Select items={[{ value: NONE, label: "Nobody yet" }, ...(options?.owners ?? [])]} value={form.ownerUserId ?? NONE} onValueChange={(v: string | null) => set("ownerUserId", !v || v === NONE ? null : v)} disabled={ownerLocked}>
              <SelectTrigger className="w-full" aria-label="Relationship owner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nobody yet</SelectItem>
                {(options?.owners ?? []).map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {ownerLocked && <p className="text-xs text-muted-foreground">A manager changes the owner from the account menu.</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select items={[{ value: NONE, label: "Not set" }, ...(options?.priorities ?? [])]} value={form.priority ?? NONE} onValueChange={(v: string | null) => set("priority", !v || v === NONE ? null : (v as Priority))}>
              <SelectTrigger className="w-full" aria-label="Priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {(options?.priorities ?? []).map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!editing && (
            <div className="space-y-1.5">
              <Label>Starting stage</Label>
              <Select items={options?.stages ?? []} value={form.stage} onValueChange={(v: PartnerStage | null) => v && set("stage", v)}>
                <SelectTrigger className="w-full" aria-label="Starting stage"><SelectValue /></SelectTrigger>
                <SelectContent>{(options?.stages ?? []).filter((s) => !s.isClosed).map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {field("potentialAnnualRevenue", "Potential annual revenue ($)", { type: "number", min: 0, step: 1000, inputMode: "numeric" })}
          {field("paymentTermsDays", "Payment terms (days)", { type: "number", min: 0, max: 180, inputMode: "numeric" })}
        </div>
        <div className="space-y-1.5">
          <Label>Trades they could use KNU for</Label>
          <div className="flex flex-wrap gap-1.5">
            {(options?.trades ?? []).map((t) => (
              <Button key={t.value} type="button" size="sm" variant={form.tradeIds.includes(t.value) ? "default" : "outline"} className="h-7 rounded-full text-xs" aria-pressed={form.tradeIds.includes(t.value)} onClick={() => set("tradeIds", toggle(form.tradeIds, t.value))}>
                {t.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Markets</Label>
          <div className="flex flex-wrap gap-1.5">
            {(options?.markets ?? []).map((m) => (
              <Button key={m} type="button" size="sm" variant={form.markets.includes(m) ? "default" : "outline"} className="h-7 rounded-full text-xs" aria-pressed={form.markets.includes(m)} onClick={() => set("markets", toggle(form.markets, m))}>
                {m}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-notes">Notes</Label>
          <Textarea id="org-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="How we know them, who introduced us, what they build" />
        </div>
      </section>

      <Collapsible open={profileOpen} onOpenChange={setProfileOpen}>
        <CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" className="-ml-2 gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground" />}>
          <ChevronDown className={`size-4 transition-transform ${profileOpen ? "rotate-180" : ""}`} />
          GC profile — what they expect of a trade partner
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {field("annualVolume", "Annual construction volume", { placeholder: "$500M" })}
            {field("companySize", "Company size", { placeholder: "800 employees" })}
            {field("projectTypes", "Project types", { placeholder: "Multifamily, hospitality, healthcare" })}
            {field("typicalProjectSize", "Typical project size", { placeholder: "$20–80M" })}
            {field("biddingPlatform", "Bidding platform", { placeholder: "BuildingConnected" })}
            {field("prequalPlatform", "Prequalification platform", { placeholder: "TradeTapp" })}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="org-vendorRegistrationUrl">Vendor registration URL</Label>
              <Input id="org-vendorRegistrationUrl" value={form.vendorRegistrationUrl} onChange={(e) => set("vendorRegistrationUrl", e.target.value)} placeholder="https://…" type="url" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-requirementsNotes">Insurance, bonding, safety and financial requirements</Label>
            <Textarea id="org-requirementsNotes" value={form.requirementsNotes} onChange={(e) => set("requirementsNotes", e.target.value)} rows={3} placeholder="$2M GL / $5M umbrella · EMR under 1.0 · bonding for jobs over $500k · audited financials" />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : editing ? "Save" : "Add account"}</Button>
      </DialogFooter>
    </form>
  );
}
