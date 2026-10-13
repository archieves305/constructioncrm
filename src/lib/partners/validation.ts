import { z } from "zod";
import { bidWeightsSchema } from "./bid-score";
import { healthWeightsSchema } from "./health";
import { NextResponse } from "next/server";
import { PartnerError } from "./errors";
import { PARTNER_STAGE_KEYS, stageNeedsReason } from "./stages";

/**
 * Request bodies for the Business Development routes. Optional fields on a
 * patch are `.nullish()` where the form may send null (the 2026-10-04
 * lesson: an empty number input arrives as null and must not 400).
 */

export const ORGANIZATION_KINDS = ["GENERAL_CONTRACTOR", "DEVELOPER", "PROPERTY_MANAGER", "ARCHITECT", "ENGINEER", "MUNICIPALITY", "REFERRAL_PARTNER", "OTHER"] as const;
export const ORGANIZATION_PRIORITIES = ["A", "B", "C"] as const;
export const CONTACT_ROLES = ["ESTIMATOR", "SENIOR_ESTIMATOR", "PRECON_MANAGER", "PRECON_DIRECTOR", "PROCUREMENT", "TRADE_PARTNER_MANAGER", "BUSINESS_DEVELOPMENT", "PROJECT_EXECUTIVE", "PROJECT_MANAGER", "SUPERINTENDENT", "ACCOUNTS_PAYABLE", "SAFETY", "OTHER"] as const;
export const INTERACTION_KINDS = ["CALL", "EMAIL", "MEETING", "SITE_VISIT", "LUNCH", "LINKEDIN", "INTRO", "PREQUAL_SUBMISSION", "BID_DISCUSSION", "DOC_SENT", "NOTE", "OTHER"] as const;
export const INTERACTION_DIRECTIONS = ["OUTBOUND", "INBOUND"] as const;
export const INTERACTION_OUTCOMES = ["NO_ANSWER", "LEFT_MESSAGE", "SENT", "SPOKE", "REPLIED", "MEETING_HELD", "NOT_APPLICABLE"] as const;

const text = (max: number) => z.string().trim().max(max).nullish();
const id = z.string().min(1).max(60);
const email = z.union([z.string().trim().email("That email does not look right").max(200), z.literal(""), z.null()]).optional();
const url = z.union([z.string().trim().max(300), z.literal(""), z.null()]).optional();
const strings = z.array(z.string().trim().min(1).max(80)).max(50);
const money = z.number().min(0).max(1_000_000_000).nullish();
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-MM-dd");

export const organizationFields = {
  name: z.string().trim().min(2, "Give the account a name").max(120),
  kind: z.enum(ORGANIZATION_KINDS),
  website: url,
  phone: text(40),
  email,
  address1: text(200),
  address2: text(200),
  city: text(120),
  state: text(2),
  zipCode: text(12),
  localOffices: text(1000),
  markets: strings.optional(),
  notes: text(5000),
  ownerUserId: id.nullish(),
  priority: z.enum(ORGANIZATION_PRIORITIES).nullish(),
  potentialAnnualRevenue: money,
  paymentTermsDays: z.number().int().min(0).max(180).nullish(),
  annualVolume: text(80),
  companySize: text(80),
  projectTypes: strings.optional(),
  typicalProjectSize: text(80),
  biddingPlatform: text(120),
  prequalPlatform: text(120),
  vendorRegistrationUrl: url,
  requirementsNotes: text(5000),
  tradeIds: z.array(id).max(30).optional(),
  vendorId: id.nullish(),
};

export const createOrganizationSchema = z.object({ ...organizationFields, stage: z.enum(PARTNER_STAGE_KEYS as unknown as [string, ...string[]]).optional() });
export const updateOrganizationSchema = z.object({ ...organizationFields, isActive: z.boolean() }).partial();

export const stageChangeSchema = z
  .object({ stage: z.enum(PARTNER_STAGE_KEYS as unknown as [string, ...string[]]), reason: z.string().trim().max(500).nullish() })
  .refine((v) => !stageNeedsReason(v.stage as (typeof PARTNER_STAGE_KEYS)[number]) || Boolean(v.reason), { message: "Say why the account is not being pursued", path: ["reason"] });

export const ownerChangeSchema = z.object({ ownerUserId: id.nullable() });

export const contactFields = {
  firstName: z.string().trim().min(1, "First name").max(80),
  lastName: z.string().trim().min(1, "Last name").max(80),
  title: text(120),
  roleTag: z.enum(CONTACT_ROLES).optional(),
  email,
  phone: text(40),
  mobile: text(40),
  linkedinUrl: url,
  office: text(120),
  geography: text(120),
  trades: strings.optional(),
  relationshipStrength: z.number().int().min(1).max(5).nullish(),
  influence: z.number().int().min(1).max(5).nullish(),
  isPrimary: z.boolean().optional(),
  notes: text(5000),
};

