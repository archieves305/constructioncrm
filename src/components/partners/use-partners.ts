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
  health: HealthPill | null;
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
  bidFacts: { openBidCount: number; bidCount: number; awardedCount: number; lastBidActivityAt: string | null };
  health: Health | null;
  jobCount: number;
  projects: { id: string; jobNumber: string; title: string; contractAmount: number; billingMethod: string; createdAt: string; leadId: string; currentStage: { name: string; isClosed: boolean } | null }[];
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
  ourTradeIds: string[];
  homeCounties: string[];
  adjacentCounties: string[];
  typicalRange: Record<string, { min: number; max: number }> | null;
  bondingCapacity: string | number | null;
  scoreWeightsVersion: number;
  scoreWeights: unknown;
  healthWeights: unknown;
  healthWeightsVersion: number;
  preferredMinAwards: number;
  preferredMinMargin: string | number;
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

// ── Bids (Stage 3) ────────────────────────────────────────────────────────

export type BidStatus = "TRACKING" | "INVITED" | "DECIDING" | "ESTIMATING" | "SUBMITTED" | "SHORTLISTED" | "CLOSED";
export type BidOutcome = "AWARDED" | "LOST" | "NO_BID" | "CANCELLED" | "NO_DECISION" | "REBID";
export type BidDecision = "UNDECIDED" | "BID" | "NO_BID";
export type BidPlatform = "BUILDINGCONNECTED" | "PROCORE" | "PLANHUB" | "SMARTBID" | "CONSTRUCTCONNECT" | "TEXTURA" | "EMAIL" | "OTHER";
export type LossReason = "PRICE" | "RELATIONSHIP" | "SCHEDULE" | "SCOPE" | "QUALIFICATION" | "BONDING" | "CAPACITY" | "COMPETITOR" | "UNKNOWN" | "OTHER";
export type SubmissionKind = "ORIGINAL" | "REVISED" | "ALTERNATE" | "VALUE_ENGINEERING";
export type SubmissionMethod = "PLATFORM" | "EMAIL" | "PORTAL" | "HAND" | "OTHER";
export type SliderKey = "margin" | "capacity" | "competition" | "complexity" | "plansAndTerms";
export type Sliders = Record<SliderKey, number | null>;

export type BidOptions = {
  bidPlatforms: Option<BidPlatform>[];
  bidStatuses: Option<BidStatus>[];
  bidOutcomes: Option<BidOutcome>[];
  lossReasons: Option<LossReason>[];
  submissionKinds: Option<SubmissionKind>[];
  submissionMethods: Option<SubmissionMethod>[];
  ourTradeIds: string[];
};

export type BidSubmission = {
  id: string;
  version: number;
  kind: SubmissionKind;
  amount: number;
  estimateId: string | null;
  roofEstimateId: string | null;
  snapshotTotalPrice: number | null;
  snapshotSubtotalCost: number | null;
  submittedAt: string;
  method: SubmissionMethod;
  alternates: string | null;
  clarifications: string | null;
  exclusions: string | null;
  fileId: string | null;
  createdAt: string;
  submittedBy: Person;
  recipientContact: Person | null;
};

export type Factor = { points: number; max: number; note: string; mode: "AUTO" | "MANUAL" | "GATE" };
export type ScoreResult = { score: number; recommendation: "BID" | "REVIEW" | "NO_BID"; reasons: string[]; concerns: string[]; gates: string[]; breakdown: Record<string, Factor>; weightsVersion: number };

export type Bid = {
  id: string;
  leadId: string;
  organizationId: string;
  contactId: string | null;
  number: string;
  projectName: string;
  projectType: string | null;
  scopeSummary: string | null;
  invitedAt: string | null;
  bidDueAt: string | null;
  siteWalkAt: string | null;
  preBidMeetingAt: string | null;
  rfiDueAt: string | null;
  addendaDeadlineAt: string | null;
  interviewAt: string | null;
  expectedAwardAt: string | null;
  addendaCount: number;
  specsReceived: boolean;
  estimatorUserId: string | null;
  siteVisitRequired: boolean;
  bondRequired: boolean;
  prevailingWage: boolean;
  unionRequired: boolean;
  insuranceNotes: string | null;
  scheduleNotes: string | null;
  platform: BidPlatform;
  platformUrl: string | null;
  platformRef: string | null;
  status: BidStatus;
  statusLabel: string;
  waitingOn: string | null;
  decision: BidDecision;
  decisionScore: number | null;
  decisionFactors: (Omit<ScoreResult, "score"> & { inputs: Record<string, unknown> }) | null;
  decisionReason: string | null;
  decidedAt: string | null;
  submittedAt: string | null;
  estimatingHours: number | null;
  outcome: BidOutcome | null;
  lossReason: LossReason | null;
  winningContractor: string | null;
  winningPrice: number | null;
  outcomeNotes: string | null;
  outcomeAt: string | null;
  awardedAmount: number | null;
  contractReceivedAt: string | null;
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
  estimator: Person | null;
  decidedBy: Person | null;
  createdBy: Person;
  contact: { id: string; firstName: string; lastName: string; title: string | null; email: string | null; phone: string | null; mobile: string | null } | null;
  organization: { id: string; name: string; stage: PartnerStage; owner: Person | null };
  lead: {
    id: string;
    fullName: string;
    companyName: string | null;
    propertyAddress1: string;
    propertyAddress2: string | null;
    city: string;
    state: string;
    zipCode: string;
    county: string | null;
    estimatedJobValue: number | null;
    currentStage: { id: string; name: string; isWon: boolean; isLost: boolean };
    trades: { id: string; name: string }[];
    jobs: { id: string; jobNumber: string; title: string; contractAmount: number; billingMethod: string; currentStage: { name: string } | null }[];
    _count: { estimates: number; roofEstimates: number; planSets: number; files: number };
  };
  submissions: BidSubmission[];
  latestAmount: number | null;
};

