"use client";

import { useState } from "react";
import Link from "next/link";
import { Gavel, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useSession } from "@/lib/auth/session-client";
import { canCreateCase } from "@/lib/violations/access";
import { CaseNumberLink, CasePhasePill, CaseStatusPill, DeadlineCell } from "./case-widgets";
import { useCaseAction, useViolationCases } from "./use-violations";

/**
 * The Violations tab on a Lead or a Job: the cases on that record, with a
 * pre-filled "New case" and, on a job, "Link an existing case" (one of the
 * property's cases with no job yet).
 */
export function CaseListMini({ scope, newHref, linkAction, invalidateKeys }: { scope: { leadId: string } | { jobId: string; leadId: string }; newHref: string; linkAction?: boolean; invalidateKeys?: unknown }) {
  const { data: session } = useSession();
  const params = "jobId" in scope ? { jobId: scope.jobId, status: "", view: "all", includeClosed: "1" } : { leadId: scope.leadId, view: "all" };
  const { data, isLoading, error } = useViolationCases({ ...params, pageSize: 50 });
  const { data: closed } = useViolationCases({ ...params, view: "closed", pageSize: 50 });
  const rows = [...(data?.data ?? []), ...(closed?.data ?? [])];
  const canCreate = session ? canCreateCase(session.user.role) : false;
  const [linking, setLinking] = useState(false);
  void invalidateKeys;

  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Gavel className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Code violations</h3>
        <span className="rounded-full bg-gray-100 px-1.5 text-[11px] tabular-nums text-gray-600">{rows.length}</span>
        <div className="flex-1" />
        {linkAction && canCreate && "jobId" in scope && (
          <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
            <Link2 className="size-3.5" /> Link existing case
          </Button>
        )}
        {canCreate && (
          <Button size="sm" variant="brand" onClick={() => (window.location.href = newHref)}>
            <Plus className="size-3.5" /> New case
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : error ? (
        <p className="px-4 py-6 text-center text-sm text-tone-danger-fg">Couldn&apos;t load the cases.</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Gavel} title="No code violations here" description="A case links the notice, its items, the deadline and the corrective work to this record." />
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <CaseNumberLink id={r.id} caseNumber={r.caseNumber} />
              <Link href={`/violations/${r.id}`} className="min-w-0 flex-1 truncate hover:underline">
                {r.title}
              </Link>
              <CaseStatusPill status={r.status} />
              <CasePhasePill state={r.state} />
              <DeadlineCell at={r.currentDeadline} done={Boolean(r.agencyConfirmedAt) || r.status === "CLOSED"} />
              <UserAvatar user={r.caseManager} size="xs" />
            </li>
          ))}
        </ul>
      )}
      {linkAction && "jobId" in scope && <LinkCaseDialog open={linking} onOpenChange={setLinking} jobId={scope.jobId} leadId={scope.leadId} />}
    </div>
  );
}

function LinkCaseDialog({ open, onOpenChange, jobId, leadId }: { open: boolean; onOpenChange: (o: boolean) => void; jobId: string; leadId: string }) {
  const { data, isLoading } = useViolationCases({ leadId, unlinked: "1", view: "all", pageSize: 50 }, { enabled: open });
  const [picked, setPicked] = useState<string | null>(null);
  const link = useCaseAction<{ jobId: string }>(picked ?? "", "/link-job", { success: "Case linked to this job", extraKeys: [["job", jobId]] });
  const rows = data?.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link an existing case</DialogTitle>
          <DialogDescription>Open cases on this property that have no corrective job yet.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-16" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every case on this property already has a job.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {rows.map((r) => (
              <li key={r.id}>
                <label className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${picked === r.id ? "border-brand bg-brand/5" : "hover:bg-gray-50"}`}>
                  <input type="radio" name="link-case" checked={picked === r.id} onChange={() => setPicked(r.id)} />
                  <span className="font-mono">{r.caseNumber}</span>
                  <span className="truncate">{r.title}</span>
                  <CaseStatusPill status={r.status} className="ml-auto" />
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={!picked || link.isPending} onClick={() => link.mutate({ jobId }, { onSuccess: () => onOpenChange(false) })}>
            {link.isPending ? "Linking…" : "Link case"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