export const createContactSchema = z.object(contactFields);
export const updateContactSchema = z.object({ ...contactFields, isActive: z.boolean() }).partial();

export const followUpSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueDay: dayKey,
  assignedUserId: id.nullish(),
});

export const createInteractionSchema = z.object({
  contactId: id.nullish(),
  leadId: id.nullish(),
  kind: z.enum(INTERACTION_KINDS),
  direction: z.enum(INTERACTION_DIRECTIONS).default("OUTBOUND"),
  outcome: z.enum(INTERACTION_OUTCOMES),
  /** ISO instant; defaults to now on the server. */
  occurredAt: z.string().datetime({ offset: true }).optional(),
  summary: z.string().trim().min(1, "Say what happened").max(4000),
  followUp: followUpSchema.nullish(),
});

export const updateInteractionSchema = z
  .object({
    contactId: id.nullish(),
    kind: z.enum(INTERACTION_KINDS),
    direction: z.enum(INTERACTION_DIRECTIONS),
    outcome: z.enum(INTERACTION_OUTCOMES),
    occurredAt: z.string().datetime({ offset: true }),
    summary: z.string().trim().min(1).max(4000),
  })
  .partial();

export const settingsSchema = z
  .object({
    newTargetDays: z.number().int().min(1).max(60),
    noResponseDays: z.number().int().min(1).max(60),
    qualSubmittedDays: z.number().int().min(1).max(120),
    prequalNoBidDays: z.number().int().min(1).max(365),
    activeQuietDays: z.number().int().min(1).max(365),
    dormantAfterDays: z.number().int().min(30).max(730),
    defaultOwnerUserId: id.nullable(),
    markets: z.array(z.string().trim().min(1).max(60)).max(100),
    vaultOwnerUserId: id.nullable(),
    defaultRequirementTypeKeys: z.array(z.string().trim().min(1).max(60)).max(60),
    scoreWeights: bidWeightsSchema.nullable(),
    ourTradeIds: z.array(id).max(30),
    homeCounties: z.array(z.string().trim().min(1).max(60)).max(100),
    adjacentCounties: z.array(z.string().trim().min(1).max(60)).max(100),
    typicalRange: z.record(z.string(), z.object({ min: z.number().min(0), max: z.number().min(0) })),
    bondingCapacity: z.number().min(0).max(1_000_000_000).nullable(),
    healthWeights: healthWeightsSchema.nullable(),
    preferredMinAwards: z.number().int().min(1).max(50),
    preferredMinMargin: z.number().min(0).max(1),
  })
  .partial();

export const QUALIFICATION_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "INFO_REQUESTED", "APPROVED", "REJECTED"] as const;
export const REQUIREMENT_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "WAIVED"] as const;
export const CONFIDENTIALITIES = ["INTERNAL", "RESTRICTED", "SHAREABLE"] as const;
export const DOCUMENT_CATEGORIES = ["insurance", "licensing", "safety", "financial", "company"] as const;

const dayOrEmpty = z.union([dayKey, z.literal(""), z.null()]).optional();

export const qualificationFields = {
  platform: text(120),
  portalUrl: url,
  portalUsernameHint: text(120),
  ownerUserId: id.nullish(),
  status: z.enum(QUALIFICATION_STATUSES).optional(),
  submittedAt: dayOrEmpty,
  approvedAt: dayOrEmpty,
  expiresAt: dayOrEmpty,
  renewalDueAt: dayOrEmpty,
  notes: text(5000),
};
export const createQualificationSchema = z.object({ ...qualificationFields, requirementTypeKeys: z.array(z.string().trim().min(1).max(60)).max(60).optional() });
export const updateQualificationSchema = z.object(qualificationFields).partial();
export const requirementPatchSchema = z.object({ required: z.boolean(), status: z.enum(REQUIREMENT_STATUSES), companyDocumentId: id.nullable(), notes: text(1000) }).partial();
export const addRequirementSchema = z.object({ documentTypeKey: z.string().trim().min(1).max(60) });
export const documentPatchSchema = z
  .object({ title: z.string().trim().min(1).max(200), effectiveDate: dayOrEmpty, expiresAt: dayOrEmpty, notes: text(2000), confidentiality: z.enum(CONFIDENTIALITIES), approvedForExternal: z.boolean() })
  .partial();
export const documentTypeSchema = z.object({ id: id.optional(), name: z.string().trim().min(2).max(120), category: z.enum(DOCUMENT_CATEGORIES), defaultValidityMonths: z.number().int().min(1).max(120).nullish(), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(1000).optional() });

