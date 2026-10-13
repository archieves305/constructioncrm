"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import type { OrgBadge } from "@/lib/partners/derive";

/** Wire shapes of the Business Development routes, and the hooks the pages share. */

export type PartnerStage = "TARGET" | "CONTACTED" | "ENGAGED" | "ACTIVE" | "DORMANT" | "DO_NOT_PURSUE";
export type OrganizationKind = "GENERAL_CONTRACTOR" | "DEVELOPER" | "PROPERTY_MANAGER" | "ARCHITECT" | "ENGINEER" | "MUNICIPALITY" | "REFERRAL_PARTNER" | "OTHER";
export type Priority = "A" | "B" | "C";
export type ContactRole = "ESTIMATOR" | "SENIOR_ESTIMATOR" | "PRECON_MANAGER" | "PRECON_DIRECTOR" | "PROCUREMENT" | "TRADE_PARTNER_MANAGER" | "BUSINESS_DEVELOPMENT" | "PROJECT_EXECUTIVE" | "PROJECT_MANAGER" | "SUPERINTENDENT" | "ACCOUNTS_PAYABLE" | "SAFETY" | "OTHER";
export type InteractionKind = "CALL" | "EMAIL" | "MEETING" | "SITE_VISIT" | "LUNCH" | "LINKEDIN" | "INTRO" | "PREQUAL_SUBMISSION" | "BID_DISCUSSION" | "DOC_SENT" | "NOTE" | "OTHER";
export type InteractionDirection = "OUTBOUND" | "INBOUND";
export type InteractionOutcome = "NO_ANSWER" | "LEFT_MESSAGE" | "SENT" | "SPOKE" | "REPLIED" | "MEETING_HELD" | "NOT_APPLICABLE";

export type Person = { id: string; firstName: string; lastName: string };
export type Option<T extends string = string> = { value: T; label: string; hint?: string; isClosed?: boolean };

export type QualificationStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "INFO_REQUESTED" | "APPROVED" | "REJECTED";
export type DerivedQualStatus = QualificationStatus | "EXPIRED" | "RENEWAL_DUE";
export type RequirementStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "WAIVED";
export type RequirementState = "missing" | "provided" | "expired" | "accepted" | "rejected" | "waived";
export type Confidentiality = "INTERNAL" | "RESTRICTED" | "SHAREABLE";

export type DocumentTypeOption = Option & { id: string; category: string; defaultValidityMonths: number | null };

export type PartnerOptions = {
  documentTypes: DocumentTypeOption[];
  qualificationStatuses: Option<QualificationStatus>[];
  requirementStatuses: Option<RequirementStatus>[];
  confidentialities: Option<Confidentiality>[];
  defaultRequirementTypeKeys: string[];
  stages: Option<PartnerStage>[];
  kinds: Option<OrganizationKind>[];
  priorities: Option<Priority>[];
  contactRoles: Option<ContactRole>[];
  interactionKinds: Option<InteractionKind>[];
  outcomes: Option<InteractionOutcome>[];
  markets: string[];
  trades: Option[];
  owners: Option[];
};

export type OrgRow = {
  id: string;
  name: string;
  kind: OrganizationKind;
  stage: PartnerStage;
  priority: Priority | null;
  markets: string[];
  city: string | null;
  isActive: boolean;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  owner: Person | null;
  trades: { id: string; name: string }[];
  primaryContact: { id: string; name: string; title: string | null; phone: string | null; email: string | null } | null;
  contactCount: number;
  interactionCount: number;
  nextOpenTask: { id: string; title: string; dueAt: string | null } | null;
  badges: OrgBadge[];
};

export type OrgList = { rows: OrgRow[]; total: number; canManage: boolean; canAdmin: boolean };

export type Contact = {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  title: string | null;
  roleTag: ContactRole;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  linkedinUrl: string | null;
  office: string | null;
  geography: string | null;
  trades: string[];
  relationshipStrength: number | null;
  influence: number | null;
  isPrimary: boolean;
  isActive: boolean;
  lastContactAt: string | null;
  notes: string | null;
};

export type ContactRow = Contact & { organization: { id: string; name: string; stage: PartnerStage; owner: Person | null } };

