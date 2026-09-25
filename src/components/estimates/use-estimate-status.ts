"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { taskKeys } from "@/components/tasks/use-tasks";
import {
  ESTIMATE_STATUS_LABEL,
  type EstimateStatusValue,
} from "@/lib/estimates/estimate-status";

/**
 * Mark a template estimate sent / accepted / declined without re-sending the
 * whole estimate (PATCH carries status only). The server raises or retires the
 * follow-up task; we just refresh the lists that show the badge.
 */
export function useSetEstimateStatus(leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ estimateId, status }: { estimateId: string; status: EstimateStatusValue }) =>
      fetchJson<{ id: string; status: EstimateStatusValue }>(
        `/api/leads/${leadId}/template-estimates/${estimateId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      ),
    onSuccess: (updated) => {
      toast.success(`Estimate marked ${ESTIMATE_STATUS_LABEL[updated.status].toLowerCase()}`);
      queryClient.invalidateQueries({ queryKey: ["lead-template-estimates", leadId] });
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
    onError: (e: Error) => toast.error(e.message || "Could not update status"),
  });
}
