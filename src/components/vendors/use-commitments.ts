"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import type { CommitmentStatusName } from "@/lib/vendors/commitments";
import type { ComplianceSummary } from "./compliance-badge";

export type CommitmentRow = {
  id: string;
  jobId: string;
  number: number;
  description: string;
  amount: number;
  status: CommitmentStatusName;
  committedDate: string;
  closedAt: string | null;
  notes: string | null;
  vendor: { id: string; name: string; kind: string };
  budgetLine: { id: string; name: string; category: string | null } | null;
  createdBy: { firstName: string; lastName: string };
  /** Σ approved expenses drawn against it. */
  received: number;
  /** What is still promised; 0 once closed or cancelled. */
  open: number;
  expenseCount: number;
  vendorCompliance: ComplianceSummary | null;
};

export type JobCommitments = {
  commitments: CommitmentRow[];
  /** Crew labor contracts: commitments of their own kind, shown here read-only. */
  laborContracts: { id: string; name: string; vendor: { id: string; name: string } | null; amount: number; paid: number; open: number }[];
  budgetLines: { id: string; name: string; category: string | null }[];
  totals: { committed: number; received: number; open: number };
  canManage: boolean;
};

export const commitmentsKey = (jobId: string) => ["job", jobId, "commitments"] as const;

export function useJobCommitments(jobId: string, enabled = true) {
  return useQuery<JobCommitments>({
    queryKey: commitmentsKey(jobId),
    queryFn: () => fetchJson(`/api/jobs/${jobId}/commitments`),
    retry: retryServerErrors,
    enabled,
  });
}
