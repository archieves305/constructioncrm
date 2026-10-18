"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PARTY_ROLE_LABEL, type PermitDetail, type PermitParty } from "./types";
import { usePermitWrite } from "./use-permit-intel";

const ROLE_ITEMS = Object.entries(PARTY_ROLE_LABEL).map(([value, label]) => ({ value, label }));
type Form = { role: string; name: string; email: string; phone: string; licenseNumber: string };
const EMPTY: Form = { role: "OWNER", name: "", email: "", phone: "", licenseNumber: "" };

/**
 * Who is on the application. A licence number here is the one a person
 * typed from the licence itself — the AI stages never write one.
 */
export function PermitParties({ detail }: { detail: PermitDetail }) {
  const { permit, permissions } = detail;
  const write = usePermitWrite(permit.id, permit.jobId);
  const [editing, setEditing] = useState<{ party: PermitParty | null } | null>(null);
  const [removing, setRemoving] = useState<PermitParty | null>(null);

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm">Parties on the application</CardTitle>
        {permissions.canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEditing({ party: null })}>
            <Plus className="size-3.5" /> Add a party
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {permit.parties.length === 0 ? (
          <EmptyState icon={Users} title="Nobody recorded yet" description="Add the owner, the qualifier, and the architect or engineer whose seal is on the plans." />
        ) : (
          <ul className="divide-y">
            {permit.parties.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {p.name} <span className="text-xs font-normal text-muted-foreground">· {PARTY_ROLE_LABEL[p.role] ?? p.role}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{[p.licenseNumber ? `Licence ${p.licenseNumber}` : null, p.email, p.phone, p.organization?.name].filter(Boolean).join(" · ") || "No details yet"}</p>
                </div>
                {permissions.canEdit && (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${p.name}`} onClick={() => setEditing({ party: p })}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" aria-label={`Remove ${p.name}`} onClick={() => setRemoving(p)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          {editing && (
            <PartyForm
              party={editing.party}
              pending={write.isPending}
              onSave={(form) =>
                write.mutate(
                  { url: editing.party ? `/api/permit-parties/${editing.party.id}` : `/api/permits/${permit.id}/parties`, method: editing.party ? "PATCH" : "POST", body: form },
                  {
                    onSuccess: () => {
                      toast.success(editing.party ? "Party saved" : `${form.name} added`);
                      setEditing(null);
                    },
                  },
                )
              }
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? "this party"}?`}
        description="They come off this permit's record. The change is kept in the permit's history."
        tone="danger"
        confirmLabel="Remove"
        pending={write.isPending}
        onConfirm={() => {
          if (removing) write.mutate({ url: `/api/permit-parties/${removing.id}`, method: "DELETE" }, { onSuccess: () => setRemoving(null) });
        }}
      />
    </Card>
  );
}

function PartyForm({ party, pending, onSave, onCancel }: { party: PermitParty | null; pending: boolean; onSave: (f: Form) => void; onCancel: () => void }) {
  const [form, setForm] = useState<Form>(party ? { role: party.role, name: party.name, email: party.email ?? "", phone: party.phone ?? "", licenseNumber: party.licenseNumber ?? "" } : EMPTY);
  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <>
      <DialogHeader>
        <DialogTitle>{party ? "Edit party" : "Add a party"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select items={ROLE_ITEMS} value={form.role} onValueChange={(v: string | null) => v && set("role", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_ITEMS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="party-name">Name</Label>
          <Input id="party-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="party-email">Email</Label>
            <Input id="party-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="party-phone">Phone</Label>
            <Input id="party-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="party-licence">Licence number</Label>
          <Input id="party-licence" value={form.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} placeholder="As printed on the licence" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!form.name.trim() || pending} onClick={() => onSave(form)}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}