export type BidDetail = Bid & { permissions: { canManage: boolean; canAdmin: boolean; canDecide: boolean } };

export const BID_STATUS_TONE: Record<BidStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  TRACKING: "neutral",
  INVITED: "info",
  DECIDING: "warning",
  ESTIMATING: "info",
  SUBMITTED: "info",
  SHORTLISTED: "success",
  CLOSED: "neutral",
};

export function useBids(params: URLSearchParams, enabled = true) {
  const key = params.toString();
  return useQuery<{ rows: Bid[]; total: number; canManage: boolean; canDecide: boolean }>({ queryKey: ["partners", "bids", key], queryFn: () => fetchJson(`/api/bids?${key}`), retry: retryServerErrors, enabled });
}

export function useBid(id: string | null | undefined) {
  return useQuery<BidDetail>({ queryKey: ["partners", "bid", id], queryFn: () => fetchJson(`/api/bids/${id}`), retry: retryServerErrors, enabled: Boolean(id) });
}

export function useBidOptions(enabled = true) {
  return useQuery<PartnerOptions & BidOptions>({ queryKey: ["partners", "options"], queryFn: () => fetchJson("/api/partners/options"), retry: retryServerErrors, staleTime: 60_000, enabled });
}

/** Every bid write also moves the lead (stage, value), the jobs list (an award) and the attention rows. */
export function useInvalidateBids() {
  const qc = useQueryClient();
  const invalidate = useInvalidatePartners();
  return () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ["lead"] });
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["calendar"] });
  };
}

