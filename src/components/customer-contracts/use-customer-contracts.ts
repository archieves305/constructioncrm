"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, HttpError, retryServerErrors } from "@/lib/fetch-json";
import type { CustomerContractStatusValue, PaymentScheduleItem, PaymentScheduleRow } from "@/lib/customer-contracts/types";

export type ContractRowData = {
  id: string;
  jobId: string;
  leadId: string;
  number: number;
  contractNumber: string;
  status: CustomerContractStatusValue;
  contractAmount: string;
  depositAmount: string;
  paymentSchedule: PaymentScheduleRow[];
  snapshotVersion: number;
  estimateId: string | null;
  roofEstimateId: string | null;
  tokenExpiresAt: string | null;
  sentAt: string | null;
  sentToEmail: string | null;
  unsignedPdfSha256: string | null;
  signedAt: string | null;
  signerName: string | null;
  signerEmail: string | null;
  signerIp: string | null;
  signerUserAgent: string | null;
  consentAt: string | null;
  signedPdfSha256: string | null;
  moneyAppliedAt: string | null;
  moneyApplyNote: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
  templateVersion: { id: string; version: number; title: string; template: { key: string; name: string } };
  estimate: { id: string; estimateNumber: string; name: string; status: string } | null;
  roofEstimate: { id: string; estimateNumber: string } | null;
  createdBy: { id: string; firstName: string; lastName: string };
  sentBy: { id: string; firstName: string; lastName: string } | null;
  voidedBy: { id: string; firstName: string; lastName: string } | null;
};

export type PublishedTemplateOption = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  published: { id: string; version: number; title: string } | null;
};

export const contractKeys = {
  job: (jobId: string) => ["customer-contracts", jobId] as const,
  publishedTemplates: ["contract-templates", "published"] as const,
};

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof HttpError) {
    const body = e.body as { error?: string; fields?: string[] } | undefined;
    if (body?.error) return body.fields?.length ? `${body.error}` : body.error;
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

export function useJobContracts(jobId: string, opts: { enabled?: boolean } = {}) {
  return useQuery<ContractRowData[]>({
    queryKey: contractKeys.job(jobId),
    queryFn: () => fetchJson(`/api/jobs/${jobId}/contracts`),
    retry: retryServerErrors,
    enabled: opts.enabled ?? true,
    // A contract out for signature can be signed any minute; keep the panel honest.
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === "SENT") ? 60_000 : false),
  });
}

export function usePublishedContractTemplates(enabled = true) {
  return useQuery<PublishedTemplateOption[]>({
    queryKey: contractKeys.publishedTemplates,
    queryFn: () => fetchJson("/api/contract-templates"),
    retry: retryServerErrors,
    enabled,
    staleTime: 60_000,
  });
}

function useInvalidate(jobId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: contractKeys.job(jobId) });
    // Signing / voiding moves the job's contract amount and deposit.
    qc.invalidateQueries({ queryKey: ["job", jobId] });
    qc.invalidateQueries({ queryKey: ["lead-files"] });
  };
}

const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function useCreateContract(jobId: string) {
  const invalidate = useInvalidate(jobId);
  return useMutation({
    mutationFn: (body: { estimateId?: string; roofEstimateId?: string; includeOptionalItemIds?: string[]; templateKey?: string | null; paymentSchedule?: PaymentScheduleItem[] | null }) =>
      fetchJson<{ contractId: string; contractNumber: string; documentId: string }>(`/api/jobs/${jobId}/contracts`, json(body)),
    onSuccess: (r) => {
      toast.success(`Draft contract ${r.contractNumber} created`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Could not create the contract")),
  });
}

export function useRegenerateContract(jobId: string) {
  const invalidate = useInvalidate(jobId);
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; includeOptionalItemIds?: string[]; templateKey?: string | null; paymentSchedule?: PaymentScheduleItem[] | null }) =>
      fetchJson<{ documentId: string; versionNumber: number }>(`/api/customer-contracts/${id}/regenerate`, json(body)),
    onSuccess: (r) => {
      toast.success(`Contract regenerated — now v${r.versionNumber}`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Could not regenerate the contract")),
  });
}

export function useDeleteContract(jobId: string) {
  const invalidate = useInvalidate(jobId);
  return useMutation({
    mutationFn: (id: string) => fetchJson<{ ok: true }>(`/api/customer-contracts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Draft deleted");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Could not delete the draft")),
  });
}

export function useVoidContract(jobId: string) {
  const invalidate = useInvalidate(jobId);
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => fetchJson<{ ok: true; reversedMoney: boolean }>(`/api/customer-contracts/${id}/void`, json({ reason })),
    onSuccess: (r) => {
      toast.success(r.reversedMoney ? "Contract voided and the job's contract amount reversed" : "Contract voided");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Could not void the contract")),
  });
}

export type SendResult = { ok: true; emailed: boolean; signUrl: string; sentTo: string };

export function useSendContract(jobId: string) {
  const invalidate = useInvalidate(jobId);
  return useMutation({
    mutationFn: ({ id, resend, ...body }: { id: string; resend?: boolean; to?: string; message?: string | null }) =>
      fetchJson<SendResult>(`/api/customer-contracts/${id}/${resend ? "resend" : "send"}`, json(body)),
    onSuccess: (r, vars) => {
      if (r.emailed) toast.success(`${vars.resend ? "Resent" : "Sent"} to ${r.sentTo}`);
      else toast.warning("Marked sent — email is not configured. Copy the signing link and share it.", { duration: 8000 });
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Could not send the contract")),
  });
}
