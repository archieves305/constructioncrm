import { z } from "zod/v4";

// A prospect is usually created from a Zylow property (reapiId + snapshot), but
// can also be entered manually. Only the address basics are required.
export const createProspectSchema = z.object({
  reapiId: z.string().optional(),
  ownerName: z.string().optional(),
  propertyAddress1: z.string().min(1, "Property address is required"),
  propertyAddress2: z.string().optional(),
  city: z.string().min(1, "City is required"),
  state: z.string().default("FL"),
  zipCode: z.string().optional(),
  county: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  notes: z.string().optional(),
  assignedToUserId: z.string().optional(),
});

export const updateProspectSchema = z.object({
  ownerName: z.string().optional(),
  status: z
    .enum(["NEW", "CONTACTED", "INTERESTED", "NOT_INTERESTED", "PROMOTED", "DEAD"])
    .optional(),
  notes: z.string().optional(),
  assignedToUserId: z.string().nullable().optional(),
});

// Promotion mints a CRM lead. Leads require a contact name + phone, which a
// property snapshot doesn't have — so those are captured here. The address
// carries over from the prospect.
export const promoteProspectSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  primaryPhone: z.string().min(7, "Valid phone number required"),
  secondaryPhone: z.string().optional(),
  email: z.email("Valid email required").optional().or(z.literal("")),
  companyName: z.string().optional(),
  propertyType: z.enum(["RESIDENTIAL", "COMMERCIAL"]).default("RESIDENTIAL"),
  sourceId: z.string().optional(),
  assignedUserId: z.string().optional(),
  serviceCategoryIds: z.array(z.string()).optional(),
});

// Bulk save from the property map/list. Deduped by reapiId server-side.
export const bulkCreateProspectSchema = z.object({
  prospects: z.array(createProspectSchema).min(1).max(200),
});

export type CreateProspectInput = z.infer<typeof createProspectSchema>;
export type BulkCreateProspectInput = z.infer<typeof bulkCreateProspectSchema>;
export type UpdateProspectInput = z.infer<typeof updateProspectSchema>;
export type PromoteProspectInput = z.infer<typeof promoteProspectSchema>;
