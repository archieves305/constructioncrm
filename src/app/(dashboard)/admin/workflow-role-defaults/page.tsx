"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/shared/callout";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { useAssignableUsers } from "@/components/tasks/use-tasks";
import { useSession } from "@/lib/auth/session-client";
import { useRoleDefaults, useSaveRoleDefaults } from "@/components/workflows/use-workflow";

/**
 * Company-wide fallback assignee per functional role. A job's own team slots
 * and its PM / sales rep fields win over these; this is who gets "Permit
 * coordinator" steps when nobody was named on the job.
 */
export default function WorkflowRoleDefaultsPage() {
  const { data: session } = useSession();
  const { data: rows = [], isLoading, error } = useRoleDefaults();
  const { data: users = [] } = useAssignableUsers();
  const save = useSaveRoleDefaults();
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const canEdit = session?.user.role === "ADMIN";

  const valueFor = (role: string, current: string | null) => (role in draft ? draft[role]! : current);

  return (
    <div>
      <PageHeader
        title="Workflow Roles"
        description="Who picks up each functional role when a job's team does not name someone. Project manager and sales rep default to the job's own fields first."
        actions={
          canEdit ? (
            <Button variant="brand" disabled={Object.keys(draft).length === 0 || save.isPending} onClick={() => save.mutate(draft, { onSuccess: () => setDraft({}) })}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          ) : undefined
        }
      />
      {error ? (
        <Callout tone="danger" title="Couldn't load role defaults">{error instanceof Error ? error.message : "Something went wrong."}</Callout>
      ) : isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="max-w-2xl rounded-lg border bg-white">
          {!canEdit && <p className="border-b px-4 py-2 text-xs text-muted-foreground">Only an admin can change these.</p>}
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.role} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-[180px] flex-1">
                  <Label className="text-sm">{r.label}</Label>
                  {(r.role === "PROJECT_MANAGER" || r.role === "SALES_REP") && (
                    <p className="text-[11px] text-muted-foreground">Falls back to the job&apos;s {r.role === "PROJECT_MANAGER" ? "project manager" : "sales rep"} before this.</p>
                  )}
                  {r.user && !r.user.isActive && <p className="text-[11px] text-tone-warning-fg">This person is deactivated — pick someone else.</p>}
                </div>
                <AssigneePicker
                  className="w-[240px]"
                  value={valueFor(r.role, r.user?.id ?? null)}
                  users={users}
                  placeholder="Nobody (leave unassigned)"
                  onChange={(id) => canEdit && setDraft((d) => ({ ...d, [r.role]: id }))}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
