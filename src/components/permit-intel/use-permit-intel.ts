"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";

/** Lists the permit screens pick from: the building departments and the permit-type catalog. */
export type JurisdictionOption = { id: string; name: string; kind: string; county: string | null; hvhz: boolean; isActive: boolean; portalUrl: string | null; submissionMethod: string; reviewDaysTarget: number | null; notes: string | null; _count?: { permits: number; knowledge: number } };
export type PermitTypeOption = { key: string; name: string };

export const permitIntelKeys = {
  jurisdictions: (all = false) => ["jurisdictions", all ? "all" : "active"] as const,
  permitTypes: ["permit-types"] as const,
  requirements: ["permit-requirements"] as const,
  permit: (id: string) => ["permit", id] as const,
};

export function useJurisdictions(all = false) {
  return useQuery({
    queryKey: permitIntelKeys.jurisdictions(all),
    queryFn: () => fetchJson<JurisdictionOption[]>(`/api/jurisdictions${all ? "?all=1" : ""}`),
    retry: retryServerErrors,
    staleTime: 60_000,
  });
}

export function usePermitTypes() {
  return useQuery({
    queryKey: permitIntelKeys.permitTypes,
    queryFn: () => fetchJson<PermitTypeOption[]>("/api/permit-types"),
    retry: retryServerErrors,
    staleTime: 5 * 60_000,
  });
}

export function usePermitDetail(id: string) {
  return useQuery({
    queryKey: permitIntelKeys.permit(id),
    queryFn: () => fetchJson<import("./types").PermitDetail>(`/api/permits/${id}`),
    retry: retryServerErrors,
  });
}

/** After any write on the permit page: the page, the job's Permits tab, Permit Center and task lists. */
export function useInvalidatePermit(id: string, jobId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: permitIntelKeys.permit(id) });
    qc.invalidateQueries({ queryKey: ["permits"] });
    qc.invalidateQueries({ queryKey: ["tasks-v2"] });
    if (jobId) qc.invalidateQueries({ queryKey: ["job", jobId] });
  };
}

/** A JSON write that toasts its error and refreshes the permit. */
export function usePermitWrite<T = unknown>(id: string, jobId: string | undefined) {
  const invalidate = useInvalidatePermit(id, jobId);
  return useMutation({
    mutationFn: ({ url, method, body }: { url: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown }) =>
      fetchJson<T>(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
}
