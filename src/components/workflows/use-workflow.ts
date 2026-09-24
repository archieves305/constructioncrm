"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, HttpError, retryServerErrors } from "@/lib/fetch-json";
import { taskKeys } from "@/components/tasks/use-tasks";
import type {
  ApplyBody,
  ApplyResultData,
  JobWorkflowData,
  PatchWorkflowBody,
  RoleDefaultRow,
  WorkflowPreviewData,
  WorkflowTemplateOption,
} from "./types";

/**
 * Data access for the Workflow tab. Every mutation fans out to the task
 * keys too, because a workflow change IS a task change: the job's Tasks tab,
 * the sidebar badge and /tasks all need to move together.
 */

export const workflowKeys = {
  job: (jobId: string) => ["job-workflow", jobId] as const,
  templates: (jobId?: string) => ["workflow-templates", jobId ?? "all"] as const,
  roleDefaults: ["workflow-role-defaults"] as const,
};

export function useJobWorkflow(jobId: string, opts: { enabled?: boolean } = {}) {
  return useQuery<JobWorkflowData>({
    queryKey: workflowKeys.job(jobId),
    queryFn: () => fetchJson(`/api/jobs/${jobId}/workflow`),
    retry: retryServerErrors,
    enabled: opts.enabled ?? true,
  });
}

export function useWorkflowTemplates(jobId?: string, opts: { enabled?: boolean } = {}) {
  return useQuery<WorkflowTemplateOption[]>({
    queryKey: workflowKeys.templates(jobId),
    queryFn: () => fetchJson(`/api/workflow-templates${jobId ? `?suggestForJobId=${jobId}` : ""}`),
    staleTime: 5 * 60_000,
    retry: retryServerErrors,
    enabled: opts.enabled ?? true,
  });
}

export function useInvalidateWorkflow(jobId: string) {
  const qc = useQueryClient();
  return (extra: QueryKey[] = []) => {
    qc.invalidateQueries({ queryKey: workflowKeys.job(jobId) });
    qc.invalidateQueries({ queryKey: ["job", jobId] });
    qc.invalidateQueries({ queryKey: taskKeys.all });
    qc.invalidateQueries({ queryKey: taskKeys.summary });
    for (const k of [["jobs"], ["dashboard"], ["field-today"], ...extra]) qc.invalidateQueries({ queryKey: k });
  };
}

function post<T>(url: string, body: unknown, method = "POST") {
  return fetchJson<T>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function usePreviewWorkflow(jobId: string) {
  return useMutation({
    mutationFn: (body: ApplyBody) => post<WorkflowPreviewData>(`/api/jobs/${jobId}/workflow/preview`, body),
    onError: (e: Error) => toast.error(e.message || "Could not build the preview"),
  });
}

export function useApplyWorkflow(jobId: string) {
  const invalidate = useInvalidateWorkflow(jobId);
  return useMutation({
    mutationFn: (body: ApplyBody) => post<ApplyResultData>(`/api/jobs/${jobId}/workflow/apply`, body),
    onSuccess: (r) => {
      invalidate();
      toast.success(
        r.created === 0
          ? "Workflow already applied — nothing new to create"
          : `Workflow applied — ${r.created} task${r.created === 1 ? "" : "s"} created`,
      );
    },
    onError: (e: Error) => toast.error(e instanceof HttpError && e.status === 409 ? e.message : e.message || "Could not apply the workflow"),
  });
}

export function usePatchWorkflow(jobId: string) {
  const invalidate = useInvalidateWorkflow(jobId);
  return useMutation({
    mutationFn: (body: PatchWorkflowBody) => post<JobWorkflowData & { result: Record<string, unknown> }>(`/api/jobs/${jobId}/workflow`, body, "PATCH"),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message || "Could not update the workflow"),
  });
}

export function useAddWorkflowTask(jobId: string) {
  const invalidate = useInvalidateWorkflow(jobId);
  return useMutation({
    mutationFn: (body: { phaseKey: string; title: string; description?: string; assignedUserId?: string | null; dueAt?: string; priority?: string; dependsOnTaskIds?: string[] }) =>
      post(`/api/jobs/${jobId}/workflow/tasks`, body),
    onSuccess: () => {
      invalidate();
      toast.success("Task added to the phase");
    },
    onError: (e: Error) => toast.error(e.message || "Could not add that task"),
  });
}

export function useRoleDefaults(opts: { enabled?: boolean } = {}) {
  return useQuery<RoleDefaultRow[]>({
    queryKey: workflowKeys.roleDefaults,
    queryFn: () => fetchJson("/api/admin/workflow-role-defaults"),
    retry: retryServerErrors,
    enabled: opts.enabled ?? true,
  });
}

export function useSaveRoleDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (defaults: Record<string, string | null>) => post<RoleDefaultRow[]>("/api/admin/workflow-role-defaults", { defaults }, "PUT"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.roleDefaults });
      toast.success("Role defaults saved");
    },
    onError: (e: Error) => toast.error(e.message || "Could not save"),
  });
}
