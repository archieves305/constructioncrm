"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";
import { useInvalidatePartners, usePartnerOptions, type Contact, type ContactRole } from "./use-partners";

export type ContactFormValues = {
  firstName: string;
  lastName: string;
  title: string;
  roleTag: ContactRole;
  email: string;
  phone: string;
  mobile: string;
  linkedinUrl: string;
  office: string;
  geography: string;
  trades: string;
  relationshipStrength: number | null;
  influence: number | null;
  isPrimary: boolean;
  notes: string;
};

const EMPTY: ContactFormValues = { firstName: "", lastName: "", title: "", roleTag: "ESTIMATOR", email: "", phone: "", mobile: "", linkedinUrl: "", office: "", geography: "", trades: "", relationshipStrength: null, influence: null, isPrimary: false, notes: "" };

export function contactFormValues(c: Contact): ContactFormValues {
  return {
    firstName: c.firstName,
    lastName: c.lastName,
    title: c.title ?? "",
    roleTag: c.roleTag,
    email: c.email ?? "",
    phone: c.phone ?? "",
    mobile: c.mobile ?? "",
    linkedinUrl: c.linkedinUrl ?? "",
    office: c.office ?? "",
    geography: c.geography ?? "",
    trades: c.trades.join(", "),
    relationshipStrength: c.relationshipStrength,
    influence: c.influence,
    isPrimary: c.isPrimary,
    notes: c.notes ?? "",
  };
}

/** A person at an account. Making them primary clears the previous primary. */
export function ContactFormDialog({
  open,
  onOpenChange,
  organizationId,
  contactId,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  contactId?: string;
  initial?: Partial<ContactFormValues>;
  onSaved?: (contact: Contact) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {open && <ContactForm organizationId={organizationId} contactId={contactId} initial={initial} onSaved={onSaved} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Rating({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Button key={n} type="button" size="sm" variant={value === n ? "default" : "outline"} className="size-8 p-0" role="radio" aria-checked={value === n} onClick={() => onChange(value === n ? null : n)}>
            {n}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ContactForm({ organizationId, contactId, initial, onSaved, onClose }: { organizationId: string; contactId?: string; initial?: Partial<ContactFormValues>; onSaved?: (c: Contact) => void; onClose: () => void }) {
  const invalidate = useInvalidatePartners();
  const { data: options } = usePartnerOptions();
  const [form, setForm] = useState<ContactFormValues>({ ...EMPTY, ...initial });
  const set = <K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () =>
      fetchJson<Contact>(contactId ? `/api/contacts/${contactId}` : `/api/partners/${organizationId}/contacts`, {
        method: contactId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, trades: form.trades.split(",").map((s) => s.trim()).filter(Boolean) }),
      }),
    onSuccess: (c) => {
      invalidate();
      toast.success(contactId ? "Contact saved" : `${c.firstName} ${c.lastName} added`);
      onSaved?.(c);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const text = (key: keyof ContactFormValues, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`contact-${key}`}>{label}</Label>
      <Input id={`contact-${key}`} value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value as never)} {...props} />
    </div>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.firstName.trim() || !form.lastName.trim()) return toast.error("First and last name");
        save.mutate();
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>{contactId ? "Edit contact" : "New contact"}</DialogTitle>
        <DialogDescription>The estimator, preconstruction manager or executive KNU deals with there.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        {text("firstName", "First name", { autoFocus: true, maxLength: 80 })}
        {text("lastName", "Last name", { maxLength: 80 })}
        {text("title", "Title", { placeholder: "Senior Estimator", maxLength: 120 })}
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select items={options?.contactRoles ?? []} value={form.roleTag} onValueChange={(v: ContactRole | null) => v && set("roleTag", v)}>
            <SelectTrigger className="w-full" aria-label="Role"><SelectValue /></SelectTrigger>
            <SelectContent>{(options?.contactRoles ?? []).map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {text("email", "Email", { type: "email", maxLength: 200 })}
        {text("phone", "Office phone", { type: "tel", maxLength: 40 })}
        {text("mobile", "Mobile", { type: "tel", maxLength: 40 })}
        {text("linkedinUrl", "LinkedIn", { placeholder: "https://linkedin.com/in/…", maxLength: 300 })}
        {text("office", "Office", { placeholder: "Boca Raton", maxLength: 120 })}
        {text("geography", "Covers", { placeholder: "South Florida", maxLength: 120 })}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="contact-trades">Trades they handle</Label>
          <Input id="contact-trades" value={form.trades} onChange={(e) => set("trades", e.target.value)} placeholder="Roofing, Plumbing" />
        </div>
        <Rating label="Relationship strength" value={form.relationshipStrength} onChange={(v) => set("relationshipStrength", v)} />
        <Rating label="Influence on awards" value={form.influence} onChange={(v) => set("influence", v)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.isPrimary} onChange={(e) => set("isPrimary", e.target.checked)} />
        Primary contact for this account
      </label>
      <div className="space-y-1.5">
        <Label htmlFor="contact-notes">Notes</Label>
        <Textarea id="contact-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : contactId ? "Save" : "Add contact"}</Button>
      </DialogFooter>
    </form>
  );
}
