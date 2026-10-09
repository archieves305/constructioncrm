"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import type { Verification } from "@/lib/takeoff/geometry/calibrate";
import { chainsToSegments, SnapIndex } from "@/lib/takeoff/snap";
import type { PresentedMeasurement, PresentedTakeoff } from "@/lib/takeoff/takeoff-service";
import type { CalibrateInput, CreateMeasurementInput, PatchMeasurementInput } from "@/lib/takeoff/validation";
import { errorText, json, planKeys, type Sheet } from "./use-plan-sets";

export const takeoffKeys = {
  list: (leadId: string) => ["takeoffs", leadId] as const,
  one: (id: string) => ["takeoff", id] as const,
  measurements: (id: string) => ["takeoff-measurements", id] as const,
  chains: (sheetId: string) => ["plan-sheet-chains", sheetId] as const,
};

type Dates<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };
export type Takeoff = Dates<PresentedTakeoff>;
export type Measurement = Dates<PresentedMeasurement>;

export function useTakeoffs(leadId: string) {
  return useQuery<Takeoff[]>({ queryKey: takeoffKeys.list(leadId), queryFn: () => fetchJson(`/api/takeoffs?leadId=${leadId}`), retry: retryServerErrors });
}

export function useTakeoff(id: string) {
  return useQuery<Takeoff>({ queryKey: takeoffKeys.one(id), queryFn: () => fetchJson(`/api/takeoffs/${id}`), retry: retryServerErrors });
}

export function useMeasurements(takeoffId: string) {
  return useQuery<Measurement[]>({ queryKey: takeoffKeys.measurements(takeoffId), queryFn: () => fetchJson(`/api/takeoffs/${takeoffId}/measurements`), retry: retryServerErrors });
}

export function useCreateTakeoff(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { planSetId: string; trade: "ROOFING" | "PLUMBING" }) => fetchJson<Takeoff>("/api/takeoffs", json(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: takeoffKeys.list(leadId) }),
    onError: (err) => toast.error(errorText(err)),
  });
}

/** The sheet's merged lines for snapping, loaded once per sheet. */
export function useSheetSnapIndex(sheetId: string | null, enabled: boolean) {
  const q = useQuery<{ chains: number[][]; total: number }>({
    queryKey: takeoffKeys.chains(sheetId ?? ""),
    queryFn: () => fetchJson(`/api/plan-sheets/${sheetId}/segments`),
    enabled: !!sheetId && enabled,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: retryServerErrors,
  });
  const index = useMemo(() => (q.data ? new SnapIndex(chainsToSegments(q.data.chains)) : null), [q.data]);
  return { index, loading: q.isLoading, available: !!q.data && q.data.chains.length > 0 };
}

function invalidateTakeoff(qc: ReturnType<typeof useQueryClient>, takeoffId: string) {
  qc.invalidateQueries({ queryKey: takeoffKeys.measurements(takeoffId) });
  qc.invalidateQueries({ queryKey: takeoffKeys.one(takeoffId) });
}

export function useCreateMeasurement(takeoffId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMeasurementInput) => fetchJson<Measurement>(`/api/takeoffs/${takeoffId}/measurements`, json(input)),
    onSuccess: () => invalidateTakeoff(qc, takeoffId),
    onError: (err) => toast.error(errorText(err)),
  });
}

export function useUpdateMeasurement(takeoffId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PatchMeasurementInput }) => fetchJson<Measurement>(`/api/takeoff-measurements/${id}`, { ...json(patch), method: "PATCH" }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: takeoffKeys.measurements(takeoffId) });
      const previous = qc.getQueryData<Measurement[]>(takeoffKeys.measurements(takeoffId));
      qc.setQueryData<Measurement[]>(takeoffKeys.measurements(takeoffId), (old) => old?.map((m) => (m.id === id ? ({ ...m, ...(patch.geometry ? { geometry: patch.geometry } : {}), ...(patch.label ? { label: patch.label } : {}), ...(patch.reviewStatus ? { reviewStatus: patch.reviewStatus } : {}) } as Measurement) : m)));
      return { previous };
    },
    onError: (err, _v, ctx) => { if (ctx?.previous) qc.setQueryData(takeoffKeys.measurements(takeoffId), ctx.previous); toast.error(errorText(err)); },
    onSettled: () => invalidateTakeoff(qc, takeoffId),
  });
}

export function useDeleteMeasurement(takeoffId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchJson(`/api/takeoff-measurements/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateTakeoff(qc, takeoffId),
    onError: (err) => toast.error(errorText(err)),
  });
}

export function useRecompute(takeoffId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<{ changed: number; skipped: number; total: number }>(`/api/takeoffs/${takeoffId}/measurements/recompute`, { method: "POST" }),
    onSuccess: (r) => { invalidateTakeoff(qc, takeoffId); toast.success(r.changed ? `${r.changed} measurement${r.changed === 1 ? "" : "s"} re-measured` : "Nothing changed"); },
    onError: (err) => toast.error(errorText(err)),
  });
}

export type CalibrateResult = { sheet: Sheet; verification: Verification | null; affectedMeasurements: number };

export function useCalibrate(planSetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sheetId, input }: { sheetId: string; input: CalibrateInput }) => fetchJson<CalibrateResult>(`/api/plan-sheets/${sheetId}/calibrate`, json(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: planKeys.sheets(planSetId) }),
  });
}
