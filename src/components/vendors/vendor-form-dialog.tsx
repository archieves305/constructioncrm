"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { fetchJson } from "@/lib/fetch-json";
import { KIND_LABEL, type VendorKind, type VendorLink } from "./use-vendors";

export type VendorFormValues = {
  name: string;
  kind: VendorKind;
  trade: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

const EMPTY: VendorFormValues = { name: "", kind: "SUPPLIER", trade: "", contactName: "", phone: "", email: "", address: "", notes: "" };

const KIND_OPTIONS = (Object.keys(KIND_LABEL) as VendorKind[]).map((value) => ({ value, label: KIND_LABEL[value] }));

/**
 * Create or edit a vendor. `link` connects the new vendor to whatever it was
 * created from on the Unmatched tab (a payee spelling, a crew, a typed
 * contractor name); `linkNote` says so in plain words.
 */
export function VendorFormDialog({
  open,
  onOpenChange,
  vendorId,
  initial,
  link,
  linkNote,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId?: string;
  initial?: Partial<VendorFormValues>;
  link?: VendorLink;
  linkNote?: string;
  onSaved?: (vendorId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <VendorForm vendorId={vendorId} initial={initial} link={link} linkNote={linkNote} onSaved={onSaved} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function VendorForm({
  vendorId,
  initial,
  link,
  linkNote,
  onSaved,
  onClose,
}: {
  vendorId?: string;
  initial?: Partial<VendorFormValues>;
  link?: VendorLink;
  linkNote?: string;
  onSaved?: (vendorId: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<VendorFormValues>({ ...EMPTY, ...initial });
  const set = <K extends keyof VendorFormValues>(key: K, value: VendorFormValues[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () =>
      fetchJson<{ vendor: { id: string; name: string }; expensesLinked: number; contractsLinked?: number }>(vendorId ? `/api/vendors/${vendorId}` : "/api/vendors", {
        method: vendorId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...(vendorId || !link ? {} : { link }) }),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      const linked = [
        r.expensesLinked ? `${r.expensesLinked} expense${r.expensesLinked === 1 ? "" : "s"} linked` : "",
        r.contractsLinked ? `${r.contractsLinked} labor contract${r.contractsLinked === 1 ? "" : "s"} linked` : "",
      ].filter(Boolean).join(" · ");
      toast.success(vendorId ? "Vendor saved" : `${r.vendor.name} added`, linked ? { description: linked } : undefined);
      onSaved?.(r.vendor.id);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (form.name.trim().length < 2) return toast.error("Give the vendor a name");
        save.mutate();
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>{vendorId ? "Edit vendor" : "New vendor"}</DialogTitle>
        {linkNote && <DialogDescription>{linkNote}</DialogDescription>}
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="vendor-name">Name</Label>
        <Input id="vendor-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Home Depot" autoFocus maxLength={120} />
        <p className="text-xs text-muted-foreground">Expenses whose payee contains this name attach to the vendor automatically.</p>
      </div>

      <div className="space-y-1.5">
        <Label>Kind</Label>
        <div>
          <SegmentedControl ariaLabel="Vendor kind" value={form.kind} onValueChange={(v) => set("kind", v)} options={KIND_OPTIONS} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="vendor-trade">Trade</Label>
          <Input id="vendor-trade" value={form.trade} onChange={(e) => set("trade", e.target.value)} placeholder="Electrical" maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vendor-contact">Contact</Label>
          <Input id="vendor-contact" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vendor-phone">Phone</Label>
          <Input id="vendor-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vendor-email">Email</Label>
          <Input id="vendor-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={200} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="vendor-address">Address</Label>
        <Input id="vendor-address" value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={300} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="vendor-notes">Notes</Label>
        <Textarea id="vendor-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : vendorId ? "Save" : "Add vendor"}</Button>
      </DialogFooter>
    </form>
  );
}
