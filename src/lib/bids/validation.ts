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
