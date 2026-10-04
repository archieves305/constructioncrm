import { z } from "zod/v4";

export const createLeadSchema = z.object({
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
  state: z.string().default("FL"),
  zipCode: z.string().min(5, "ZIP code is required"),
  propertyType: z.enum(["RESIDENTIAL", "COMMERCIAL"]).default("RESIDENTIAL"),
  sourceId: z.string().optional(),
  sourceDetail: z.string().optional(),
  assignedUserId: z.string().optional(),
  serviceCategoryIds: z.array(z.string()).optional(),
  // An emptied number field arrives as null (NaN does not survive JSON).
  estimatedJobValue: z.number().positive("Estimated job value must be more than 0").nullish(),
  insuranceClaim: z.boolean().default(false),
  financingNeeded: z.boolean().default(false),
  urgent: z.boolean().default(false),
  preferredContactMethod: z.string().optional(),
  notesSummary: z.string().optional(),
  nextFollowUpAt: z.string().optional(),
});

/** One readable line for a 400: "Field: what is wrong; …". */
export function leadIssuesMessage(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => (i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message)).join("; ");
}

export const updateLeadSchema = createLeadSchema.partial();

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
