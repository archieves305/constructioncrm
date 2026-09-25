import { z } from "zod/v4";
import { WORKFLOW_ROLE_VALUES } from "./workflow";

/** Hand-written enum mirrors, as the repo's validators are. */
export const CASE_STATUS_VALUES = ["NEW", "ACTIVE", "ON_HOLD", "APPEALED", "COMPLIED", "CLOSED", "CANCELLED"] as const;
export const SEVERITY_VALUES = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
export const ITEM_STATUS_VALUES = ["OPEN", "IN_PROGRESS", "CORRECTED", "VERIFIED", "WITHDRAWN"] as const;
export const HEARING_TYPE_VALUES = ["SPECIAL_MAGISTRATE", "CODE_ENFORCEMENT_BOARD", "APPEAL", "LIEN_REDUCTION", "OTHER"] as const;
export const HEARING_STATUS_VALUES = ["SCHEDULED", "CONTINUED", "HELD", "CANCELLED"] as const;
export const HEARING_OUTCOME_VALUES = ["COMPLIANCE_ORDERED", "FINE_IMPOSED", "CONTINUED", "DISMISSED", "FOUND_IN_COMPLIANCE", "LIEN_AUTHORIZED", "MITIGATION_GRANTED", "MITIGATION_DENIED", "OTHER"] as const;
export const INSPECTION_STATUS_VALUES = ["REQUESTED", "SCHEDULED", "COMPLETED", "CANCELLED"] as const;
export const INSPECTION_RESULT_VALUES = ["PASS", "FAIL", "CONDITIONAL"] as const;
export const EXTENSION_STATUS_VALUES = ["REQUESTED", "GRANTED", "DENIED", "WITHDRAWN"] as const;
export const MITIGATION_STATUS_VALUES = ["NONE", "REQUESTED", "GRANTED", "PARTIALLY_GRANTED", "DENIED"] as const;
export const FINE_ENTRY_TYPE_VALUES = ["OFFICIAL_BALANCE", "ACCRUAL_STARTED", "ACCRUAL_STOPPED", "FINE_IMPOSED", "ADMIN_COST", "PAYMENT", "MITIGATION_REQUESTED", "MITIGATION_DECIDED", "LIEN_RECORDED", "LIEN_RELEASED", "ADJUSTMENT", "NOTE"] as const;
export const NOTICE_TYPE_VALUES = ["NOTICE_OF_VIOLATION", "CITATION", "STOP_WORK_ORDER", "NOTICE_OF_HEARING", "LIEN_NOTICE", "OTHER"] as const;
export const PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const PERMIT_STATUS_VALUES = ["UNDETERMINED", "REQUIRED", "NOT_REQUIRED"] as const;

const key = z.string().regex(/^[a-z][a-z0-9_]*$/, "invalid key");
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "expected yyyy-MM-dd");
const dateTime = z.string().min(10);
/** Decimal(12,2) columns: accept a number or numeric string, store as a string with ≤ 2 decimals. */
const money = z
  .union([z.number(), z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/, "expected an amount")])
  .transform((v) => (typeof v === "number" ? v.toFixed(2) : v));
const moneyOpt = money.nullable().optional();
const text = (max: number) => z.string().trim().max(max);
const id = z.string().min(1);

export const itemCreateSchema = z.object({
  categoryId: id.nullable().optional(),
  codeSection: text(200).nullable().optional(),
  description: text(4000).min(1, "Describe the violation"),
  correctiveAction: text(4000).nullable().optional(),
  responsibleTrade: text(120).nullable().optional(),
  permitRequirement: z.enum(PERMIT_STATUS_VALUES).optional(),
  assignedUserId: id.nullable().optional(),
  assignedRole: z.enum(WORKFLOW_ROLE_VALUES).nullable().optional(),
  contractorName: text(200).nullable().optional(),
  targetCompletionAt: dateOnly.nullable().optional(),
  estimatedCost: moneyOpt,
});

