"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson, HttpError, retryServerErrors } from "@/lib/fetch-json";
import type { PresentedDocument, PresentedJob, PresentedPlanSet, PresentedSheet } from "@/lib/takeoff/service";
import type { PatchSheetInput } from "@/lib/takeoff/validation";

/** Query keys and hooks for plan sets, sheets and index jobs. */
export const planKeys = {
  sets: (leadId: string) => ["plan-sets", leadId] as const,
  set: (id: string) => ["plan-set", id] as const,
  sheets: (planSetId: string) => ["plan-sheets", planSetId] as const,
  job: (jobId: string) => ["takeoff-job", jobId] as const,
};

export type PlanSet = Omit<PresentedPlanSet, "createdAt" | "updatedAt" | "documents"> & { createdAt: string; updatedAt: string; documents: PlanDocument[] };
export type PlanDocument = Omit<PresentedDocument, "createdAt" | "indexedAt" | "job"> & { createdAt: string; indexedAt: string | null; job: IndexJob | null };
export type IndexJob = Omit<PresentedJob, "createdAt" | "startedAt" | "finishedAt" | "updatedAt"> & { createdAt: string; startedAt: string | null; finishedAt: string | null; updatedAt: string };
export type Sheet = Omit<PresentedSheet, "updatedAt"> & { updatedAt: string };

export const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function errorText(err: unknown): string {
  if (err instanceof HttpError) {
    const body = err.body as { error?: string; fields?: Record<string, string[]> } | undefined;
    const first = body?.fields ? Object.values(body.fields)[0]?.[0] : undefined;
    return first ?? body?.error ?? err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

export function usePlanSets(leadId: string) {
  return useQuery<PlanSet[]>({ queryKey: planKeys.sets(leadId), queryFn: () => fetchJson(`/api/plan-sets?leadId=${leadId}`), retry: retryServerErrors });
}

export function usePlanSet(id: string) {
  return useQuery<PlanSet>({ queryKey: planKeys.set(id), queryFn: () => fetchJson(`/api/plan-sets/${id}`), retry: retryServerErrors });
}

export function useSheets(planSetId: string | null) {
  return useQuery<Sheet[]>({ queryKey: planKeys.sheets(planSetId ?? ""), queryFn: () => fetchJson(`/api/plan-sets/${planSetId}/sheets`), enabled: !!planSetId, retry: retryServerErrors });
}

const LIVE: ReadonlySet<string> = new Set(["PENDING", "RUNNING"]);

/**
 * Drive an index job: while it has work left, tick it (each tick runs steps
 * for up to 40 s on the server) and show progress. Once it is done or failed,
 * refresh whatever lists depend on it.
 */
export function useIndexJob(jobId: string | null, onSettled?: (job: IndexJob) => void) {
  const qc = useQueryClient();
  const query = useQuery<IndexJob>({
    queryKey: planKeys.job(jobId ?? ""),
    queryFn: async () => {
      const r = await fetchJson<{ job: IndexJob | null }>(`/api/takeoff-jobs/${jobId}/tick`, { method: "POST" });
      if (!r.job) throw new HttpError(404, "Job not found");
      return r.job;
    },
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && LIVE.has(q.state.data.status) ? 1500 : false),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: retryServerErrors,
  });
  const status = query.data?.status;
  const settled = !!status && !LIVE.has(status);
  // the first render after the job settles refreshes the lists that depend on it
  const settledOnce = useSettledOnce(settled ? query.data ?? null : null, (job) => {
    qc.invalidateQueries({ queryKey: ["plan-sets"] });
    qc.invalidateQueries({ queryKey: ["plan-set"] });
    qc.invalidateQueries({ queryKey: ["plan-sheets"] });
    onSettled?.(job);
  });
  void settledOnce;
  return query;
}

import { useEffect, useRef } from "react";
function useSettledOnce(job: IndexJob | null, fn: (job: IndexJob) => void) {
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (job && seen.current !== job.id) {
      seen.current = job.id;
      fn(job);
    }
  }, [job, fn]);
}

export function useUpdateSheet(planSetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PatchSheetInput }) => fetchJson<Sheet>(`/api/plan-sheets/${id}`, { ...json(patch), method: "PATCH" }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: planKeys.sheets(planSetId) });
      const previous = qc.getQueryData<Sheet[]>(planKeys.sheets(planSetId));
      qc.setQueryData<Sheet[]>(planKeys.sheets(planSetId), (old) => old?.map((s) => (s.id === id ? { ...s, ...patch, corrected: true } as Sheet : s)));
      return { previous };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.previous) qc.setQueryData(planKeys.sheets(planSetId), ctx.previous); },
    onSettled: () => qc.invalidateQueries({ queryKey: planKeys.sheets(planSetId) }),
  });
}
