import { z } from "zod";
import { BID_LOSS_REASONS, BID_PLATFORMS } from "@/lib/partners/validation";

/**
 * Request bodies for the PlanHub bid-project routes. Patches carry no
 * defaults (a zod `.partial()` keeps `.default()`, which would reset fields
 * on a PATCH), and optional fields are `.nullish()` where the form clears them.
 */

const text = (max: number) => z.string().trim().max(max).nullish();
const id = z.string().min(1).max(60);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date (yyyy-mm-dd)");
const when = z.union([z.string().datetime({ offset: true }), dayKey, z.literal(""), z.null()]).optional();
const url = z.union([z.string().trim().url().max(2000), z.literal(""), z.null()]).optional();
const amount = z.number().positive().max(1_000_000_000);

const projectFields = {
  name: z.string().trim().min(2, "Name the project").max(200),
  address1: text(200),
  address2: text(200),
  city: text(120),
  state: z.union([z.string().trim().length(2), z.literal(""), z.null()]).optional(),
  zipCode: text(12),
  county: text(80),
  source: z.enum(BID_PLATFORMS).optional(),
  platformRef: text(120),
  platformUrl: url,
  ownerName: text(200),
  projectType: text(120),
  ownerBidDueAt: when,
  expectedPrimeAwardAt: when,
  expectedStartAt: when,
  notes: text(5000),
  ownerUserId: id.nullish(),
  timeZone: z.string().trim().min(3).max(60).optional(),
};

export const scopeInputSchema = z.object({ serviceCategoryId: id, label: text(120) });

export const createProjectSchema = z.object({ ...projectFields, scopes: z.array(scopeInputSchema).max(20).optional(), force: z.boolean().optional() });
export const updateProjectSchema = z.object(projectFields).partial();
export const addScopesSchema = z.object({ scopes: z.array(scopeInputSchema).min(1).max(20) });

export const projectStageSchema = z.object({ stage: z.enum(["OPEN", "POSTPONED", "REBIDDING", "CANCELLED"]), reason: text(2000), reviewAt: when });

export const addOpportunitySchema = z.object({
  organizationId: id,
  contactId: id.nullish(),
  purchasingContactId: id.nullish(),
  scopeIds: z.array(id).min(1, "Pick the scopes this GC is bidding").max(20),
  status: z.enum(["TRACKING", "INVITED"]).optional(),
  bidDueAt: when,
  expectedAwardAt: when,
  invitedAt: when,
  estimatorUserId: id.nullish(),
  pmUserId: id.nullish(),
  platformUrl: url,
  platformRef: text(120),
  scopeSummary: text(5000),
  scheduleNotes: text(2000),
  insuranceNotes: text(2000),
});

export const opportunityScopesSchema = z.object({ scopeIds: z.array(id).min(1).max(20) });
export const primeStatusSchema = z.object({ primeStatus: z.enum(["UNKNOWN", "PENDING", "GC_AWARDED", "GC_LOST", "REBIDDING", "CANCELLED"]), note: text(2000) });
export const scopeStatusSchema = z
  .object({ status: z.enum(["PENDING", "LOST", "WITHDRAWN", "NO_BID", "CANCELLED"]), lossReason: z.enum(BID_LOSS_REASONS).nullish(), note: text(2000) })
  .refine((v) => v.status !== "LOST" || Boolean(v.lossReason), { message: "Say why it was lost", path: ["lossReason"] });

export const awardSchema = z
  .object({ kind: z.enum(["VERBAL", "WRITTEN", "EXECUTED"]), scopeIds: z.array(id).min(1).max(20), amount, awardedAt: when, evidenceFileId: id.nullish(), notes: text(5000) })
  .refine((v) => v.kind === "VERBAL" || Boolean(v.evidenceFileId), { message: "Attach the award letter, LOI or signed subcontract", path: ["evidenceFileId"] });
export const confirmAwardSchema = z.object({ kind: z.enum(["WRITTEN", "EXECUTED"]), amount: amount.optional(), evidenceFileId: id, awardedAt: when });

// ── Stage 1b: proposals ──────────────────────────────────────────────────

const reviewField = z.object({ value: z.string().max(2000), source: z.string().max(200).nullable(), confidence: z.number().min(0).max(1).nullable(), state: z.enum(["ok", "uncertain", "missing"]) });
const lineKind = z.enum(["BASE", "ALTERNATE", "ALLOWANCE", "UNIT"]);
export const reviewDraftSchema = z.object({
  fields: z.record(z.string(), reviewField),
  lines: z.array(z.object({ serviceCategoryId: id.nullable(), tradeText: z.string().max(200), description: z.string().max(2000), kind: lineKind, amount: z.number().min(-1_000_000_000).max(1_000_000_000), source: z.string().max(200).nullable(), confidence: z.number().min(0).max(1).nullable() })).max(200),
  bundleOnly: z.boolean(),
  inclusions: z.string().max(20_000),
  exclusions: z.string().max(20_000),
  clarifications: z.string().max(20_000),
  alternates: z.string().max(20_000),
  gcContacts: z.array(z.object({ name: z.string().max(200), email: z.string().max(320).nullable(), phone: z.string().max(60).nullable(), title: z.string().max(200).nullable(), source: z.string().max(200).nullable() })).max(50),
  conflicts: z.array(z.object({ field: z.string().max(100), values: z.array(z.object({ value: z.string().max(2000), source: z.string().max(200).nullable() })).max(10) })).max(50),
  summary: z.string().max(4000),
  documentKind: z.enum(["proposal", "estimate", "invitation", "other"]),
});

export const confirmProposalSchema = z.object({
  project: z.union([z.object({ id }), z.object({ create: z.object(projectFields), force: z.boolean().optional() })]),
  proposalNumber: text(120),
  proposalDate: when,
  validUntil: when,
  total: z.number().positive().max(1_000_000_000),
  bundleAdjustment: z.number().min(-1_000_000_000).max(0),
  lines: z.array(z.object({ serviceCategoryId: id.nullable(), kind: lineKind, description: text(2000), amount: z.number().min(0).max(1_000_000_000) })).min(1).max(200),
  inclusions: text(20_000),
  exclusions: text(20_000),
  alternates: text(20_000),
  clarifications: text(20_000),
  organizationId: id.nullish(),
  gcs: z.array(z.object({ organizationId: id, contactId: id.nullish(), bidDueAt: when, estimatorUserId: id.nullish() })).max(30),
});

export const recordSubmissionsSchema = z.object({
  versionId: id,
  entries: z.array(z.object({ bidId: id, recipientContactIds: z.array(id).max(20), method: z.enum(["PLATFORM", "EMAIL", "PORTAL", "HAND", "OTHER"]), submittedAt: when, amount: z.number().positive().max(1_000_000_000).nullish(), evidenceFileId: id.nullish() })).min(1).max(30),
});

/** A PlanHub invitation email filed under a bid project (existing, or started from the email). */
export const intakeToProjectSchema = z
  .object({
    projectId: id.nullish(),
    createProject: z.object({ ...projectFields }).nullish(),
    organizationId: id,
    contactId: id.nullish(),
    scopeServiceCategoryIds: z.array(id).min(1, "Pick the scopes KNU is bidding").max(20),
    bidDueAt: when,
    estimatorUserId: id.nullish(),
  })
  .refine((v) => Boolean(v.projectId) || Boolean(v.createProject), { message: "Pick the project, or start one from the email", path: ["projectId"] });
