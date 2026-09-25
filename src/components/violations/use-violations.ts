"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { taskKeys } from "@/components/tasks/use-tasks";
import type { ViolationSummary } from "@/lib/violations/summary";
import type { CaseDetail, CaseListItem } from "@/lib/violations/read";

/**
 * Data access for everything case-shaped on the client. Every mutation
 * fans out to the task keys too: a case change is usually a task change
 * (workflow steps), and the sidebar badge, /tasks and the Lead/Job tabs
 * must move together.
 */

export const violationKeys = {
  all: ["violations"] as const,
  list: (qs: string) => ["violations", "list", qs] as const,
  detail: (id: string) => ["violation", id] as const,
  summary: ["violations-summary"] as const,
  categories: ["violation-categories"] as const,
  schedule: (kind: "hearings" | "inspections", qs: string) => ["violations", kind, qs] as const,
  files: (id: string) => ["violation-files", id] as const,
  notes: (id: string) => ["violation-notes", id] as const,
  activity: (id: string) => ["violation-activity", id] as const,
  communications: (id: string) => ["violation-communications", id] as const,
  fines: (id: string) => ["violation-fines", id] as const,
};

/** JSON turns Dates into strings and Decimals into strings; the client types say so. */
type Jsonify<T> = T extends Date ? string : T extends { toFixed: unknown; toString: () => string } & object ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;

export type CaseRow = Jsonify<CaseListItem>;
export type CaseData = Jsonify<CaseDetail>;
export type Category = { id: string; key: string; name: string; description: string | null; defaultResponsibleTrade: string | null; defaultPermitRequirement: "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED"; defaultConstructionRequired: boolean; sortOrder: number; isActive: boolean };

export type CaseListResponse = { data: CaseRow[]; total: number; page: number; pageSize: number; totalPages: number };

export function useViolationSummary(opts: { enabled?: boolean } = {}) {
  return useQuery<ViolationSummary>({
    queryKey: violationKeys.summary,
    queryFn: () => fetchJson("/api/violations/summary"),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: retryServerErrors,
    enabled: opts.enabled ?? true,
  });
}

export function useViolationCases(params: URLSearchParams | Record<string, string | number | boolean | undefined>, opts: { enabled?: boolean } = {}) {
  const qs = params instanceof URLSearchParams ? params.toString() : new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (v === undefined || v === "" || v === false ? [] : [[k, String(v)]]))).toString();
  return useQuery<CaseListResponse>({
    queryKey: violationKeys.list(qs),
    queryFn: () => fetchJson(`/api/violations?${qs}`),
    retry: retryServerErrors,
    enabled: opts.enabled ?? true,
  });
}

export function useViolationCase(id: string | null, opts: { enabled?: boolean } = {}) {
  return useQuery<CaseData>({
    queryKey: violationKeys.detail(id ?? ""),
    queryFn: () => fetchJson(`/api/violations/${id}`),
    retry: retryServerErrors,
    enabled: (opts.enabled ?? true) && Boolean(id),
  });
}

export function useViolationCategories(opts: { includeInactive?: boolean } = {}) {
  return useQuery<Category[]>({
    queryKey: [...violationKeys.categories, opts.includeInactive ? "all" : "active"],
    queryFn: () => fetchJson(`/api/violations/categories${opts.includeInactive ? "?includeInactive=1" : ""}`),
    staleTime: 5 * 60_000,
    retry: retryServerErrors,
  });
}

export function useInvalidateViolations() {
  const qc = useQueryClient();
  return (caseId?: string | null, extra: QueryKey[] = []) => {
    qc.invalidateQueries({ queryKey: violationKeys.all });
    qc.invalidateQueries({ queryKey: violationKeys.summary });
    if (caseId) {
      qc.invalidateQueries({ queryKey: violationKeys.detail(caseId) });
      qc.invalidateQueries({ queryKey: ["case-workflow", caseId] });
      for (const k of [violationKeys.files(caseId), violationKeys.notes(caseId), violationKeys.activity(caseId), violationKeys.communications(caseId), violationKeys.fines(caseId)]) qc.invalidateQueries({ queryKey: k });
    }
    qc.invalidateQueries({ queryKey: taskKeys.all });
    qc.invalidateQueries({ queryKey: taskKeys.summary });
    for (const k of [["dashboard"], ["lead"], ["job"], ...extra]) qc.invalidateQueries({ queryKey: k });
  };
}

function send<T>(url: string, body: unknown, method = "POST") {
  return fetchJson<T>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
}

/**
 * One mutation shape for every case action: POST/PATCH/DELETE a sub-path of
 * the case with a JSON body, refresh the case, toast the outcome.
 */
export function useCaseAction<TBody = Record<string, unknown>, TResult = CaseData>(
  caseId: string,
  path: string,
  opts: { method?: "POST" | "PATCH" | "DELETE"; success?: string | ((r: TResult) => string); errorFallback?: string; extraKeys?: QueryKey[] } = {},
) {
  const invalidate = useInvalidateViolations();
  return useMutation({
    mutationFn: (body: TBody) => send<TResult>(`/api/violations/${caseId}${path}`, body, opts.method ?? "POST"),
    onSuccess: (r) => {
      invalidate(caseId, opts.extraKeys);
      const msg = typeof opts.success === "function" ? opts.success(r) : opts.success;
      if (msg) toast.success(msg);
    },
    onError: (e: Error) => toast.error(e.message || opts.errorFallback || "That did not work"),
  });
}

export function useCreateCase() {
  const invalidate = useInvalidateViolations();
  return useMutation({
    mutationFn: (body: unknown) => send<{ id: string; caseNumber: string; tasksCreated: number; workflowWarning: string | null }>("/api/violations", body),
    onSuccess: (r) => {
      invalidate(r.id);
      toast.success(`${r.caseNumber} created${r.tasksCreated ? ` — ${r.tasksCreated} task${r.tasksCreated === 1 ? "" : "s"} generated` : ""}`);
      if (r.workflowWarning) toast.warning(`Workflow not applied: ${r.workflowWarning}`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not create the case"),
  });
}

export function useBulkAssignCases() {
  const invalidate = useInvalidateViolations();
  return useMutation({
    mutationFn: (body: { caseIds: string[]; caseManagerId: string | null }) => send<{ updated: number }>("/api/violations/bulk-assign", body),
    onSuccess: (r) => {
      invalidate();
      toast.success(`${r.updated} case${r.updated === 1 ? "" : "s"} reassigned`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not reassign"),
  });
}

export function money(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
