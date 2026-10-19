"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { permitIntelKeys } from "../use-permit-intel";
import type { CorrectionsData } from "./types";

export const correctionsKey = (permitId: string) => ["permit", permitId, "corrections"] as const;

/** The Corrections tab's data; polled while a notice is being read. */
export function useCorrections(permitId: string) {
  return useQuery({
    queryKey: correctionsKey(permitId),
    queryFn: () => fetchJson<CorrectionsData>(`/api/permits/${permitId}/corrections`),
    retry: retryServerErrors,
    refetchInterval: (q) => (q.state.data?.notices.some((n) => n.status === "EXTRACTING") ? 4_000 : false),
  });
}

/** After a corrections write: the tab, the permit (status, files, tasks) and task lists. */
export function useInvalidateCorrections(permitId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: correctionsKey(permitId) });
    qc.invalidateQueries({ queryKey: permitIntelKeys.permit(permitId), exact: true });
    qc.invalidateQueries({ queryKey: ["permits"] });
    qc.invalidateQueries({ queryKey: ["tasks-v2"] });
  };
}

/** A JSON write that toasts its error and refreshes the tab. */
export function useCorrectionsWrite<T = unknown>(permitId: string) {
  const invalidate = useInvalidateCorrections(permitId);
  return useMutation({
    mutationFn: ({ url, method, body }: { url: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown }) =>
      fetchJson<T>(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
}
