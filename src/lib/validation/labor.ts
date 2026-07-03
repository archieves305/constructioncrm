import { z } from "zod";

// Zod schemas for the field-labor module (personnel now; daily logs and
// labor sheets arrive in later phases).

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const personnelBase = {
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: optionalTrimmed(40),
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  address1: optionalTrimmed(160),
  address2: optionalTrimmed(160),
  city: optionalTrimmed(80),
  state: optionalTrimmed(40),
  zipCode: optionalTrimmed(20),
  emergencyContactName: optionalTrimmed(120),
  emergencyContactPhone: optionalTrimmed(40),
  emergencyContactRelation: optionalTrimmed(60),
  trade: optionalTrimmed(80),
  title: optionalTrimmed(80),
  employmentType: z.enum(["W2", "CONTRACTOR_1099", "SUB_CREW", "TEMP"]).optional(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED"]).optional(),
  startDate: isoDate.optional().nullable(),
  endDate: isoDate.optional().nullable(),
  entityName: optionalTrimmed(160),
  crewId: optionalTrimmed(40),
  notes: optionalTrimmed(4000),
  isActive: z.boolean().optional(),
  // Gated fields — the route strips these unless the caller holds the
  // matching grant (canEditPayRates / canViewSensitivePersonnel).
  hourlyRate: z.number().min(0).max(10000).optional().nullable(),
  ssn: z.string().trim().max(20).optional().nullable(),
};

export const personnelCreateSchema = z.object(personnelBase);

export const personnelUpdateSchema = personnelCreateSchema.partial();

export type PersonnelCreateInput = z.infer<typeof personnelCreateSchema>;
export type PersonnelUpdateInput = z.infer<typeof personnelUpdateSchema>;

export const personnelDocumentTypeSchema = z.enum([
  "W9",
  "GOVERNMENT_ID",
  "CERTIFICATION",
  "OTHER",
]);
