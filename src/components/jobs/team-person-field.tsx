"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { useAssignableUsers } from "@/components/tasks/use-tasks";
import { useInvalidateWorkflow } from "@/components/workflows/use-workflow";
import { fetchJson } from "@/lib/fetch-json";

/**
 * The job's project manager or sales rep, set in place on the Team card.
 * Before this the only way to name a PM was the Workflow tab's team dialog,
 * so a job without a workflow could not have one. Saving goes through the job
 * PATCH, which keeps the workflow team slot in step and hands the PM's
 * unowned steps to them.
 */
export function TeamPersonField({
  jobId,
  field,
  label,
  value,
  canEdit,
}: {
  jobId: string;
  field: "projectManagerId" | "salesRepId";
  label: string;
  value: { id: string; firstName: string; lastName: string } | null;
  canEdit: boolean;
}) {
  const { data: users = [] } = useAssignableUsers();
  const invalidate = useInvalidateWorkflow({ kind: "job", id: jobId });

  const save = useMutation({
    mutationFn: (userId: string | null) =>
      fetchJson(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: userId }),
      }),
    onSuccess: (_d, userId) => {
      invalidate([["job", jobId], ["jobs"]]);
      const u = users.find((x) => x.id === userId);
      toast.success(u ? `${label} set to ${u.firstName} ${u.lastName}` : `${label} cleared`);
    },
    onError: (e: Error) => toast.error(e.message || `Could not save the ${label.toLowerCase()}`),
  });

  if (!canEdit) {
    return <span>{label}: {value ? `${value.firstName} ${value.lastName}` : "—"}</span>;
  }
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0">{label}:</span>
      <AssigneePicker
        value={value?.id ?? null}
        onChange={(id) => save.mutate(id)}
        users={users.filter((u) => u.isActive || u.id === value?.id)}
        size="sm"
        placeholder="Not set"
        className="min-w-0 flex-1"
      />
    </span>
  );
}
