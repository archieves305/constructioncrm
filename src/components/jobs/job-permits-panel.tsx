"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus, Shield } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PermitEditor, usePermitRefresh } from "@/components/permits/permit-editor";
import { PermitInspections } from "@/components/permits/permit-inspections";
import {
  expiryNotice,
  formatDay,
  formatWhen,
  jobPermitsKey,
  PERMIT_STATUS_LABEL,
  PERMIT_STATUS_OPTIONS,
  PERMIT_STATUS_TONE,
  typeLabel,
  type AssignableUser,
  type JobPermitsData,
  type PermitRecord,
} from "@/components/permits/shared";
import { fetchJson } from "@/lib/fetch-json";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";

const emptyPermitForm = {
  municipality: "",
  permitType: "",
  permitNumber: "",
  status: "APPLIED",
  submittedDate: new Date().toISOString().slice(0, 10),
  expectedApprovalDate: "",
  expirationDate: "",
  permitFee: "",
  assignedUserId: "",
  notes: "",
};

/**
 * The job's permits, edited where the job is: every field, the status (which
 * stamps its dates and settles the workflow's permit gates), and each
 * permit's inspections with their results.
 */
export function JobPermitsPanel({ jobId }: { jobId: string }) {
  const { data, isLoading, error } = useQuery<JobPermitsData>({ queryKey: jobPermitsKey(jobId), queryFn: () => fetchJson(`/api/jobs/${jobId}/permits`) });
  const { data: users = [] } = useQuery<AssignableUser[]>({ queryKey: ["assignable-users"], queryFn: () => fetchJson("/api/users/assignable") });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading) return <ListSkeleton rows={3} />;
  if (error || !data) return <Callout tone="danger" title="The permits did not load">{(error as Error | null)?.message ?? "Try again in a moment."}</Callout>;
  const { permits, steps, canEdit } = data;
  // One permit: nothing to choose, so it is open.
  const openId = open ?? (permits.length === 1 ? permits[0].id : null);

  return (
    <div className="space-y-3">
      {canEdit && (adding || permits.length === 0) ? (
        <AddPermitForm jobId={jobId} users={users} onDone={permits.length === 0 ? undefined : () => setAdding(false)} />
      ) : (
        canEdit && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add a permit
            </Button>
          </div>
        )
      )}

      {permits.map((p) => (
        <PermitCard key={p.id} permit={p} open={openId === p.id} onToggle={() => setOpen(openId === p.id ? "" : p.id)}>
          <PermitEditor permit={p} users={users} canEdit={canEdit} />
          <div className="mt-4 border-t pt-4">
            <PermitInspections jobId={jobId} permitId={p.id} inspections={p.inspections ?? []} steps={steps} canEdit={canEdit} />
          </div>
        </PermitCard>
      ))}

      {permits.length === 0 && !canEdit && <EmptyState icon={Shield} title="No permits on this job" description="The office adds a permit here once it is submitted." />}
    </div>
  );
}

function PermitCard({ permit: p, open, onToggle, children }: { permit: PermitRecord; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const notice = expiryNotice(p);
  const inspections = p.inspections ?? [];
  const next = inspections.find((i) => i.result === "SCHEDULED");
  const failed = inspections.filter((i) => i.result === "FAIL").length;
  const facts = [
    p.submittedDate ? `Submitted ${formatDay(p.submittedDate)}` : null,
    p.approvedDate ? `Issued ${formatDay(p.approvedDate)}` : p.expectedApprovalDate && p.status !== "DENIED" ? `Expected ${formatDay(p.expectedApprovalDate)}` : null,
    p.finalPassedDate ? `Final ${formatDay(p.finalPassedDate)}` : p.expirationDate ? `Expires ${formatDay(p.expirationDate)}` : null,
    p.assignedTo ? `${p.assignedTo.firstName} ${p.assignedTo.lastName}` : null,
  ].filter(Boolean);
  return (
    <Card>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <Shield className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{p.permitType || "Permit"}</span>
            <span className="text-xs text-muted-foreground">{p.municipality}</span>
            {p.permitNumber && <span className="font-mono text-xs">#{p.permitNumber}</span>}
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses(PERMIT_STATUS_TONE[p.status] ?? "neutral").pill)}>{PERMIT_STATUS_LABEL[p.status] ?? p.status}</span>
            {notice && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses(notice.tone).pill)}>{notice.text}</span>}
            {failed > 0 && p.status !== "FINAL" && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses("danger").pill)}>{failed} failed inspection{failed === 1 ? "" : "s"}</span>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {facts.join(" · ")}
            {next ? `${facts.length ? " · " : ""}Next: ${typeLabel(next.type)} inspection, ${formatWhen(next.scheduledFor).toLowerCase() === "no date yet" ? "no date yet" : formatWhen(next.scheduledFor)}` : ""}
          </p>
        </div>
        <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <CardContent className="border-t pt-4">{children}</CardContent>}
    </Card>
  );
}

function AddPermitForm({ jobId, users, onDone }: { jobId: string; users: AssignableUser[]; onDone?: () => void }) {
  const refresh = usePermitRefresh(jobId);
  const [form, setForm] = useState(emptyPermitForm);
  const set = (k: keyof typeof emptyPermitForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const add = useMutation({
    mutationFn: () =>
      fetchJson(`/api/jobs/${jobId}/permits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, assignedUserId: form.assignedUserId || null, permitFee: form.permitFee || null, expectedApprovalDate: form.expectedApprovalDate || null, expirationDate: form.expirationDate || null }),
      }),
    onSuccess: () => {
      refresh();
      setForm(emptyPermitForm);
      toast.success("Permit added");
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Add a permit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-[11px]">Jurisdiction *</Label>
            <Input value={form.municipality} onChange={(e) => set("municipality", e.target.value)} placeholder="City of Boca Raton" />
          </div>
          <div>
            <Label className="text-[11px]">Permit type</Label>
            <Input value={form.permitType} onChange={(e) => set("permitType", e.target.value)} placeholder="Re-roof, Electrical, …" />
          </div>
          <div>
            <Label className="text-[11px]">Permit #</Label>
            <Input value={form.permitNumber} onChange={(e) => set("permitNumber", e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">Status</Label>
            <Select value={form.status} onValueChange={(v: string | null) => v && set("status", v)}>
              <SelectTrigger>
                <SelectValue>{(v: string) => PERMIT_STATUS_LABEL[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PERMIT_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PERMIT_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Submitted</Label>
            <Input type="date" value={form.submittedDate} onChange={(e) => set("submittedDate", e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">Expected approval</Label>
            <Input type="date" value={form.expectedApprovalDate} onChange={(e) => set("expectedApprovalDate", e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">Expires</Label>
            <Input type="date" value={form.expirationDate} onChange={(e) => set("expirationDate", e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">Permit fee</Label>
            <Input value={form.permitFee} inputMode="decimal" placeholder="0.00" onChange={(e) => set("permitFee", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-[11px]">Coordinator</Label>
            <Select value={form.assignedUserId || "unassigned"} onValueChange={(v: string | null) => v && set("assignedUserId", v === "unassigned" ? "" : v)}>
              <SelectTrigger>
                <SelectValue>
                  {(v: string) => {
                    const u = users.find((x) => x.id === v);
                    return u ? `${u.firstName} ${u.lastName}` : "Unassigned";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-[11px]">Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          {onDone && (
            <Button size="sm" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          )}
          <Button size="sm" disabled={!form.municipality.trim() || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? "Adding…" : "Add permit"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