export type Interaction = {
  id: string;
  organizationId: string;
  contactId: string | null;
  leadId: string | null;
  kind: InteractionKind;
  direction: InteractionDirection;
  outcome: InteractionOutcome;
  occurredAt: string;
  summary: string;
  createdAt: string;
  user: Person;
  contact: { id: string; firstName: string; lastName: string; title: string | null } | null;
  lead: { id: string; fullName: string; companyName: string | null; propertyAddress1: string; city: string } | null;
};

export type OpenTask = { id: string; title: string; dueAt: string | null; priority: string; status: string; sourceKey: string | null; assignedTo: Person | null };

export type OrgDetail = {
  organization: {
    id: string;
    name: string;
    kind: OrganizationKind;
    website: string | null;
    phone: string | null;
    email: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    localOffices: string | null;
    markets: string[];
    notes: string | null;
    isActive: boolean;
    ownerUserId: string | null;
    priority: Priority | null;
    stage: PartnerStage;
    stageChangedAt: string;
    lastContactAt: string | null;
    nextFollowUpAt: string | null;
    potentialAnnualRevenue: number | null;
    paymentTermsDays: number | null;
    annualVolume: string | null;
    companySize: string | null;
    projectTypes: string[];
    typicalProjectSize: string | null;
    biddingPlatform: string | null;
    prequalPlatform: string | null;
    vendorRegistrationUrl: string | null;
    requirementsNotes: string | null;
    vendorId: string | null;
    createdAt: string;
    updatedAt: string;
    owner: Person | null;
    createdBy: Person;
    vendor: { id: string; name: string } | null;
    trades: { id: string; name: string }[];
    contacts: Contact[];
    stageHistory: { id: string; fromStage: PartnerStage | null; toStage: PartnerStage; reason: string | null; changedAt: string; changedBy: Person }[];
  };
  interactionCount: number;
  leadCount: number;
  openTasks: OpenTask[];
  badges: OrgBadge[];
  permissions: { canManage: boolean; canAdmin: boolean };
};

export type DocumentView = {
  id: string;
  documentTypeId: string;
  title: string;
  version: number;
  effectiveDate: string | null;
  expiresAt: string | null;
  confidentiality: Confidentiality;
  approvedForExternal: boolean;
  supersedesId: string | null;
  notes: string | null;
  fileName: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
  uploadedBy: Person;
  documentType: { id: string; key: string; name: string; category: string };
  encrypted: boolean;
  locked: boolean;
  missing: boolean;
  current: boolean;
  daysLeft: number | null;
  usedByCount: number;
};

export type VaultType = { id: string; key: string; name: string; category: string; defaultValidityMonths: number | null; isActive: boolean; sortOrder: number; current: DocumentView | null; versions: DocumentView[] };
export type Vault = { types: VaultType[]; canUpload: boolean; canClassify: boolean; canReadRestricted: boolean };

export type Requirement = {
  id: string;
  qualificationId: string;
  documentTypeId: string;
  required: boolean;
  status: RequirementStatus;
  companyDocumentId: string | null;
  providedAt: string | null;
  notes: string | null;
  sortOrder: number;
  documentType: { id: string; key: string; name: string; category: string };
  companyDocument: { id: string; title: string; version: number; expiresAt: string | null; confidentiality: Confidentiality; fileName: string; locked: boolean } | null;
  state: RequirementState;
};

export type Qualification = {
  id: string;
  organizationId: string;
  platform: string | null;
  portalUrl: string | null;
  portalUsernameHint: string | null;
  ownerUserId: string | null;
  status: QualificationStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  renewalDueAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  owner: Person | null;
  createdBy: Person;
  organization: { id: string; name: string; stage: PartnerStage; owner: Person | null };
  requirements: Requirement[];
  derivedStatus: DerivedQualStatus;
  coverage: { required: number; satisfied: number; missing: number; optionalSatisfied: number; optionalTotal: number };
};

export type PartnerSettings = {
  vaultOwnerUserId: string | null;
  vaultOwner: (Person & { isActive: boolean }) | null;
  defaultRequirementTypeKeys: string[];
  newTargetDays: number;
  noResponseDays: number;
  qualSubmittedDays: number;
  prequalNoBidDays: number;
  activeQuietDays: number;
  dormantAfterDays: number;
  defaultOwnerUserId: string | null;
  markets: string[];
  defaultOwner: (Person & { isActive: boolean }) | null;
  updatedAt?: string;
  canEdit: boolean;
};

