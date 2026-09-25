"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, HttpError, retryServerErrors } from "@/lib/fetch-json";
import type { ContractTemplateContent } from "@/lib/customer-contracts/types";

export type TemplateVersionSummary = {
  id: string;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED" | "ARCHIVED";
  publishedAt: string | null;
  updatedAt: string;
  _count: { contracts: number };
};

export type AdminTemplateRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  versions: TemplateVersionSummary[];
};

export type TemplateVersionDetail = {
  id: string;
  templateId: string;
  version: number;
  status: TemplateVersionSummary["status"];
  title: string;
  articles: ContractTemplateContent["articles"];
  paymentSchedule: ContractTemplateContent["paymentSchedule"];
  paymentScheduleText: string;
  consentText: string;
  changeNotes: string | null;
  contentHash: string;
  publishedAt: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  publishedBy: { id: string; firstName: string; lastName: string } | null;
  _count: { contracts: number };
};

export type AdminTemplateDetail = Omit<AdminTemplateRow, "versions"> & { versions: TemplateVersionDetail[] };

export const contractTemplateKeys = {
  all: ["admin-contract-templates"] as const,
  one: (id: string) => ["admin-contract-template", id] as const,
  mergeFields: ["contract-merge-fields"] as const,
};

function msg(e: unknown, fallback: string): string {
  if (e instanceof HttpError) {
    const body = e.body as { error?: string; details?: string[] } | undefined;
    if (body?.error) return body.details?.length ? `${body.error}: ${body.details.join("; ")}` : body.error;
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function useContractTemplates() {
  return useQuery<AdminTemplateRow[]>({ queryKey: contractTemplateKeys.all, queryFn: () => fetchJson("/api/admin/contract-templates"), retry: retryServerErrors });
}

export function useContractTemplate(id: string) {
  return useQuery<AdminTemplateDetail>({ queryKey: contractTemplateKeys.one(id), queryFn: () => fetchJson(`/api/admin/contract-templates/${id}`), retry: retryServerErrors });
}

export function useMergeFields() {
  return useQuery<{ key: string; description: string }[]>({ queryKey: contractTemplateKeys.mergeFields, queryFn: () => fetchJson("/api/admin/contract-templates/merge-fields"), retry: retryServerErrors, staleTime: Infinity });
}

function useInvalidateTemplates(id?: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: contractTemplateKeys.all });
    if (id) qc.invalidateQueries({ queryKey: contractTemplateKeys.one(id) });
    qc.invalidateQueries({ queryKey: ["contract-templates", "published"] });
  };
}

export function useCreateContractTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (body: { key: string; name: string; description?: string | null }) => fetchJson<AdminTemplateRow>("/api/admin/contract-templates", json("POST", body)),
    onSuccess: () => {
      toast.success("Template created");
      invalidate();
    },
    onError: (e) => toast.error(msg(e, "Could not create the template")),
  });
}

export function useUpdateContractTemplate(id: string) {
  const invalidate = useInvalidateTemplates(id);
  return useMutation({
    mutationFn: (body: { name?: string; description?: string | null; isActive?: boolean; isDefault?: true }) => fetchJson<AdminTemplateDetail>(`/api/admin/contract-templates/${id}`, json("PATCH", body)),
    onSuccess: (_r, vars) => {
      toast.success(vars.isDefault ? "Now the default template" : "Template updated");
      invalidate();
    },
    onError: (e) => toast.error(msg(e, "Could not update the template")),
  });
}

export function useCreateDraftVersion(templateId: string) {
  const invalidate = useInvalidateTemplates(templateId);
  return useMutation({
    mutationFn: (body: { fromVersionId?: string | null }) => fetchJson<TemplateVersionDetail>(`/api/admin/contract-templates/${templateId}/versions`, json("POST", body)),
    onSuccess: (v) => {
      toast.success(`Draft v${v.version} created`);
      invalidate();
    },
    onError: (e) => toast.error(msg(e, "Could not create a draft")),
  });
}

export function useSaveDraftVersion(templateId: string) {
  const invalidate = useInvalidateTemplates(templateId);
  return useMutation({
    mutationFn: ({ versionId, content }: { versionId: string; content: ContractTemplateContent }) =>
      fetchJson<TemplateVersionDetail & { problems: string[] }>(`/api/admin/contract-template-versions/${versionId}`, json("PUT", content)),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(msg(e, "Could not save the draft")),
  });
}

export function usePublishVersion(templateId: string) {
  const invalidate = useInvalidateTemplates(templateId);
  return useMutation({
    mutationFn: ({ versionId, changeNotes }: { versionId: string; changeNotes?: string | null }) =>
      fetchJson<TemplateVersionDetail>(`/api/admin/contract-template-versions/${versionId}/publish`, json("POST", { changeNotes })),
    onSuccess: (v) => {
      toast.success(`v${v.version} published — new contracts use it`);
      invalidate();
    },
    onError: (e) => toast.error(msg(e, "Could not publish")),
  });
}

export function useArchiveVersion(templateId: string) {
  const invalidate = useInvalidateTemplates(templateId);
  return useMutation({
    mutationFn: (versionId: string) => fetchJson<TemplateVersionDetail>(`/api/admin/contract-template-versions/${versionId}/archive`, { method: "POST" }),
    onSuccess: (v) => {
      toast.success(`v${v.version} archived`);
      invalidate();
    },
    onError: (e) => toast.error(msg(e, "Could not archive")),
  });
}

/** Open a sample PDF of the given content (or the stored version when null) in a new tab. */
export async function openTemplatePreview(versionId: string, content: ContractTemplateContent | null): Promise<void> {
  const res = await fetch(`/api/admin/contract-template-versions/${versionId}/preview`, content ? json("POST", content) : { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || "Preview failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
