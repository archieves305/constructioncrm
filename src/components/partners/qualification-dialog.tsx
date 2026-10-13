"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/fetch-json";
import { useInvalidatePartners, usePartnerOptions, type Qualification, type QualificationStatus } from "./use-partners";

const NONE = "__none";
const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

/** Start a qualification with an account, or edit its facts and status. The checklist starts from the settings' default set. */
export function QualificationDialog({ open, onOpenChange, organizationId, editing, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; organizationId: string; editing?: Qualification | null; onSaved?: (q: Qualification) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {open && <QualificationForm organizationId={organizationId} editing={editing ?? null} onSaved={onSaved} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function QualificationForm({ organizationId, editing, onSaved, onClose }: { organizationId: string; editing: Qualification | null; onSaved?: (q: Qualification) => void; onClose: () => void }) {
  const invalidate = useInvalidatePartners();
  const { data: options } = usePartnerOptions();
  const [form, setForm] = useState({
    platform: editing?.platform ?? "",
    portalUrl: editing?.portalUrl ?? "",
    portalUsernameHint: editing?.portalUsernameHint ?? "",
    ownerUserId: editing?.ownerUserId ?? null,
    status: (editing?.status ?? "NOT_STARTED") as QualificationStatus,
    submittedAt: dayOf(editing?.submittedAt),
    approvedAt: dayOf(editing?.approvedAt),
    expiresAt: dayOf(editing?.expiresAt),
    renewalDueAt: dayOf(editing?.renewalDueAt),
    notes: editing?.notes ?? "",
  });
  // The checklist follows the settings' default until the person touches it —
  // the options load after the dialog mounts, so it cannot be seeded in state.
  const [pickedKeys, setPickedKeys] = useState<string[] | null>(null);
  const requirementTypeKeys = pickedKeys ?? options?.defaultRequirementTypeKeys ?? [];
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleKey = (k: string) => setPickedKeys(requirementTypeKeys.includes(k) ? requirementTypeKeys.filter((x) => x !== k) : [...requirementTypeKeys, k]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { platform: form.platform, portalUrl: form.portalUrl, portalUsernameHint: form.portalUsernameHint, ownerUserId: form.ownerUserId, status: form.status, submittedAt: form.submittedAt, approvedAt: form.approvedAt, expiresAt: form.expiresAt, renewalDueAt: form.renewalDueAt, notes: form.notes };
      if (!editing) body.requirementTypeKeys = requirementTypeKeys;
      return fetchJson<Qualification>(editing ? `/api/qualifications/${editing.id}` : `/api/partners/${organizationId}/qualifications`, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    },
    onSuccess: (q) => {
      invalidate();
      toast.success(editing ? "Qualification saved" : "Qualification started");
      onSaved?.(q);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusItems = options?.qualificationStatuses ?? [];
  const owners = [{ value: NONE, label: "The account owner" }, ...(options?.owners ?? [])];
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? "Edit qualification" : "Start a qualification"}</DialogTitle>
        <DialogDescription>{editing ? "Where the application stands and its dates." : "The GC prequalification: which platform, who runs it on our side, and what they ask for."}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="q-platform">Platform</Label>
          <Input id="q-platform" value={form.platform} onChange={(e) => set("platform", e.target.value)} placeholder="TradeTapp, their own form…" maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select items={statusItems} value={form.status} onValueChange={(v: QualificationStatus | null) => v && set("status", v)}>
            <SelectTrigger className="w-full" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>{statusItems.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="q-portal">Portal URL</Label>
          <Input id="q-portal" value={form.portalUrl} onChange={(e) => set("portalUrl", e.target.value)} placeholder="https://…" type="url" maxLength={300} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-hint">Portal login hint</Label>
          <Input id="q-hint" value={form.portalUsernameHint} onChange={(e) => set("portalUsernameHint", e.target.value)} placeholder="richard@… (never the password)" maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label>Runs it on our side</Label>
          <Select items={owners} value={form.ownerUserId ?? NONE} onValueChange={(v: string | null) => set("ownerUserId", !v || v === NONE ? null : v)}>
            <SelectTrigger className="w-full" aria-label="Owner"><SelectValue /></SelectTrigger>
            <SelectContent>{owners.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-submitted">Submitted</Label>
          <Input id="q-submitted" type="date" value={form.submittedAt} onChange={(e) => set("submittedAt", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-approved">Approved</Label>
          <Input id="q-approved" type="date" value={form.approvedAt} onChange={(e) => set("approvedAt", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-expires">Expires</Label>
          <Input id="q-expires" type="date" value={form.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} />
          <p className="text-xs text-muted-foreground">Left empty on approval, it is set from the longest validity on the checklist.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-renewal">Renewal due</Label>
          <Input id="q-renewal" type="date" value={form.renewalDueAt} onChange={(e) => set("renewalDueAt", e.target.value)} />
        </div>
      </div>
      {!editing && (
        <div className="space-y-1.5">
          <Label>They ask for</Label>
          <div className="flex flex-wrap gap-1.5">
            {(options?.documentTypes ?? []).map((t) => (
              <Button key={t.value} type="button" size="sm" variant={requirementTypeKeys.includes(t.value) ? "default" : "outline"} className="h-7 rounded-full text-xs" aria-pressed={requirementTypeKeys.includes(t.value)} onClick={() => toggleKey(t.value)}>
                {t.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Starts from the default set under Admin → Business Development; adjust per GC.</p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="q-notes">Notes</Label>
        <Textarea id="q-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={5000} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : editing ? "Save" : "Start"}</Button>
      </DialogFooter>
    </form>
  );
}