export const KIND_LABEL: Record<OrganizationKind, string> = {
  GENERAL_CONTRACTOR: "General contractor",
  DEVELOPER: "Developer",
  PROPERTY_MANAGER: "Property manager",
  ARCHITECT: "Architect",
  ENGINEER: "Engineer",
  MUNICIPALITY: "Municipality",
  REFERRAL_PARTNER: "Referral partner",
  OTHER: "Other",
};

export const personName = (p: Person | null | undefined) => (p ? `${p.firstName} ${p.lastName}` : null);

const json = (body: unknown, method: string): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function usePartnerOptions(enabled = true) {
  return useQuery<PartnerOptions>({ queryKey: ["partners", "options"], queryFn: () => fetchJson("/api/partners/options"), retry: retryServerErrors, staleTime: 60_000, enabled });
}

export function useOrganizations(params: URLSearchParams, enabled = true) {
  const key = params.toString();
  return useQuery<OrgList>({ queryKey: ["partners", "list", key], queryFn: () => fetchJson(`/api/partners?${key}`), retry: retryServerErrors, enabled });
}

export function useOrganization(id: string) {
  return useQuery<OrgDetail>({ queryKey: ["partners", "detail", id], queryFn: () => fetchJson(`/api/partners/${id}`), retry: retryServerErrors });
}

export function useInteractions(organizationId: string, kind?: InteractionKind | null) {
  const qs = new URLSearchParams({ pageSize: "200" });
  if (kind) qs.set("kind", kind);
  return useQuery<{ rows: Interaction[]; total: number }>({ queryKey: ["partners", "interactions", organizationId, kind ?? "all"], queryFn: () => fetchJson(`/api/partners/${organizationId}/interactions?${qs}`), retry: retryServerErrors });
}

export function useContactsAcross(params: URLSearchParams) {
  const key = params.toString();
  return useQuery<{ rows: ContactRow[]; total: number; canManage: boolean }>({ queryKey: ["partners", "contacts", key], queryFn: () => fetchJson(`/api/partners/contacts?${key}`), retry: retryServerErrors });
}

export function useVault(enabled = true) {
  return useQuery<Vault>({ queryKey: ["partners", "vault"], queryFn: () => fetchJson("/api/company-documents"), retry: retryServerErrors, enabled });
}

export function useQualifications(organizationId: string, enabled = true) {
  return useQuery<{ qualifications: Qualification[]; canManage: boolean }>({ queryKey: ["partners", "qualifications", organizationId], queryFn: () => fetchJson(`/api/partners/${organizationId}/qualifications`), retry: retryServerErrors, enabled });
}

export function useQualificationsAcross(params: URLSearchParams) {
  const key = params.toString();
  return useQuery<{ rows: Qualification[]; canManage: boolean }>({ queryKey: ["partners", "qualifications-all", key], queryFn: () => fetchJson(`/api/qualifications?${key}`), retry: retryServerErrors });
}

export function usePartnerSettings(enabled = true) {
  return useQuery<PartnerSettings>({ queryKey: ["partners", "settings"], queryFn: () => fetchJson("/api/partners/settings"), retry: retryServerErrors, enabled });
}

/** Invalidate everything Business Development reads, plus the task lists an interaction may have added to. */
export function useInvalidatePartners() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["partners"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["attention"] });
  };
}

export function useChangeStage(organizationId: string) {
  const invalidate = useInvalidatePartners();
  return useMutation({
    mutationFn: (input: { stage: PartnerStage; reason?: string | null }) => fetchJson<OrgDetail>(`/api/partners/${organizationId}/stage`, json(input, "POST")),
    onSuccess: () => {
      invalidate();
      toast.success("Stage updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useChangeOwner(organizationId: string) {
  const invalidate = useInvalidatePartners();
  return useMutation({
    mutationFn: (ownerUserId: string | null) => fetchJson<OrgDetail>(`/api/partners/${organizationId}/owner`, json({ ownerUserId }, "POST")),
    onSuccess: () => {
      invalidate();
      toast.success("Owner updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
