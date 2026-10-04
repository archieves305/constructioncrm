"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Callout } from "@/components/shared/callout";

type Line = { label: string; count: number };
type Plan = { blockers: Line[]; removes: Line[]; keptFiles: number };

/**
 * Admin-only delete of a job created by mistake or as a test. Shows what goes
 * with the job first; a job with money, field or contract records is refused.
 */
export function DeleteJobDialog({
  jobId,
  jobName,
  open,
  onOpenChange,
}: {
  jobId: string;
  jobName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: plan, isLoading, error } = useQuery<Plan>({
    queryKey: ["job-delete-check", jobId],
    queryFn: () => fetchJson(`/api/jobs/${jobId}/delete-check`),
    enabled: open,
    staleTime: 0,
  });

  const del = useMutation({
    mutationFn: (reason: string) =>
      fetchJson(`/api/jobs/${jobId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      toast.success(`${jobName} deleted`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onOpenChange(false);
      router.push("/jobs");
    },
    onError: (e: Error) => toast.error(e.message || "Could not delete the job"),
  });

  const blocked = Boolean(plan && plan.blockers.length > 0);
  const list = (lines: Line[]) => (
    <ul className="mt-1 list-disc pl-5">
      {lines.map((l) => (
        <li key={l.label}>
          {l.count} {l.label}
        </li>
      ))}
    </ul>
  );

  if (isLoading || error || !plan || blocked) {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Delete ${jobName}?`}
        confirmLabel="OK"
        cancelLabel="Close"
        onConfirm={() => onOpenChange(false)}
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Checking what is on this job…</p>
        ) : error || !plan ? (
          <Callout tone="danger">Could not check this job: {(error as Error | null)?.message ?? "no answer"}</Callout>
        ) : (
          <Callout tone="danger">
            This job cannot be deleted. It has records that must be kept:
            {list(plan.blockers)}
            <p className="mt-2">If the job is finished or abandoned, move it to Closed instead.</p>
          </Callout>
        )}
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${jobName}?`}
      tone="danger"
      description="For a job created by mistake or as a test. This cannot be undone."
      confirmLabel="Delete job"
      requireReason={{ minLength: 3 }}
      reasonLabel="Why is this job being deleted?"
      reasonPlaceholder="e.g. Test job"
      checkboxLabel="I understand the job and everything listed here will be permanently deleted"
      pending={del.isPending}
      onConfirm={(reason) => del.mutateAsync(reason).then(() => undefined, () => undefined)}
    >
      <div className="text-sm">
        {plan.removes.length > 0 ? (
          <>
            <p>Deleted with the job:</p>
            {list(plan.removes)}
          </>
        ) : (
          <p>Nothing else is recorded on this job.</p>
        )}
        <p className="mt-2 text-muted-foreground">
          The lead stays{plan.keptFiles > 0 ? `, and the job's ${plan.keptFiles} file${plan.keptFiles === 1 ? "" : "s"} stay on the lead` : ""}.
        </p>
      </div>
    </ConfirmDialog>
  );
}
