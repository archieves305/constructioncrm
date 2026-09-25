"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, HttpError, retryServerErrors } from "@/lib/fetch-json";
import { taskKeys } from "@/components/tasks/use-tasks";
import type {
  AdminTemplate,
  ApplyBody,
  ApplyResultData,
  EditorVersion,
  InspectionBody,
  JobWorkflowData,
  PatchWorkflowBody,
  PhaseInput,
  ReconcileChange,
  ReconcilePlanData,
  ReconcileResultData,
  RoleDefaultRow,
  ScopeToggleDef,
  SubjectLike,
  TaskTemplateInput,
  ValidationResultData,
  WorkflowPreviewData,
  WorkflowSubjectRef,
  WorkflowTemplateOption,
} from "./types";
import { toSubjectRef } from "./types";

/**
 * Data access for the Workflow tab. Every mutation fans out to the task
 * keys too, because a workflow change IS a task change: the job's Tasks tab,
 * the sidebar badge and /tasks all need to move together.
 */

export const workflowKeys = {
  /** A job's or a case's workflow read. Kept as "job-workflow" for jobs so older invalidations still hit. */
  subject: (s: SubjectLike) => {
    const ref = toSubjectRef(s);
    return (ref.kind === "job" ? ["job-workflow", ref.id] : ["case-workflow", ref.id]) as readonly [string, string];
  },
  job: (jobId: string) => ["job-workflow", jobId] as const,
  templates: (jobId?: string, kind?: string) => ["workflow-templates", jobId ?? "all", kind ?? "any"] as const,
  roleDefaults: ["workflow-role-defaults"] as const,
  adminTemplates: ["admin-workflow-templates"] as const,
  adminTemplate: (id: string) => ["admin-workflow-template", id] as const,
  version: (vid: string) => ["admin-workflow-version", vid] as const,
};

/** `/api/jobs/:id/workflow` or `/api/violations/:id/workflow` — the same routes exist on both. */
export function workflowBase(s: SubjectLike): string {
  const ref = toSubjectRef(s);
  return ref.kind === "job" ? `/api/jobs/${ref.id}/workflow` : `/api/violations/${ref.id}/workflow`;
}

export function useSubjectWorkflow(subject: SubjectLike | null, opts: { enabled?: boolean } = {}) {
  const ref: WorkflowSubjectRef = subject ? toSubjectRef(subject) : { kind: "job", id: "" };
  return useQuery<JobWorkflowData>({
    queryKey: workflowKeys.subject(ref),
    queryFn: () => fetchJson(workflowBase(ref)),
    retry: retryServerErrors,
    enabled: (opts.enabled ?? true) && Boolean(subject) && ref.id.length > 0,
  });
}

export function useJobWorkflow(jobId: string, opts: { enabled?: boolean } = {}) {
  return useSubjectWorkflow(jobId ? { kind: "job", id: jobId } : null, opts);
}

export function useWorkflowTemplates(jobId?: string, opts: { enabled?: boolean; kind?: "CORE" | "TRADE" | "VIOLATION" } = {}) {
  const qs = new URLSearchParams();
  if (jobId) qs.set("suggestForJobId", jobId);
  if (opts.kind) qs.set("kind", opts.kind);
  const q = qs.toString();
  return useQuery<WorkflowTemplateOption[]>({
    queryKey: workflowKeys.templates(jobId, opts.kind),
    queryFn: () => fetchJson(`/api/workflow-templates${q ? `?${q}` : ""}`),
    staleTime: 5 * 60_000,
    retry: retryServerErrors,
    enabled: opts.enabled ?? true,
  });
}

export function useInvalidateWorkflow(subject: SubjectLike) {
  const qc = useQueryClient();
  const ref = toSubjectRef(subject);
  return (extra: QueryKey[] = []) => {
    qc.invalidateQueries({ queryKey: workflowKeys.subject(ref) });
    qc.invalidateQueries({ queryKey: [ref.kind === "job" ? "job" : "violation", ref.id] });
    qc.invalidateQueries({ queryKey: taskKeys.all });
    qc.invalidateQueries({ queryKey: taskKeys.summary });
    for (const k of [["jobs"], ["violations"], ["violations-summary"], ["dashboard"], ["field-today"], ...extra]) qc.invalidateQueries({ queryKey: k });
  };
}

