"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/fetch-json";
import { workflowKeys } from "@/components/workflows/use-workflow";
import { dayOf, PERMIT_STATUS_LABEL, PERMIT_STATUS_OPTIONS, type AssignableUser, type PermitRecord } from "./shared";

/** Refresh everything that shows a permit after it changed — the gates it settles included. */
export function usePermitRefresh(jobId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["job", jobId] });
    qc.invalidateQueries({ queryKey: ["permits"] });
    qc.invalidateQueries({ queryKey: workflowKeys.job(jobId) });
  };
}

export function useUpdatePermit(jobId: string) {
  const refresh = usePermitRefresh(jobId);
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Record<string, unknown>) =>
      fetchJson<PermitRecord>(`/api/permits/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <Label className="text-[11px]">{label}</Label>
      {children}
    </div>
  );
}

const DATE_FIELDS = [
  ["submittedDate", "Submitted"],
  ["expectedApprovalDate", "Expected approval"],
  ["approvedDate", "Issued"],
  ["expirationDate", "Expires"],
  ["finalPassedDate", "Final passed"],
] as const;

type FieldKey = Exclude<keyof PermitRecord, "id" | "jobId" | "inspections" | "assignedTo">;
type Draft = Partial<Record<FieldKey, string | null>>;

/**
 * Every field of a permit, saved together. Used on the job's Permits tab and
 * in the Permit Center drawer, so a permit is edited the same way in both.
 */
export function PermitEditor({ permit, users, canEdit, onSaved }: { permit: PermitRecord; users: AssignableUser[]; canEdit: boolean; onSaved?: () => void }) {
  const [draft, setDraft] = useState<Draft>({});
  const update = useUpdatePermit(permit.jobId);
  const set = (k: FieldKey, v: string | null) => setDraft((d) => ({ ...d, [k]: v }));
  const val = (k: FieldKey): string => {
    const v = k in draft ? draft[k] : (permit[k] as string | null);
    return v ?? "";
  };
  const dirty = Object.keys(draft).length > 0;
  const status = val("status") || "APPLIED";
  // The server fills an empty issue or final date when the status says so.
  const willStamp =
    draft.status && draft.status !== permit.status
      ? [(draft.status === "ISSUED" || draft.status === "FINAL") && !val("approvedDate") ? "issue date" : null, draft.status === "FINAL" && !val("finalPassedDate") ? "final-passed date" : null].filter(Boolean)
      : [];

  return (
    <fieldset disabled={!canEdit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Jurisdiction">
          <Input value={val("municipality")} onChange={(e) => set("municipality", e.target.value)} />
        </Field>
        <Field label="Permit type">
          <Input value={val("permitType")} onChange={(e) => set("permitType", e.target.value)} placeholder="Re-roof, Electrical, …" />
        </Field>
        <Field label="Permit #">
          <Input value={val("permitNumber")} onChange={(e) => set("permitNumber", e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={status} onValueChange={(v: string | null) => v && set("status", v)}>
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
        </Field>
        {DATE_FIELDS.map(([key, label]) => (
          <Field key={key} label={label}>
            <Input type="date" value={dayOf(val(key))} onChange={(e) => set(key, e.target.value || null)} />
          </Field>
        ))}
        <Field label="Permit fee">
          <Input value={val("permitFee")} inputMode="decimal" placeholder="0.00" onChange={(e) => set("permitFee", e.target.value)} />
        </Field>
        <Field label="Inspector">
          <Input value={val("inspectorName")} onChange={(e) => set("inspectorName", e.target.value)} />
        </Field>
        <Field label="Coordinator">
          <Select value={val("assignedUserId") || "unassigned"} onValueChange={(v: string | null) => v && set("assignedUserId", v === "unassigned" ? null : v)}>
            <SelectTrigger>
              <SelectValue>
                {(v: string) => {
                  const u = users.find((x) => x.id === v);
                  return u ? `${u.firstName} ${u.lastName}` : v === permit.assignedUserId && permit.assignedTo ? `${permit.assignedTo.firstName} ${permit.assignedTo.lastName}` : "Unassigned";
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
        </Field>
        <Field label="Notes" wide>
          <Textarea rows={3} value={val("notes")} onChange={(e) => set("notes", e.target.value)} placeholder="Conditions of approval, conversations with the building department…" />
        </Field>
      </div>
      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {willStamp.length > 0 && <p className="mr-auto text-xs text-muted-foreground">Saving fills today as the {willStamp.join(" and ")}.</p>}
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setDraft({})}>
              Discard
            </Button>
          )}
          <Button
            size="sm"
            disabled={!dirty || update.isPending || !val("municipality").trim()}
            onClick={() =>
              update.mutate(
                { id: permit.id, ...draft },
                {
                  onSuccess: () => {
                    setDraft({});
                    toast.success("Permit saved");
                    onSaved?.();
                  },
                },
              )
            }
          >
            {update.isPending ? "Saving…" : "Save permit"}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
