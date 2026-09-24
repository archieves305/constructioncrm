"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import type { TaskSummary } from "@/lib/tasks/summary";
import type { CreateTaskPayload, TaskListItem, UpdatePatch, UserOption } from "./types";

/**
 * Data access for everything task-shaped on the client.
 *
 * Every mutation invalidates the same family of keys so a checkbox ticked on
 * a job page updates the sidebar badge, the dashboard widget and the tasks
 * page without each caller remembering to. The `"tasks-v2"` prefix predates
 * this file and is kept so the detail sheet's existing invalidations still hit.
 */

export const taskKeys = {
  all: ["tasks-v2"] as const,
  list: (filters: TaskListFilters) => ["tasks-v2", filters] as const,
  detail: (id: string) => ["task", id] as const,
  summary: ["tasks-summary"] as const,
  users: ["users", "assignable"] as const,
};

/** Keys that other pages own but that task changes make stale. */
const RELATED_KEYS: QueryKey[] = [["field-today"], ["dashboard"], ["jobs"], ["leads"], ["prospects"]];

export type TaskListFilters = {
  assignedUserId?: string;
  status?: string;
  priority?: string;
  overdue?: boolean;
  includeCompleted?: boolean;
  leadId?: string;
  jobId?: string;
  estimateId?: string;
  invoiceId?: string;
  prospectId?: string;
  dailyLogId?: string;
  // Workflow filters (see lib/tasks/query.ts)
  source?: "manual" | "workflow";
  workflowInstanceId?: string;
  phaseKey?: string;
  moduleKey?: string;
  ready?: boolean;
  waiting?: boolean;
  blocked?: boolean;
  includeInactive?: boolean;
};

function toQuery(filters: TaskListFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === "" || v === false) continue;
    p.set(k, String(v));
  }
  return p.toString();
}

export function useTasks(filters: TaskListFilters, opts: { enabled?: boolean } = {}) {
  return useQuery<TaskListItem[]>({
    queryKey: taskKeys.list(filters),
    queryFn: () => fetchJson(`/api/tasks?${toQuery(filters)}`),
    retry: retryServerErrors,
    enabled: opts.enabled ?? true,
  });
}

export function useTaskSummary(opts: { enabled?: boolean } = {}) {
  return useQuery<TaskSummary>({
    queryKey: taskKeys.summary,
    queryFn: () => fetchJson("/api/tasks/summary"),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: retryServerErrors,
    enabled: opts.enabled ?? true,
  });
}

export function useAssignableUsers() {
  return useQuery<UserOption[]>({
    queryKey: taskKeys.users,
    queryFn: () => fetchJson("/api/users/assignable"),
    staleTime: 5 * 60_000,
    retry: retryServerErrors,
  });
}

export function useInvalidateTasks() {
  const qc = useQueryClient();
  return (extra: QueryKey[] = [], taskId?: string) => {
    qc.invalidateQueries({ queryKey: taskKeys.all });
    qc.invalidateQueries({ queryKey: taskKeys.summary });
    if (taskId) qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    for (const k of [...RELATED_KEYS, ...extra]) qc.invalidateQueries({ queryKey: k });
  };
}

export function useCreateTask(opts: { invalidateKeys?: QueryKey[] } = {}) {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (payload: CreateTaskPayload) =>
      fetchJson<TaskListItem>("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (task) => invalidate(opts.invalidateKeys, task.id),
    onError: (e: Error) => toast.error(e.message || "Could not create that task"),
  });
}

export function useUpdateTask(opts: { invalidateKeys?: QueryKey[] } = {}) {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdatePatch }) =>
      fetchJson<TaskListItem>(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: (task) => invalidate(opts.invalidateKeys, task.id),
    onError: (e: Error) => toast.error(e.message || "Update failed"),
  });
}
