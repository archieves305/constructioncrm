"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import type { UserOption } from "@/components/tasks/types";
import { WORKFLOW_ROLE_LABEL, WORKFLOW_ROLES } from "@/lib/workflows/role-labels";
import type { JobWorkflowData, WorkflowRole } from "./types";

/**
 * Who fills each functional role on this job. PM and Sales rep fall back to
 * the job's own fields, everything else to the company default, so a slot
 * left empty is not "nobody" — it is "whoever the fallback resolves to".
 */
export function WorkflowTeamDialog({
  data,
  users,
  open,
  onOpenChange,
  onSave,
  pending,
}: {
  data: JobWorkflowData;
  users: UserOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (team: Partial<Record<WorkflowRole, string | null>>) => void;
  pending?: boolean;
}) {
  const current = Object.fromEntries((data.team ?? []).map((t) => [t.role, t.user.id])) as Partial<Record<WorkflowRole, string>>;
  const [draft, setDraft] = useState<Partial<Record<WorkflowRole, string | null>>>({});
  const close = (o: boolean) => {
    if (!o) setDraft({});
    onOpenChange(o);
  };

  const valueFor = (role: WorkflowRole) => (role in draft ? (draft[role] ?? null) : (current[role] ?? null));
  const fallback = (role: WorkflowRole): string | null => {
    if (role === "PROJECT_MANAGER" && data.job.projectManagerId) return "the job's project manager";
    if (role === "SALES_REP" && data.job.salesRepId) return "the job's sales rep";
    return null;
  };
  const unassigned = new Set(data.unassignedRoles ?? []);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Workflow team</DialogTitle>
          <DialogDescription>
            Each role&apos;s steps go to the person named here. Empty slots fall back to the job&apos;s PM and sales rep, then the company defaults.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {WORKFLOW_ROLES.map((role) => (
            <div key={role}>
              <Label className="flex items-center gap-1.5 text-xs">
                {WORKFLOW_ROLE_LABEL[role]}
                {unassigned.has(role) && <span className="rounded-full bg-tone-warning-soft px-1.5 text-[10px] text-tone-warning-fg">needs someone</span>}
              </Label>
              <AssigneePicker
                className="mt-1 w-full"
                value={valueFor(role)}
                users={users}
                placeholder={fallback(role) ? `Uses ${fallback(role)}` : "Company default"}
                onChange={(id) => setDraft((d) => ({ ...d, [role]: id }))}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button disabled={pending || Object.keys(draft).length === 0} onClick={() => onSave(draft)}>
            {pending ? "Saving…" : "Save team"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
