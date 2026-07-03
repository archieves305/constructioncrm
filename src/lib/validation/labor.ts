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

// ── Daily logs & labor sheets (Phase 2) ─────────────────────────────────────

// Client-generated cuid: offline retries upsert by id instead of duplicating.
export const clientCuidSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]{19,31}$/, "expected a client-generated cuid");

const minutesOfDay = z.number().int().min(0).max(2879); // may exceed 1440 = next day

export const laborEntryInputSchema = z.object({
  id: clientCuidSchema,
  personnelId: z.string().min(1),
  trade: optionalTrimmed(80),
  jobAreaId: optionalTrimmed(40),
  workArea: optionalTrimmed(160),
  startMinutes: minutesOfDay.optional().nullable(),
  endMinutes: minutesOfDay.optional().nullable(),
  breakMinutes: z.number().int().min(0).max(600).default(0),
  costCodeId: optionalTrimmed(40),
  phase: optionalTrimmed(80),
  budgetLineId: optionalTrimmed(40),
  isAbsent: z.boolean().default(false),
  isLate: z.boolean().default(false),
  leftEarly: z.boolean().default(false),
  absenceReason: optionalTrimmed(200),
  notes: optionalTrimmed(2000),
  // Explicit rate override — stripped unless caller holds canEditPayRates.
  regularRate: z.number().min(0).max(10000).optional().nullable(),
});

export const laborSheetSchema = z.object({
  entries: z.array(laborEntryInputSchema).max(300),
  // Optimistic concurrency (optional): reject with 409 when the server copy
  // is newer than what the client last saw. Omitted = last write wins.
  baseUpdatedAt: z.string().optional(),
});

export type LaborEntryInput = z.infer<typeof laborEntryInputSchema>;

export const dailyLogUpsertSchema = z.object({
  managerUserId: optionalTrimmed(40),
  weatherSummary: optionalTrimmed(200),
  weatherTempHighF: z.number().int().min(-50).max(150).optional().nullable(),
  weatherTempLowF: z.number().int().min(-50).max(150).optional().nullable(),
  weatherPrecipIn: z.number().min(0).max(100).optional().nullable(),
  weatherWindMph: z.number().int().min(0).max(300).optional().nullable(),
  weatherSource: optionalTrimmed(40),
  workPerformed: optionalTrimmed(10000),
  areasWorked: optionalTrimmed(4000),
  materialsDelivered: optionalTrimmed(10000),
  equipmentUsed: optionalTrimmed(10000),
  subcontractorsOnsite: optionalTrimmed(4000),
  inspectionsNotes: optionalTrimmed(4000),
  delays: optionalTrimmed(4000),
  safetyIssues: optionalTrimmed(4000),
  changeOrderItems: optionalTrimmed(4000),
  ownerInstructions: optionalTrimmed(4000),
  officeFollowUps: optionalTrimmed(4000),
  tomorrowPlan: optionalTrimmed(4000),
  notes: optionalTrimmed(10000),
  safetyToolboxTalk: z.boolean().optional(),
  safetyPpeVerified: z.boolean().optional(),
  safetyHousekeeping: z.boolean().optional(),
  baseUpdatedAt: z.string().optional(),
});

export const returnLogSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

export const costCodeSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  phase: optionalTrimmed(80),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const jobAreaSchema = z.object({
  name: z.string().trim().min(1).max(120),
  floor: optionalTrimmed(40),
  unit: optionalTrimmed(40),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const laborSettingsSchema = z.object({
  otWeeklyThreshold: z.number().min(0).max(168),
  otDailyThreshold: z.number().min(0).max(24).nullable(),
  otMultiplier: z.number().min(1).max(3),
  weekStartsOn: z.number().int().min(0).max(6),
  bookkeeperEmail: z.string().trim().email().nullable().optional(),
  payrollApprovedOnly: z.boolean().optional(),
});