export const itemPatchSchema = itemCreateSchema
  .partial()
  .extend({
    status: z.enum(ITEM_STATUS_VALUES).optional(),
    actualCompletionAt: dateOnly.nullable().optional(),
    actualCost: moneyOpt,
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

const caseFields = {
  title: text(300).min(1, "A title is required"),
  agencyCaseNumber: text(120).nullable().optional(),
  parcelNumber: text(120).nullable().optional(),
  ownerNameSnapshot: text(200).nullable().optional(),
  jurisdiction: text(200).nullable().optional(),
  department: text(200).nullable().optional(),
  officerName: text(200).nullable().optional(),
  officerPhone: text(60).nullable().optional(),
  officerEmail: z.string().trim().email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  noticeType: z.enum(NOTICE_TYPE_VALUES).nullable().optional(),
  summary: text(10_000).nullable().optional(),
  receivedAt: dateOnly.optional(),
  noticeDate: dateOnly.nullable().optional(),
  originalDeadline: dateOnly.nullable().optional(),
  appealDeadline: dateOnly.nullable().optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  caseManagerId: id.nullable().optional(),
  responsibleRole: z.enum(WORKFLOW_ROLE_VALUES).nullable().optional(),
  hearingRequired: z.boolean().optional(),
  reinspectionRequired: z.boolean().optional(),
  emergency: z.boolean().optional(),
  constructionRequired: z.boolean().optional(),
  estimatedCost: moneyOpt,
  actualCost: moneyOpt,
};

export const createCaseSchema = z
  .object({
    ...caseFields,
    leadId: id,
    jobId: id.nullable().optional(),
    /** The deadline on the notice; becomes both original and current. */
    complianceDeadline: dateOnly.nullable().optional(),
    hearingAt: dateTime.nullable().optional(),
    hearingLocation: text(300).nullable().optional(),
    items: z.array(itemCreateSchema).min(1, "Add at least one violation item").max(50),
    fines: z
      .object({
        initialFine: moneyOpt,
        dailyFine: moneyOpt,
        accrualStartDate: dateOnly.nullable().optional(),
      })
      .optional(),
    lien: z.object({ recorded: z.boolean(), recordedAt: dateOnly.nullable().optional(), amount: moneyOpt, instrumentNumber: text(120).nullable().optional() }).optional(),
    workflow: z
      .object({
        templateKey: key.nullable().optional(),
        permitStatus: z.enum(PERMIT_STATUS_VALUES).default("UNDETERMINED"),
        scopeToggles: z.record(key, z.boolean()).default({}),
        team: z.partialRecord(z.enum(WORKFLOW_ROLE_VALUES), id.nullable()).optional(),
        permitNotes: text(4000).nullable().optional(),
      })
      .optional(),
  })
  .refine((v) => !(v.fines?.dailyFine && Number(v.fines.dailyFine) > 0 && !v.fines.accrualStartDate), { message: "A daily fine needs an accrual start date", path: ["fines", "accrualStartDate"] });

export type CreateCaseBody = z.infer<typeof createCaseSchema>;

export const updateCaseSchema = z.object({ ...caseFields, title: caseFields.title.optional() }).partial().refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateCaseBody = z.infer<typeof updateCaseSchema>;

export const caseStatusSchema = z.object({
  status: z.enum(CASE_STATUS_VALUES),
  reason: text(2000).nullable().optional(),
});

export const closeCaseSchema = z.object({
  reason: text(2000).nullable().optional(),
  override: z.object({ reason: text(2000).min(10, "Say why the case is being closed without every blocker cleared (at least 10 characters)") }).optional(),
});

export const reopenCaseSchema = z.object({ reason: text(2000).min(1, "Say why the case is being reopened") });

export const agencyConfirmSchema = z.object({
  confirmedAt: dateOnly,
  confirmedByName: text(200).nullable().optional(),
  method: text(60).nullable().optional(),
  reference: text(200).nullable().optional(),
  fileId: id.nullable().optional(),
  officialComplianceDate: dateOnly.nullable().optional(),
  notes: text(2000).nullable().optional(),
});

export const DEADLINE_CHANGE_KINDS = ["EXTENSION_GRANTED", "AGENCY_RESCHEDULE", "HEARING_ORDER", "CORRECTION"] as const;

export const deadlineChangeSchema = z.object({
  newDeadline: dateOnly,
  kind: z.enum(DEADLINE_CHANGE_KINDS).default("AGENCY_RESCHEDULE"),
  reason: text(2000).min(1, "Say why the deadline is changing"),
  reference: text(200).nullable().optional(),
});

export const extensionCreateSchema = z.object({
  requestedDeadline: dateOnly,
  reason: text(2000).nullable().optional(),
  requestFileId: id.nullable().optional(),
});

export const extensionDecisionSchema = z.object({
  status: z.enum(["GRANTED", "DENIED", "WITHDRAWN"]),
  grantedDeadline: dateOnly.nullable().optional(),
  decisionNotes: text(2000).nullable().optional(),
});

export const linkJobSchema = z.object({ jobId: id });

export const hearingCreateSchema = z.object({
  type: z.enum(HEARING_TYPE_VALUES).default("SPECIAL_MAGISTRATE"),
  scheduledAt: dateTime,
  location: text(300).nullable().optional(),
  attendeeUserId: id.nullable().optional(),
  caseNumberAtHearing: text(120).nullable().optional(),
  notes: text(2000).nullable().optional(),
});

export const hearingPatchSchema = z
  .object({
    type: z.enum(HEARING_TYPE_VALUES).optional(),
    status: z.enum(HEARING_STATUS_VALUES).optional(),
    scheduledAt: dateTime.optional(),
    location: text(300).nullable().optional(),
    attendeeUserId: id.nullable().optional(),
    notes: text(2000).nullable().optional(),
    outcome: z.enum(HEARING_OUTCOME_VALUES).nullable().optional(),
    outcomeNotes: text(4000).nullable().optional(),
    orderDeadline: dateOnly.nullable().optional(),
    orderedFineAmount: moneyOpt,
    orderedDailyFine: moneyOpt,
    orderFileId: id.nullable().optional(),
    /** When the order sets a new compliance deadline, move the case's deadline too. */
    applyOrderDeadline: z.boolean().optional(),
    continueTo: z.object({ scheduledAt: dateTime, location: text(300).nullable().optional() }).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export const inspectionCreateSchema = z.object({
  kind: z.enum(["INITIAL", "REINSPECTION", "FINAL"]).default("REINSPECTION"),
  scheduledFor: dateTime.nullable().optional(),
  attendeeUserId: id.nullable().optional(),
  inspectorName: text(200).nullable().optional(),
  notes: text(2000).nullable().optional(),
  /** Mark the case as awaiting the agency from this request. */
  requestsReinspection: z.boolean().optional(),
});

export const inspectionPatchSchema = z
  .object({
    status: z.enum(INSPECTION_STATUS_VALUES).optional(),
    scheduledFor: dateTime.nullable().optional(),
    attendeeUserId: id.nullable().optional(),
    inspectorName: text(200).nullable().optional(),
    notes: text(2000).nullable().optional(),
    reportFileId: id.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export const agencyInspectionResultSchema = z
  .object({
    result: z.enum(INSPECTION_RESULT_VALUES),
    completedAt: dateOnly.optional(),
    notes: text(4000).nullable().optional(),
    inspectorName: text(200).nullable().optional(),
    /** Items the agency re-cited (FAIL / CONDITIONAL). */
    failedItemIds: z.array(id).max(200).default([]),
    /** Items the agency accepted (PASS marks every open item verified unless given). */
    verifiedItemIds: z.array(id).max(200).optional(),
    /** The workflow step to record the result on (the "Attend agency reinspection" step). */
    taskId: id.nullable().optional(),
    reportFileId: id.nullable().optional(),
    /** ADMIN/MANAGER: this PASS is the agency's compliance confirmation. */
    confirmsAgency: z.boolean().optional(),
  })
  .refine((v) => v.result !== "FAIL" || v.failedItemIds.length > 0, { message: "Say which items the agency re-cited", path: ["failedItemIds"] });

export const fineEntrySchema = z.object({
  type: z.enum(FINE_ENTRY_TYPE_VALUES),
  amount: moneyOpt,
  effectiveAt: dateOnly,
  reference: text(200).nullable().optional(),
  notes: text(2000).nullable().optional(),
  fileId: id.nullable().optional(),
});

export const fineTermsSchema = z
  .object({
    initialFine: moneyOpt,
    dailyFine: moneyOpt,
    accrualStartDate: dateOnly.nullable().optional(),
    accrualStoppedAt: dateOnly.nullable().optional(),
    adminCosts: moneyOpt,
    mitigationStatus: z.enum(MITIGATION_STATUS_VALUES).optional(),
    mitigationRequestedAmount: moneyOpt,
    mitigationGrantedAmount: moneyOpt,
    fineResolvedAt: dateOnly.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export const fineOverrideSchema = z.object({
  amount: money.nullable(),
  reason: text(2000).min(1, "Say why the estimate is being overridden"),
});

export const lienRecordSchema = z.object({
  amount: moneyOpt,
  recordedAt: dateOnly,
  instrumentNumber: text(120).nullable().optional(),
  bookPage: text(120).nullable().optional(),
  fileId: id.nullable().optional(),
  notes: text(2000).nullable().optional(),
});

export const lienReleaseSchema = z.object({
  releasedAt: dateOnly,
  releaseInstrumentNumber: text(120).nullable().optional(),
  fileId: id.nullable().optional(),
  notes: text(2000).nullable().optional(),
});

export const caseNoteSchema = z.object({ body: text(10_000).min(1, "Write something") });

export const caseCommunicationSchema = z.object({
  communicationType: z.enum(["SMS", "CALL", "EMAIL"]),
  direction: z.enum(["INBOUND", "OUTBOUND"]).default("OUTBOUND"),
  toValue: text(200).nullable().optional(),
  subject: text(300).nullable().optional(),
  body: text(10_000).min(1, "Say what was communicated"),
});

export const categorySchema = z.object({
  key: key.optional(),
  name: text(120).min(1),
  description: text(1000).nullable().optional(),
  defaultResponsibleTrade: text(120).nullable().optional(),
  defaultPermitRequirement: z.enum(PERMIT_STATUS_VALUES).optional(),
  defaultConstructionRequired: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});
export const categoryPatchSchema = categorySchema.omit({ key: true }).partial().refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export const bulkAssignSchema = z.object({
  caseIds: z.array(id).min(1).max(200),
  caseManagerId: id.nullable(),
});
