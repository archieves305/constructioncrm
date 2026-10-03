"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import type { JobLabelInput } from "@/lib/labels/job";
import type { Compliance, ComplianceVerdict, VendorDocType } from "@/lib/vendors/compliance";

export type VendorKind = "SUBCONTRACTOR" | "SUPPLIER" | "OTHER";

export const KIND_LABEL: Record<VendorKind, string> = {
  SUBCONTRACTOR: "Subcontractor",
  SUPPLIER: "Supplier",
  OTHER: "Other",
};

export type VendorRow = {
  id: string;
  name: string;
  kind: VendorKind;
  trade: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  aliasCount: number;
  crewCount: number;
  approvedSpend: number;
  expenseCount: number;
  jobCount: number;
  compliance: { verdict: ComplianceVerdict; gaps: string[] };
};

export type VendorDocument = {
  id: string;
  type: VendorDocType;
  carrier: string | null;
  policyNumber: string | null;
  effectiveDate: string | null;
  expiresAt: string | null;
  fileName: string | null;
  fileSize: number | null;
  notes: string | null;
  createdAt: string;
  uploadedBy: { firstName: string; lastName: string };
};

export type VendorSettings = {
  complianceOwner: { id: string; firstName: string; lastName: string; isActive: boolean } | null;
  effectiveOwner: { id: string; firstName: string; lastName: string } | null;
  canEdit: boolean;
};

export type VendorOption = { id: string; name: string; kind: VendorKind; trade: string | null };

export type PayeeGroup = { key: string; text: string; count: number; total: number; jobs: number };

export type Unmatched = {
  payees: PayeeGroup[];
  crews: { id: string; name: string; trades: string[]; phone: string | null; email: string | null; contracts: number }[];
  contractLabels: PayeeGroup[];
};

/** What a vendor is being connected to from the Unmatched tab. */
export type VendorLink = { payee?: string; crewId?: string; contractLabel?: string };

type JobRow = JobLabelInput & { id: string };

export type VendorDetail = {
  vendor: {
    id: string;
    name: string;
    kind: VendorKind;
    trade: string | null;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    isActive: boolean;
    aliases: { id: string; pattern: string }[];
    crews: { id: string; name: string; isActive: boolean; trades: string[] }[];
  };
  canManage: boolean;
  documents: VendorDocument[];
  compliance: Compliance;
  /** This vendor's commitments across jobs, open ones first. */
  commitments: { id: string; number: number; description: string; amount: number; received: number; open: number; status: "OPEN" | "CLOSED" | "CANCELLED"; job: JobRow }[];
  approvedSpend: number;
  spendByJob: { job: JobRow; total: number; count: number }[];
  laborContracts: { id: string; name: string; job: JobRow; amount: number; paid: number }[];
  recentExpenses: {
    id: string;
    vendor: string | null;
    description: string | null;
    amount: number;
    incurredDate: string;
    type: string;
    status: string;
    fed: boolean;
    job: JobRow;
  }[];
};

export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function useVendorOptions(enabled = true) {
  return useQuery<VendorOption[]>({
    queryKey: ["vendors", "options"],
    queryFn: () => fetchJson("/api/vendors/options"),
    retry: retryServerErrors,
    staleTime: 60_000,
    enabled,
  });
}

export function useUnmatched(enabled = true) {
  return useQuery<Unmatched>({
    queryKey: ["vendors", "unmatched"],
    queryFn: () => fetchJson("/api/vendors/unmatched"),
    retry: retryServerErrors,
    enabled,
  });
}

export function useVendorSettings(enabled = true) {
  return useQuery<VendorSettings>({
    queryKey: ["vendors", "settings"],
    queryFn: () => fetchJson("/api/vendors/settings"),
    retry: retryServerErrors,
    enabled,
  });
}