function post<T>(url: string, body: unknown, method = "POST") {
  return fetchJson<T>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function usePreviewWorkflow(subject: SubjectLike) {
  return useMutation({
    mutationFn: (body: ApplyBody) => post<WorkflowPreviewData>(`${workflowBase(subject)}/preview`, body),
    onError: (e: Error) => toast.error(e.message || "Could not build the preview"),
  });
}

export function useApplyWorkflow(subject: SubjectLike) {
  const invalidate = useInvalidateWorkflow(subject);
  return useMutation({
    mutationFn: (body: ApplyBody) => post<ApplyResultData>(`${workflowBase(subject)}/apply`, body),
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

export function usePatchWorkflow(subject: SubjectLike) {
  const invalidate = useInvalidateWorkflow(subject);
  return useMutation({
    mutationFn: (body: PatchWorkflowBody) => post<JobWorkflowData & { result: Record<string, unknown> }>(workflowBase(subject), body, "PATCH"),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message || "Could not update the workflow"),
  });
}

export function useAddWorkflowTask(subject: SubjectLike) {
  const invalidate = useInvalidateWorkflow(subject);
  return useMutation({
    mutationFn: (body: { phaseKey: string; title: string; description?: string; assignedUserId?: string | null; dueAt?: string; priority?: string; dependsOnTaskIds?: string[] }) =>
      post(`${workflowBase(subject)}/tasks`, body),
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

// ── Stage 2: reconciliation, inspections, dependencies ──

export function useReconcilePreview(subject: SubjectLike) {
  return useMutation({
    mutationFn: (change: ReconcileChange) => post<ReconcilePlanData>(`${workflowBase(subject)}/reconcile/preview`, change),
    onError: (e: Error) => toast.error(e.message || "Could not build the preview"),
  });
}

export function useReconcile(subject: SubjectLike) {
  const invalidate = useInvalidateWorkflow(subject);
  return useMutation({
    mutationFn: (change: ReconcileChange) => post<JobWorkflowData & { result: ReconcileResultData }>(`${workflowBase(subject)}/reconcile`, change),
    onSuccess: (d) => {
      invalidate();
      const r = d.result;
      const bits = [r.created ? `${r.created} added` : "", r.reinstated ? `${r.reinstated} reinstated` : "", r.skipped ? `${r.skipped} skipped` : ""].filter(Boolean);
      toast.success(`Workflow re-planned${bits.length ? ` — ${bits.join(", ")}` : ""}`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not re-plan the workflow"),
  });
}

export function useRecordInspection(taskId: string, subject?: SubjectLike | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InspectionBody) => post<{ status: string; correctionTaskId: string | null }>(`/api/tasks/${taskId}/inspection`, body),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      qc.invalidateQueries({ queryKey: taskKeys.all });
      qc.invalidateQueries({ queryKey: taskKeys.summary });
      if (subject) {
        const ref = toSubjectRef(subject);
        qc.invalidateQueries({ queryKey: workflowKeys.subject(ref) });
        qc.invalidateQueries({ queryKey: [ref.kind === "job" ? "job" : "violation", ref.id] });
      }
      toast.success(r.status === "BLOCKED" ? "Failed inspection recorded — correction task created" : r.correctionTaskId ? "Inspection recorded with conditions — correction task created" : "Inspection passed");
    },
    onError: (e: Error) => toast.error(e.message || "Could not record the inspection"),
  });
}

export function useTaskDependencies(taskId: string, subject?: SubjectLike | null) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    qc.invalidateQueries({ queryKey: taskKeys.all });
    if (subject) qc.invalidateQueries({ queryKey: workflowKeys.subject(toSubjectRef(subject)) });
  };
  const add = useMutation({
    mutationFn: (body: { dependsOnTaskId: string; kind?: "BLOCKING" | "DATE_ONLY" }) => post(`/api/tasks/${taskId}/dependencies`, body),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message || "Could not add that dependency"),
  });
  const remove = useMutation({
    mutationFn: (dependsOnTaskId: string) => fetchJson(`/api/tasks/${taskId}/dependencies?dependsOnTaskId=${encodeURIComponent(dependsOnTaskId)}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message || "Could not remove that dependency"),
  });
  return { add, remove };
}

// ── Stage 2: template editor ──

export function useAdminTemplates(opts: { enabled?: boolean } = {}) {
  return useQuery<AdminTemplate[]>({
    queryKey: workflowKeys.adminTemplates,
    queryFn: () => fetchJson("/api/admin/workflow-templates"),
    retry: retryServerErrors,
    enabled: opts.enabled ?? true,
  });
}

export function useAdminTemplate(id: string) {
  return useQuery<AdminTemplate>({
    queryKey: workflowKeys.adminTemplate(id),
    queryFn: () => fetchJson(`/api/admin/workflow-templates/${id}`),
    retry: retryServerErrors,
  });
}

export function useEditorVersion(vid: string | null) {
  return useQuery<EditorVersion>({
    queryKey: workflowKeys.version(vid ?? ""),
    queryFn: () => fetchJson(`/api/admin/workflow-versions/${vid}`),
    retry: retryServerErrors,
    enabled: Boolean(vid),
  });
}

/** Every editor mutation, invalidating the version tree and the template it belongs to. */
export function useEditorMutations(templateId: string, vid: string | null) {
  const qc = useQueryClient();
  const refresh = () => {
    if (vid) qc.invalidateQueries({ queryKey: workflowKeys.version(vid) });
    qc.invalidateQueries({ queryKey: workflowKeys.adminTemplate(templateId) });
    qc.invalidateQueries({ queryKey: workflowKeys.adminTemplates });
    qc.invalidateQueries({ queryKey: ["workflow-templates"] });
  };
  const err = (fallback: string) => (e: Error) => toast.error(e.message || fallback);
  const base = `/api/admin/workflow-versions/${vid}`;
  return {
    createDraft: useMutation({
      mutationFn: (from?: string) => post<{ id: string }>(`/api/admin/workflow-templates/${templateId}/versions${from ? `?from=${from}` : ""}`, {}),
      onSuccess: () => {
        refresh();
        toast.success("Draft created");
      },
      onError: err("Could not create a draft"),
    }),
    updateMeta: useMutation({
      mutationFn: (body: { name?: string; trade?: string | null; description?: string | null; isActive?: boolean; serviceCategoryIds?: string[] }) => post(`/api/admin/workflow-templates/${templateId}`, body, "PATCH"),
      onSuccess: () => {
        refresh();
        toast.success("Template saved");
      },
      onError: err("Could not save"),
    }),
    duplicate: useMutation({
      mutationFn: (body: { key: string; name: string }) => post<{ id: string }>(`/api/admin/workflow-templates/${templateId}/duplicate`, body),
      onSuccess: () => {
        refresh();
        toast.success("Template duplicated");
      },
      onError: err("Could not duplicate"),
    }),
    validate: useMutation({
      mutationFn: () => post<ValidationResultData>(`${base}/validate`, {}),
      onError: err("Could not validate"),
    }),
    publish: useMutation({
      mutationFn: (changeNotes?: string | null) => post(`${base}/publish`, { changeNotes: changeNotes ?? null }),
      onSuccess: () => {
        refresh();
        toast.success("Published — new applies use this version");
      },
      onError: err("Could not publish"),
    }),
    archive: useMutation({
      mutationFn: () => post(`${base}/archive`, {}),
      onSuccess: () => {
        refresh();
        toast.success("Version archived");
      },
      onError: err("Could not archive"),
    }),
    setToggles: useMutation({
      mutationFn: (scopeToggles: ScopeToggleDef[]) => post(base, { scopeToggles }, "PATCH"),
      onSuccess: refresh,
      onError: err("Could not save toggles"),
    }),
    addPhase: useMutation({ mutationFn: (body: PhaseInput) => post(`${base}/phases`, body), onSuccess: refresh, onError: err("Could not add the phase") }),
    updatePhase: useMutation({ mutationFn: ({ id, ...body }: Partial<PhaseInput> & { id: string }) => post(`${base}/phases/${id}`, body, "PATCH"), onSuccess: refresh, onError: err("Could not save the phase") }),
    deletePhase: useMutation({ mutationFn: (id: string) => fetchJson(`${base}/phases/${id}`, { method: "DELETE" }), onSuccess: refresh, onError: err("Could not delete the phase") }),
    reorderPhases: useMutation({ mutationFn: (ids: string[]) => post(`${base}/phases/reorder`, { ids }), onSuccess: refresh, onError: err("Could not reorder") }),
    addTask: useMutation({ mutationFn: (body: TaskTemplateInput) => post(`${base}/tasks`, body), onSuccess: refresh, onError: err("Could not add the step") }),
    updateTask: useMutation({ mutationFn: ({ id, ...body }: Partial<TaskTemplateInput> & { id: string }) => post(`${base}/tasks/${id}`, body, "PATCH"), onSuccess: refresh, onError: err("Could not save the step") }),
    deleteTask: useMutation({ mutationFn: (id: string) => fetchJson(`${base}/tasks/${id}`, { method: "DELETE" }), onSuccess: refresh, onError: err("Could not delete the step") }),
    reorderTasks: useMutation({ mutationFn: (body: { phaseId: string; ids: string[] }) => post(`${base}/tasks/reorder`, body), onSuccess: refresh, onError: err("Could not reorder") }),
  };
}