export const BID_PLATFORMS = ["BUILDINGCONNECTED", "PROCORE", "PLANHUB", "SMARTBID", "CONSTRUCTCONNECT", "TEXTURA", "EMAIL", "OTHER"] as const;
export const BID_STATUSES_LIST = ["TRACKING", "INVITED", "DECIDING", "ESTIMATING", "SUBMITTED", "SHORTLISTED", "CLOSED"] as const;
export const BID_OUTCOMES = ["AWARDED", "LOST", "NO_BID", "CANCELLED", "NO_DECISION", "REBID"] as const;
export const BID_LOSS_REASONS = ["PRICE", "RELATIONSHIP", "SCHEDULE", "SCOPE", "QUALIFICATION", "BONDING", "CAPACITY", "COMPETITOR", "UNKNOWN", "OTHER"] as const;
export const BID_SUBMISSION_KINDS = ["ORIGINAL", "REVISED", "ALTERNATE", "VALUE_ENGINEERING"] as const;
export const BID_SUBMISSION_METHODS = ["PLATFORM", "EMAIL", "PORTAL", "HAND", "OTHER"] as const;

/** An instant (datetime-local or ISO) or a bare day; empty clears. */
const when = z.union([z.string().datetime({ offset: true }), dayKey, z.literal(""), z.null()]).optional();
const slider = z.number().int().min(1).max(5).nullable();

export const bidFields = {
  contactId: id.nullish(),
  projectName: z.string().trim().min(2, "Name the project").max(200),
  projectType: text(120),
  scopeSummary: text(5000),
  invitedAt: when,
  bidDueAt: when,
  siteWalkAt: when,
  preBidMeetingAt: when,
  rfiDueAt: when,
  addendaDeadlineAt: when,
  interviewAt: when,
  expectedAwardAt: when,
  addendaCount: z.number().int().min(0).max(99).optional(),
  specsReceived: z.boolean().optional(),
  estimatorUserId: id.nullish(),
  siteVisitRequired: z.boolean().optional(),
  bondRequired: z.boolean().optional(),
  prevailingWage: z.boolean().optional(),
  unionRequired: z.boolean().optional(),
  insuranceNotes: text(2000),
  scheduleNotes: text(2000),
  platform: z.enum(BID_PLATFORMS).optional(),
  platformUrl: url,
  platformRef: text(120),
  estimatedContractValue: money,
  estimatingHours: z.number().min(0).max(9999).nullish(),
  waitingOn: text(200),
  contractReceivedAt: when,
};

export const createBidSchema = z.object({
  ...bidFields,
  organizationId: id,
  status: z.enum(["TRACKING", "INVITED"]).optional(),
  tradeIds: z.array(id).min(1, "Pick at least one trade").max(10),
  site: z.object({ address1: z.string().trim().min(3).max(200), address2: text(200), city: z.string().trim().min(2).max(120), state: z.string().trim().length(2).optional(), zipCode: z.string().trim().min(5).max(12), county: text(80) }),
});
export const updateBidSchema = z.object({ ...bidFields, tradeIds: z.array(id).min(1).max(10).optional() }).partial();
export const bidStatusSchema = z.object({ status: z.enum(BID_STATUSES_LIST), waitingOn: text(200) });
export const bidDecisionSchema = z.object({
  decision: z.enum(["BID", "NO_BID"]),
  manual: z.object({ margin: slider, capacity: slider, competition: slider, complexity: slider, plansAndTerms: slider }),
  reason: text(2000),
});
export const bidOutcomeSchema = z
  .object({ outcome: z.enum(BID_OUTCOMES), lossReason: z.enum(BID_LOSS_REASONS).nullish(), winningContractor: text(200), winningPrice: money, outcomeNotes: text(5000), awardedAmount: money, outcomeAt: when })
  .refine((v) => v.outcome !== "LOST" || Boolean(v.lossReason), { message: "Say why it was lost", path: ["lossReason"] })
  .refine((v) => v.outcome !== "AWARDED" || (v.awardedAmount !== null && v.awardedAmount !== undefined && v.awardedAmount > 0), { message: "The awarded amount is needed to create the job", path: ["awardedAmount"] });
export const bidSubmissionSchema = z.object({
  kind: z.enum(BID_SUBMISSION_KINDS).optional(),
  amount: z.number().min(0).max(1_000_000_000),
  estimateId: id.nullish(),
  roofEstimateId: id.nullish(),
  submittedAt: when,
  method: z.enum(BID_SUBMISSION_METHODS).optional(),
  recipientContactId: id.nullish(),
  alternates: text(5000),
  clarifications: text(5000),
  exclusions: text(5000),
  fileId: id.nullish(),
  estimatingHours: z.number().min(0).max(9999).nullish(),
});
export const bidReopenSchema = z.object({ force: z.boolean().optional() });

/** Zod issues as one line: "field: what is wrong". */
export function issuesMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

/** Turn a service refusal into its response; anything else is rethrown. */
export function partnerErrorResponse(err: unknown): NextResponse {
  if (err instanceof PartnerError) return NextResponse.json({ error: err.message, ...(err.detail ?? {}) }, { status: err.status });
  if (err instanceof z.ZodError) return NextResponse.json({ error: issuesMessage(err) }, { status: 400 });
  throw err;
}