export function useBidAction<T = BidDetail>(bidId: string, path: string, success: string | ((r: T) => string)) {
  const invalidate = useInvalidateBids();
  return useMutation({
    mutationFn: (body: unknown) => fetchJson<T>(`/api/bids/${bidId}${path}`, json(body, "POST")),
    onSuccess: (r) => {
      invalidate();
      toast.success(typeof success === "function" ? success(r) : success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ── Health, scorecard, analytics (Stage 4) ────────────────────────────────

export type HealthBand = "STRONG" | "ACTIVE" | "DEVELOPING" | "COLD" | "DORMANT";
export type HealthPill = { score: number; band: HealthBand; strength: string | null; weakness: string | null };
export type HealthFactor = { key: string; label: string; points: number; max: number; note: string };
export type Health = {
  score: number;
  band: HealthBand;
  capped: boolean;
  breakdown: Record<"engagement" | "qualification" | "bidFlow" | "economics", { points: number; max: number; factors: HealthFactor[] }>;
  strengths: string[];
  weaknesses: string[];
  recommendedAction: string;
  weightsVersion: number;
};

export type ReportWindow = { preset: string; from: string; to: string; label: string };
export type BidKpis = { invitations: number; decided: number; bid: number; noBid: number; bidRate: number | null; submitted: number; awarded: number; lost: number; winRate: number | null; open: number; openValue: number; awardedValue: number; avgTurnaroundDays: number | null; estimatingHours: number; lossReasons: Record<string, number> };
export type MoneyKpis = { billed: number; collected: number; contractValue: number; grossProfit: number | null; margin: number | null; averageContract: number | null; daysToPay: number | null; linkedPayments: number; unlinkedPayments: number; retainageHeld: number; changeOrderApprovalRate: number | null; changeOrdersDecided: number; jobs: number; repeatWork: boolean };
export type Scorecard = {
  window: ReportWindow;
  bids: BidKpis & { priceGap: number | null; perAwardHour: number | null; perBidHour: number | null };
  money: MoneyKpis;
  activity: { interactions: number; meetings: number; outbound: number; responses: number };
  health: Health | null;
};
export type BdPeriod = { key: string; label: string; newOrgs: number; contactsAdded: number; outreach: number; responses: number; meetings: number; qualsStarted: number; qualsSubmitted: number; qualsApproved: number; invitations: number; submitted: number; awards: number; awardedRevenue: number; awardedGp: number | null };
export type Analytics = {
  window: ReportWindow;
  groupBy: "org" | "trade" | "market" | "owner";
  period: "week" | "month" | "quarter" | "year";
  totals: BidKpis & MoneyKpis & { priceGap: number | null };
  groups: { key: string; label: string; kpis: BidKpis & MoneyKpis }[];
  pipeline: { byStage: { stage: PartnerStage; label: string; count: number }[] };
  bdKpis: BdPeriod[];
};

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = { STRONG: "Strong", ACTIVE: "Active", DEVELOPING: "Developing", COLD: "Cold", DORMANT: "Dormant" };
export const HEALTH_BAND_TONE: Record<HealthBand, "success" | "info" | "warning" | "neutral" | "danger"> = { STRONG: "success", ACTIVE: "info", DEVELOPING: "warning", COLD: "neutral", DORMANT: "danger" };

export function useScorecard(organizationId: string, qs: string, enabled = true) {
  return useQuery<Scorecard>({ queryKey: ["partners", "scorecard", organizationId, qs], queryFn: () => fetchJson(`/api/partners/${organizationId}/scorecard?${qs}`), retry: retryServerErrors, enabled });
}

export function useAnalytics(qs: string) {
  return useQuery<Analytics>({ queryKey: ["partners", "analytics", qs], queryFn: () => fetchJson(`/api/partners/analytics?${qs}`), retry: retryServerErrors });
}

export function useBdSummary(enabled: boolean) {
  return useQuery<{ openBids: number; openBidValue: number; bidsDueThisWeek: number; overdueFollowUps: number }>({ queryKey: ["partners", "summary"], queryFn: () => fetchJson("/api/partners/summary"), retry: retryServerErrors, enabled });
}

export function useActionTask(organizationId: string) {
  const invalidate = useInvalidatePartners();
  return useMutation({
    mutationFn: (title: string) => fetchJson<{ id: string; title: string }>(`/api/partners/${organizationId}/action-task`, json({ title }, "POST")),
    onSuccess: (t) => {
      invalidate();
      toast.success(`Task created: ${t.title}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Bid intake (Phase 5) ───────────────────────────────────────────────────

export type IntakeStatusFilter = "NEW" | "DONE" | "DISMISSED";
export type ParsedDate = { at: string; dateOnly: boolean; text: string };
export type ParsedItb = {
  kind: "INVITATION" | "ADDENDUM" | "UPDATE";
  platform: BidPlatform;
  platformUrl: string | null;
  platformRef: string | null;
  projectName: string | null;
  gcName: string | null;
  bidDue: ParsedDate | null;
  siteWalk: ParsedDate | null;
  preBidMeeting: ParsedDate | null;
  rfiDue: ParsedDate | null;
  address: { address1: string | null; city: string | null; state: string | null; zipCode: string | null; text: string } | null;
  scope: string | null;
  originalFrom: { name: string | null; email: string | null };
  originalSubject: string;
  contactEmail: string | null;
  contactName: string | null;
  contactPhone: string | null;
  found: string[];
};
export type IntakeItem = {
  id: string;
  channel: "manual" | "mailersend" | "outlook";
  receivedAt: string;
  forwardedBy: string | null;
  subject: string;
  platform: BidPlatform;
  parsed: ParsedItb;
  organizationId: string | null;
  contactId: string | null;
  matchedBy: string | null;
  status: "NEW" | "CREATED" | "ATTACHED" | "DISMISSED";
  dismissReason: string | null;
  resolvedAt: string | null;
  organization: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string; email: string | null } | null;
  bidInvitation: { id: string; number: string; leadId: string; projectName: string } | null;
  resolvedBy: Person | null;
  existingBid: { id: string; number: string; leadId: string; projectName: string; status: BidStatus; bidDueAt: string | null; addendaCount: number } | null;
  suggestedTradeIds: string[];
};
export type IntakeList = { rows: IntakeItem[]; counts: Record<IntakeStatusFilter, number>; channels: { mailersend: boolean; outlook: boolean } };

export function useIntakes(status: IntakeStatusFilter, enabled = true) {
  return useQuery<IntakeList>({ queryKey: ["partners", "intake", status], queryFn: () => fetchJson(`/api/partners/intake?status=${status}`), retry: retryServerErrors, enabled });
}

export function useIntakeEmail(id: string | null) {
  return useQuery<IntakeItem & { body: string }>({ queryKey: ["partners", "intake", "item", id], queryFn: () => fetchJson(`/api/partners/intake/${id}`), retry: retryServerErrors, enabled: Boolean(id) });
}

export function useIntakeAction<T = unknown>(path: (id: string) => string, success: string | ((r: T) => string), method = "POST") {
  const invalidate = useInvalidateBids();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => fetchJson<T>(path(id), json(body, method)),
    onSuccess: (r) => {
      invalidate();
      toast.success(typeof success === "function" ? success(r) : success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
