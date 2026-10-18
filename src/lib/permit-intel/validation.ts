import { z } from "zod";
import { PERMIT_DOC_TYPES } from "./doc-types";

/** Request bodies of the Permit Intelligence routes. Client-safe. */
const optText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();
const day = z.coerce.date();

export const partySchema = z.object({
  role: z.enum(["OWNER", "APPLICANT", "QUALIFIER", "ARCHITECT", "ENGINEER_OF_RECORD", "SUBCONTRACTOR", "OTHER"]),
  name: z.string().trim().min(1, "Give the party a name").max(200),
  email: z.string().trim().email("That email address does not look right").max(200).nullable().optional().or(z.literal("").transform(() => null)),
  phone: optText(40),
  licenseNumber: optText(80),
  organizationId: z.string().max(60).nullable().optional(),
  contactId: z.string().max(60).nullable().optional(),
  vendorId: z.string().max(60).nullable().optional(),
});
export type PartyInput = z.infer<typeof partySchema>;

export const cycleOutcomeSchema = z.object({
  outcome: z.enum(["PENDING", "APPROVED", "CORRECTIONS", "DENIED", "WITHDRAWN"]),
  outcomeAt: day.nullable().optional(),
  reviewerName: optText(200),
  notes: optText(4000),
  // the issued number, when the answer is an approval
  permitNumber: optText(80),
});
export type CycleOutcomeInput = z.infer<typeof cycleOutcomeSchema>;

export const manualCycleSchema = z.object({ submittedAt: day, notes: optText(4000) });

export const submissionSchema = z.object({
  fileIds: z.array(z.string().max(60)).min(1, "Pick at least one document to send").max(200),
  method: z.enum(["PORTAL", "EMAIL", "IN_PERSON", "MAIL", "UNKNOWN"]),
  confirmationRef: optText(200),
  notes: optText(4000),
  submittedAt: day.optional(),
});
export type SubmissionInput = z.infer<typeof submissionSchema>;

// No defaults on the fields: zod's partial() keeps a default, so a PATCH
// built from a schema with defaults would reset every field it did not send.
const jurisdictionFields = z.object({
  name: z.string().trim().min(2, "Give the jurisdiction a name").max(120),
  kind: z.enum(["CITY", "TOWN", "VILLAGE", "COUNTY", "STATE", "OTHER"]).optional(),
  county: optText(80),
  state: z.string().trim().length(2),
  hvhz: z.boolean(),
  portalUrl: z.string().trim().url("That link does not look right").max(500).nullable().optional().or(z.literal("").transform(() => null)),
  submissionMethod: z.enum(["PORTAL", "EMAIL", "IN_PERSON", "MAIL", "UNKNOWN"]),
  reviewDaysTarget: z.number().int().min(1).max(365).nullable().optional(),
  notes: optText(4000),
});
export const jurisdictionSchema = jurisdictionFields.extend({
  state: jurisdictionFields.shape.state.default("FL"),
  hvhz: jurisdictionFields.shape.hvhz.default(false),
  submissionMethod: jurisdictionFields.shape.submissionMethod.default("UNKNOWN"),
});
export const jurisdictionPatchSchema = jurisdictionFields.partial().extend({ isActive: z.boolean().optional() });
export type JurisdictionInput = z.infer<typeof jurisdictionSchema>;

const docTypeKeys = PERMIT_DOC_TYPES.map((t) => t.key) as [string, ...string[]];

const requirementFields = z.object({
  jurisdictionId: z.string().max(60).nullable(),
  permitTypeKey: z.string().max(60).nullable(),
  title: z.string().trim().min(2, "Say what is required").max(200),
  body: optText(4000),
  documentType: z.enum(docTypeKeys).nullable(),
  required: z.boolean(),
  reliability: z.enum(["OFFICIAL", "INTERNAL", "OBSERVED"]),
  sourceUrl: z.string().trim().url("That link does not look right").max(500).nullable().optional().or(z.literal("").transform(() => null)),
  effectiveFrom: day.nullable().optional(),
  effectiveTo: day.nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000),
});
export const requirementSchema = requirementFields.extend({
  jurisdictionId: requirementFields.shape.jurisdictionId.default(null),
  permitTypeKey: requirementFields.shape.permitTypeKey.default(null),
  documentType: requirementFields.shape.documentType.default(null),
  required: requirementFields.shape.required.default(true),
  reliability: requirementFields.shape.reliability.default("INTERNAL"),
  sortOrder: requirementFields.shape.sortOrder.default(0),
});
// retired, never deleted: a past preflight may have been judged against it
export const requirementPatchSchema = requirementFields.partial().extend({ status: z.enum(["APPROVED", "RETIRED"]).optional() });
export type RequirementInput = z.infer<typeof requirementSchema>;
