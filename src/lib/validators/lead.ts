import { z } from "zod/v4";

// The fields without defaults: zod's partial() keeps a default, so an update
// schema built from the create schema would reset state, property type and
// the three flags on every PATCH that did not send them.
const leadFields = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  primaryPhone: z.string().min(7, "Valid phone number required"),
  secondaryPhone: z.string().optional(),
  email: z.email("Valid email required").optional().or(z.literal("")),
  companyName: z.string().optional(),
  propertyAddress1: z.string().min(1, "Property address is required"),
  propertyAddress2: z.string().optional(),
  mailingAddress1: z.string().optional(),
  mailingAddress2: z.string().optional(),
  city: z.string().min(1, "City is required"),
  county: z.string().optional(),
  state: z.string(),
  zipCode: z.string().min(5, "ZIP code is required"),
  propertyType: z.enum(["RESIDENTIAL", "COMMERCIAL"]),
  sourceId: z.string().optional(),
  sourceDetail: z.string().optional(),
  assignedUserId: z.string().optional(),
  serviceCategoryIds: z.array(z.string()).optional(),
  // An emptied number field arrives as null (NaN does not survive JSON).
  estimatedJobValue: z.number().positive("Estimated job value must be more than 0").nullish(),
  insuranceClaim: z.boolean(),
  financingNeeded: z.boolean(),
  urgent: z.boolean(),
  preferredContactMethod: z.string().optional(),
  notesSummary: z.string().optional(),
  nextFollowUpAt: z.string().optional(),
  // Read by permit forms; entered by a person from the property appraiser or the survey.
  parcelNumber: z.string().trim().max(60).nullish(),
  legalDescription: z.string().trim().max(4000).nullish(),
});

export const createLeadSchema = leadFields.extend({
  state: leadFields.shape.state.default("FL"),
  propertyType: leadFields.shape.propertyType.default("RESIDENTIAL"),
  insuranceClaim: leadFields.shape.insuranceClaim.default(false),
  financingNeeded: leadFields.shape.financingNeeded.default(false),
  urgent: leadFields.shape.urgent.default(false),
});

/** One readable line for a 400: "Field: what is wrong; …". */
export function leadIssuesMessage(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => (i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message)).join("; ");
}

export const updateLeadSchema = leadFields.partial();

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
