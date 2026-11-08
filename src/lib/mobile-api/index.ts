import { z } from "zod";

/**
 * Request and response shapes the phone app and the CRM share
 * (CAREYOS_MOBILE_APP_PLAN.md §D.2). Pure zod: no Prisma, no Next, no
 * server-only imports, so `mobile/` can import this file directly. A breaking
 * change here goes with a raise of MOBILE_MIN_APP_VERSION.
 */

export const PLATFORMS = ["ios", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;

export const registerDeviceRequest = z.object({
  /** Random id the app makes once per installation; not a hardware id. */
  installationId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, "8–64 letters, digits or dashes"),
  platform: z.enum(PLATFORMS),
  appVersion: z.string().regex(VERSION, "major.minor.patch"),
  deviceName: z.string().trim().max(80).optional(),
});
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequest>;

export const mobileDevice = z.object({
  id: z.string(),
  platform: z.enum(PLATFORMS),
  appVersion: z.string().nullable(),
  deviceName: z.string().nullable(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});
export type MobileDeviceDto = z.infer<typeof mobileDevice>;

export const ROLE_NAMES = [
  "ADMIN",
  "MANAGER",
  "SALES_REP",
  "OFFICE_STAFF",
  "MARKETING",
  "READ_ONLY",
  "CREW_LEAD",
] as const;

export const sessionUser = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.enum(ROLE_NAMES),
});
export type SessionUserDto = z.infer<typeof sessionUser>;

export const bootstrapResponse = z.object({
  user: sessionUser,
  /** Builds below this must update before use. */
  minAppVersion: z.string(),
  /** This phone's registration, when the request carried its token. */
  device: mobileDevice.nullable(),
  /** Server time, so the app can notice a wrong phone clock. */
  serverTime: z.string(),
});
export type BootstrapResponse = z.infer<typeof bootstrapResponse>;

/** Error body every CRM route uses: `{ error, code? }`. */
export const apiError = z.object({
  error: z.string(),
  code: z.string().optional(),
});

/** -1, 0 or 1. Missing or malformed parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function needsUpdate(appVersion: string, minAppVersion: string): boolean {
  return compareVersions(appVersion, minAppVersion) < 0;
}

// ---------------------------------------------------------------------------
// Read shapes for Phase 2 screens. Only the fields the app uses; zod drops the
// rest. The CRM's own types are the source of truth; contract.test.ts parses
// real server output with these, so a change that would break the app fails
// the CRM's tests first.
// ---------------------------------------------------------------------------

const person = z.object({ id: z.string(), firstName: z.string(), lastName: z.string() });
export type PersonDto = z.infer<typeof person>;

export const leadLabel = z.object({
  id: z.string(),
  fullName: z.string(),
  companyName: z.string().nullish(),
  propertyAddress1: z.string(),
  propertyAddress2: z.string().nullish(),
  city: z.string(),
  state: z.string().nullish(),
  zipCode: z.string().nullish(),
  primaryPhone: z.string().nullish(),
});
export type LeadLabelDto = z.infer<typeof leadLabel>;

export const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const calendarItem = z.object({
  kind: z.string(),
  id: z.string(),
  title: z.string(),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES),
  /** The calendar's status with its precedence: overdue, blocked, done… */
  derived: z.string(),
  allDay: z.boolean(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  dayKey: z.string().nullable(),
  dueAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  assignedTo: person.nullable(),
  job: z
    .object({ id: z.string(), jobNumber: z.string(), title: z.string(), lead: leadLabel.nullable() })
    .nullable(),
  lead: leadLabel.nullable(),
  blocking: z.boolean(),
  blockedReason: z.string().nullable(),
  workflowTaskKey: z.string().nullable(),
  checklist: z.object({ done: z.number(), total: z.number() }),
  counts: z.object({ notes: z.number(), files: z.number(), waitingOn: z.number() }),
  overlay: z
    .object({ label: z.string(), detail: z.string().nullable(), href: z.string(), state: z.string() })
    .nullable(),
});
export type CalendarItemDto = z.infer<typeof calendarItem>;

export const calendarRange = z.object({
  truncated: z.boolean(),
  items: z.array(calendarItem),
});

export const jobListItem = z.object({
  id: z.string(),
  jobNumber: z.string(),
  title: z.string(),
  currentStage: z.object({ name: z.string(), isClosed: z.boolean() }),
  lead: leadLabel.nullable(),
  projectManager: person.nullable(),
  taskCounts: z.object({ pending: z.number(), overdue: z.number() }).optional(),
});
export type JobListItemDto = z.infer<typeof jobListItem>;

export const jobList = z.object({
  data: z.array(jobListItem),
  total: z.number(),
});

export const jobDetail = z.object({
  id: z.string(),
  jobNumber: z.string(),
  title: z.string(),
  currentStage: z.object({ name: z.string(), isClosed: z.boolean() }),
  lead: leadLabel
    .extend({ email: z.string().nullish(), secondaryPhone: z.string().nullish() })
    .nullable(),
  projectManager: person.nullable(),
  salesRep: person.nullable(),
  targetStartDate: z.string().nullable(),
  nextAction: z.string().nullable(),
  /** What of the job's money this viewer sees (jobMoneyView): crew payments need "full". */
  moneyView: z.enum(["full", "price", "none"]).optional(),
});
export type JobDetailDto = z.infer<typeof jobDetail>;

const taskJob = z.object({ id: z.string(), jobNumber: z.string(), title: z.string(), lead: leadLabel.nullable() });

export const taskRow = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES),
  dueAt: z.string().nullable(),
  allDay: z.boolean(),
  scheduledStart: z.string().nullable(),
  blockedReason: z.string().nullable(),
  completedAt: z.string().nullable(),
  /** The concurrency token sent back with an edit (baseUpdatedAt). */
  updatedAt: z.string(),
  workflowTaskKey: z.string().nullable(),
  job: taskJob.nullable(),
  lead: leadLabel.nullable(),
  assignedTo: person.nullable(),
  createdBy: person.nullable(),
  _count: z.object({ events: z.number(), files: z.number() }),
});
export type TaskRowDto = z.infer<typeof taskRow>;

export const taskList = z.array(taskRow);

export const taskDetail = taskRow.extend({
  events: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      body: z.string().nullable(),
      fromValue: z.string().nullable(),
      toValue: z.string().nullable(),
      createdAt: z.string(),
      actor: person.nullable(),
    }),
  ),
  files: z.array(
    z.object({
      id: z.string(),
      fileName: z.string(),
      fileType: z.string(),
      fileSize: z.number(),
      category: z.string(),
      createdAt: z.string(),
    }),
  ),
  viewer: z.object({ canEdit: z.boolean() }),
  // Workflow steps (Phase 3). An ordinary task has none of these set.
  checklist: z
    .array(z.object({ key: z.string(), label: z.string(), done: z.boolean() }))
    .nullable()
    .optional(),
  /** What the step needs before it can be completed (ATTACHMENT, PHOTO, PERMIT_NUMBER…). */
  requiredEvidence: z.string().nullable().optional(),
  /** A blocking gate holds the steps after it until it is done. */
  blocking: z.boolean().optional(),
  /** Null on a workflow step still waiting on earlier steps. */
  activatedAt: z.string().nullable().optional(),
  workflowInstanceId: z.string().nullable().optional(),
});
export type TaskDetailDto = z.infer<typeof taskDetail>;

/** A file as GET /api/files lists it (lib/files/list.ts presentFiles). */
export const fileItem = z.object({
  id: z.string(),
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number(),
  category: z.string(),
  createdAt: z.string(),
  takenAt: z.string().nullish(),
  /** The record exists but the bytes are not in storage. */
  missing: z.boolean(),
});
export type FileItemDto = z.infer<typeof fileItem>;

/** GET /api/files?jobId= : the job's files and its lead's documents. */
export const jobFiles = z.object({
  files: z.array(fileItem),
  leadFiles: z.array(fileItem),
});

/** GET /api/users/assignable: names for an assignee picker. */
export const assignableUsers = z.array(
  z.object({ id: z.string(), firstName: z.string(), lastName: z.string(), role: z.object({ name: z.string() }) }),
);

/** POST /api/tasks from the phone: a manual task, optionally on a job. */
export const createTaskRequest = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
  jobId: z.string().optional(),
  assignedUserId: z.string().optional(),
  /** yyyy-MM-dd: an all-day task on that day. */
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(PRIORITIES).optional(),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequest>;

// ---------------------------------------------------------------------------
// Phase 3: inspections (GET /api/inspections, PATCH /api/inspections/[id]).
// ---------------------------------------------------------------------------

export const INSPECTION_TYPES = [
  "ROUGH",
  "FRAMING",
  "ELECTRICAL",
  "PLUMBING",
  "MECHANICAL",
  "ROOFING_IN_PROGRESS",
  "ROOFING_FINAL",
  "FINAL",
  "OTHER",
] as const;
export const INSPECTION_RESULTS = ["SCHEDULED", "PASS", "FAIL", "CONDITIONAL", "CANCELLED"] as const;

export const inspectionItem = z.object({
  id: z.string(),
  type: z.enum(INSPECTION_TYPES),
  result: z.enum(INSPECTION_RESULTS),
  scheduledFor: z.string().nullable(),
  completedAt: z.string().nullable(),
  inspectorName: z.string().nullable(),
  notes: z.string().nullable(),
  task: z.object({ id: z.string(), title: z.string(), status: z.string() }).nullable(),
  permit: z.object({
    id: z.string(),
    permitType: z.string().nullable(),
    permitNumber: z.string().nullable(),
    municipality: z.string().nullable(),
    job: z.object({ id: z.string(), jobNumber: z.string(), title: z.string(), lead: leadLabel.nullable() }),
  }),
});
export type InspectionDto = z.infer<typeof inspectionItem>;

export const inspectionList = z.array(inspectionItem);

/** PATCH /api/inspections/[id] with a result, as the phone sends it. */
export const recordInspectionRequest = z.object({
  result: z.enum(["PASS", "FAIL", "CONDITIONAL", "CANCELLED"]),
  notes: z.string().trim().max(4000).optional(),
  inspectorName: z.string().trim().max(200).optional(),
  completedAt: z.string().optional(),
});

/** What the CRM did with a recorded result. */
export const inspectionOutcome = inspectionItem.omit({ task: true, permit: true }).extend({
  workflow: z
    .object({
      applied: z.boolean().optional(),
      stepStatus: z.string().nullable().optional(),
      correctionTaskId: z.string().nullable().optional(),
      taskId: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  permitClosed: z.boolean().optional(),
});
export type InspectionOutcomeDto = z.infer<typeof inspectionOutcome>;

// ---------------------------------------------------------------------------
// Phase 3: field issues and punch items (GET/POST /api/jobs/[id]/field-issues,
// PATCH /api/field-issues/[id]). Photos go through POST /api/files with
// `fieldIssueId` and land on the issue's task.
// ---------------------------------------------------------------------------

export const FIELD_ISSUE_TYPES = ["PUNCH", "OFFICE_FOLLOW_UP", "SAFETY", "MATERIAL_REQUEST", "CO_REVIEW", "INSPECTION_REMINDER"] as const;

export const fieldIssue = z.object({
  id: z.string(),
  jobId: z.string(),
  type: z.enum(FIELD_ISSUE_TYPES),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(PRIORITIES),
  status: z.enum(TASK_STATUSES),
  dueAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  raisedBy: person,
  assignedTo: person.nullable(),
  task: z.object({ id: z.string(), status: z.string() }).nullable(),
});
export type FieldIssueDto = z.infer<typeof fieldIssue>;

export const fieldIssueList = z.array(fieldIssue);

/** A phone-made id: a letter then 19–31 lowercase letters or digits (as field photos use). */
export const CLIENT_ID = /^[a-z][a-z0-9]{19,31}$/;

export const createFieldIssueRequest = z.object({
  id: z.string().regex(CLIENT_ID),
  type: z.enum(FIELD_ISSUE_TYPES),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignedUserId: z.string().optional(),
  /** ISO instant. */
  dueAt: z.string().datetime().optional(),
});
export type CreateFieldIssueRequest = z.infer<typeof createFieldIssueRequest>;

/** Description with the location on its first line, as the web shows it. */
export function issueDescription(location: string | undefined, details: string | undefined): string | undefined {
  const parts = [location?.trim() ? `Location: ${location.trim()}` : "", details?.trim() ?? ""].filter(Boolean);
  return parts.length ? parts.join("\n\n") : undefined;
}

// ---------------------------------------------------------------------------
// Phase 3: daily log (GET/PUT /api/jobs/[id]/daily-logs/[date], POST …/submit;
// photos: POST /api/jobs/[id]/photos with logDate).
// ---------------------------------------------------------------------------

/** The write-up fields the phone edits, in the order the screen shows them. */
export const LOG_TEXT_FIELDS = [
  "workPerformed",
  "areasWorked",
  "delays",
  "safetyIssues",
  "materialsDelivered",
  "subcontractorsOnsite",
  "tomorrowPlan",
  "notes",
] as const;
export const LOG_SAFETY_CHECKS = ["safetyToolboxTalk", "safetyPpeVerified", "safetyHousekeeping"] as const;

export const dailyLog = z.object({
  id: z.string(),
  /** A log the office returned is DRAFT again, with `returnNote` set. */
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED"]),
  updatedAt: z.string(),
  logDate: z.string(),
  returnNote: z.string().nullable().optional(),
  weatherSummary: z.string().nullable().optional(),
  weatherTempHighF: z.number().nullable().optional(),
  weatherTempLowF: z.number().nullable().optional(),
  ...Object.fromEntries(LOG_TEXT_FIELDS.map((k) => [k, z.string().nullable().optional()])),
  ...Object.fromEntries(LOG_SAFETY_CHECKS.map((k) => [k, z.boolean().optional()])),
} as Record<string, z.ZodTypeAny>);
export type DailyLogDto = {
  id: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED";
  updatedAt: string;
  logDate: string;
  returnNote?: string | null;
  weatherSummary?: string | null;
  weatherTempHighF?: number | null;
  weatherTempLowF?: number | null;
} & Partial<Record<(typeof LOG_TEXT_FIELDS)[number], string | null>> &
  Partial<Record<(typeof LOG_SAFETY_CHECKS)[number], boolean>>;

/** PUT body from the phone: the write-up plus the copy it was based on. */
export const saveDailyLogRequest = z.object({
  ...Object.fromEntries(LOG_TEXT_FIELDS.map((k) => [k, z.string().max(10000).optional()])),
  ...Object.fromEntries(LOG_SAFETY_CHECKS.map((k) => [k, z.boolean().optional()])),
  /** The log's updatedAt as the phone last saw it; absent for a new log. */
  baseUpdatedAt: z.string().optional(),
} as Record<string, z.ZodTypeAny>);

// ---------------------------------------------------------------------------
// Phase 3: crew hours (PUT /api/jobs/[id]/daily-logs/[date]/labor, full-sheet
// replace by phone-made entry id; GET /api/personnel?activeOnly=true).
// ---------------------------------------------------------------------------

/**
 * Every field of a sheet entry the CRM takes back. A save replaces the whole
 * day's sheet, so the phone sends each of these as the server last had it
 * (cost code, phase, budget line and area may have been set by the office)
 * and changes only what the person changed. Rates are never sent: the CRM
 * refreshes them from the worker's profile, as for the web's crew sheet.
 */
export const LABOR_INPUT_FIELDS = [
  "id",
  "personnelId",
  "trade",
  "jobAreaId",
  "workArea",
  "startMinutes",
  "endMinutes",
  "breakMinutes",
  "costCodeId",
  "phase",
  "budgetLineId",
  "isAbsent",
  "isLate",
  "leftEarly",
  "absenceReason",
  "notes",
] as const;

export const laborEntryInput = z.object({
  id: z.string().regex(CLIENT_ID),
  personnelId: z.string().min(1),
  trade: z.string().max(80).nullable().optional(),
  jobAreaId: z.string().max(40).nullable().optional(),
  workArea: z.string().max(160).nullable().optional(),
  /** Minutes after midnight; past 1440 means the next day. */
  startMinutes: z.number().int().min(0).max(2879).nullable().optional(),
  endMinutes: z.number().int().min(0).max(2879).nullable().optional(),
  breakMinutes: z.number().int().min(0).max(600),
  costCodeId: z.string().max(40).nullable().optional(),
  phase: z.string().max(80).nullable().optional(),
  budgetLineId: z.string().max(40).nullable().optional(),
  isAbsent: z.boolean(),
  isLate: z.boolean(),
  leftEarly: z.boolean(),
  absenceReason: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type LaborEntryInput = z.infer<typeof laborEntryInput>;

export const laborEntry = laborEntryInput.extend({
  id: z.string(),
  totalHours: z.number(),
  regularHours: z.number(),
  otHours: z.number(),
  personnel: z
    .object({ id: z.string(), firstName: z.string(), lastName: z.string() })
    .passthrough()
    .nullable()
    .optional(),
});
export type LaborEntryDto = z.infer<typeof laborEntry>;

export const saveLaborSheetRequest = z.object({
  entries: z.array(laborEntryInput).max(300),
  baseUpdatedAt: z.string().optional(),
});

/** The crew list, keeping only what the phone shows (never pay details). */
export const crewMember = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  trade: z.string().nullable().optional(),
  crew: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
});
export const crewList = z.array(crewMember);
export type CrewMemberDto = z.infer<typeof crewMember>;

/** The log with its sheet, for the crew hours screen. */
export const dailyLogWithSheet = z
  .object({
    id: z.string(),
    status: z.enum(["DRAFT", "SUBMITTED", "APPROVED"]),
    updatedAt: z.string(),
    entries: z.array(laborEntry),
    totals: z.object({ workersOnsite: z.number(), totalHours: z.number(), regularHours: z.number(), otHours: z.number() }),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Phase 4: AI drafts from speech (POST /api/mobile/ai/task-draft, …/log-draft).
// The phone sends text (iOS dictation turns speech into text on the phone);
// the CRM's AI returns a draft the person checks. Nothing is saved by these.
// ---------------------------------------------------------------------------

export const taskDraftRequest = z.object({
  speech: z.string().trim().min(3).max(4000),
  /** The job the person was on, if any. */
  jobId: z.string().max(40).optional(),
});

export const taskDraft = z.object({
  title: z.string(),
  description: z.string().nullable(),
  jobId: z.string().nullable(),
  jobLabel: z.string().nullable(),
  assignedUserId: z.string().nullable(),
  assigneeLabel: z.string().nullable(),
  dueDate: z.string().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  unclear: z.array(z.string()),
});
export type TaskDraftDto = z.infer<typeof taskDraft>;

export const logDraftRequest = z.object({
  jobId: z.string().min(1).max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  speech: z.string().trim().min(3).max(4000),
});

export const logDraft = z.object({
  ...Object.fromEntries(LOG_TEXT_FIELDS.map((k) => [k, z.string().optional()])),
  ...Object.fromEntries(LOG_SAFETY_CHECKS.map((k) => [k, z.boolean().optional()])),
} as Record<string, z.ZodTypeAny>);
export type LogDraftDto = Partial<Record<(typeof LOG_TEXT_FIELDS)[number], string>> &
  Partial<Record<(typeof LOG_SAFETY_CHECKS)[number], boolean>>;

// ---------------------------------------------------------------------------
// Job files on the phone: photos (GET /api/jobs/[id]/gallery) and documents
// uploaded from the phone (POST /api/files with jobId + category).
// ---------------------------------------------------------------------------

export const galleryItem = z.object({
  key: z.string(),
  source: z.string(),
  id: z.string(),
  /** Where the image is served (needs the sign-in header). */
  url: z.string(),
  fileName: z.string(),
  day: z.string(),
  at: z.string(),
  category: z.string().nullable(),
  caption: z.string().nullable(),
  area: z.string().nullable(),
  by: z.object({ firstName: z.string(), lastName: z.string() }),
  /** "Daily log · Sep 3", "Task · …", "Crew payment · BNW" (the amount only for those who see crew pay). */
  origin: z.string(),
  missing: z.boolean(),
});
export const jobGallery = z.object({ items: z.array(galleryItem), canWrite: z.boolean() });
export type GalleryItemDto = z.infer<typeof galleryItem>;

/** Mirrors lib/files/limits.ts (the contract test keeps them equal). */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const UPLOAD_MIME = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
] as const;

/** What a document uploaded from the phone may be filed as. Contracts and plan sets stay web-only. */
export const PHONE_DOC_CATEGORIES = [
  { value: "PERMIT", label: "Permit" },
  { value: "INSPECTION", label: "Inspection" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "OTHER", label: "Other" },
] as const;

// ---------------------------------------------------------------------------
// Phase 5: owner summary (GET /api/attention/owner, GET /api/attention,
// GET /api/attention/[key]) — the dashboard's numbers on the phone, for the
// roles the dashboard shows them to (canViewCompanyFinancials). Not kept in
// the phone's saved copy: company money.
// ---------------------------------------------------------------------------

export const ownerSummary = z.object({
  scope: z.enum(["mine", "all"]),
  newLeadsToday: z.number(),
  uncontacted: z.number(),
  pipeline: z.object({ leads: z.number(), value: z.number() }),
  estimatesOut: z.object({ count: z.number(), total: z.number() }),
  activeJobs: z.number(),
  expectedGrossProfit: z.object({ total: z.number(), jobs: z.number(), jobsWithoutBaseline: z.number() }),
});
export type OwnerSummaryDto = z.infer<typeof ownerSummary>;

const tone = z.enum(["danger", "warning", "info", "neutral", "success"]);
export const attentionCounts = z.object({
  scope: z.enum(["mine", "all"]),
  rows: z.array(z.object({ key: z.string(), label: z.string(), tone, count: z.number(), href: z.string() })),
});
export type AttentionCountDto = z.infer<typeof attentionCounts>["rows"][number];

export const attentionList = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  scope: z.enum(["mine", "all"]),
  count: z.number(),
  items: z.array(
    z.object({
      id: z.string(),
      primary: z.string(),
      secondary: z.string().nullable(),
      code: z.string().nullable(),
      detail: z.string(),
      date: z.string().nullable(),
      href: z.string(),
    }),
  ),
});
export type AttentionListDto = z.infer<typeof attentionList>;

/** Who sees the owner summary (mirrors canViewCompanyFinancials; the contract test keeps them equal). */
export const OWNER_ROLES = ["ADMIN", "MANAGER", "OFFICE_STAFF", "READ_ONLY"] as const;


// ---------------------------------------------------------------------------
// Phase 5: crew payment requests (GET /api/jobs/[id]/labor-contracts,
// GET|POST /api/labor-contracts/[id]/payment-requests) — for the job's full
// money viewers (office roles, the job's PM). Read live, never kept offline.
// ---------------------------------------------------------------------------

const money = z.union([z.string(), z.number()]).transform((v) => Number(v));

export const phoneLaborContract = z.object({
  id: z.string(),
  label: z.string().nullable(),
  crew: z.object({ name: z.string() }).nullable(),
  vendor: z.object({ name: z.string() }).nullable(),
  contractAmount: money,
  changeOrders: z.array(z.object({ amount: money })),
  payments: z.array(z.object({ amount: money, paidDate: z.string() })),
});
export const phoneLaborContracts = z.array(phoneLaborContract);
export type PhoneLaborContractDto = z.infer<typeof phoneLaborContract>;

export const PAYMENT_REQUEST_STATUSES = ["REQUESTED", "PAID", "CANCELLED", "CLOSED_UNPAID"] as const;
export const paymentRequestList = z.object({
  requests: z.array(
    z.object({
      id: z.string(),
      amount: money,
      note: z.string().nullable(),
      neededBy: z.string().nullable(),
      status: z.enum(PAYMENT_REQUEST_STATUSES),
      createdAt: z.string(),
      requestedBy: z.object({ firstName: z.string(), lastName: z.string() }).nullable(),
    }),
  ),
  defaultAssigneeId: z.string().nullable(),
});
export type PaymentRequestDto = z.infer<typeof paymentRequestList>["requests"][number];

export const createPaymentRequestBody = z.object({
  amount: z.number().positive().max(10_000_000),
  note: z.string().trim().max(2000).optional(),
  /** yyyy-MM-dd */
  neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Material requests are field issues of type MATERIAL_REQUEST (the CRM routes
// an unassigned one to the job's Purchasing person); the lines go in the text.
export const materialLine = z.object({
  qty: z.string().trim().max(20),
  unit: z.string().trim().max(20),
  item: z.string().trim().min(1).max(200),
});
export type MaterialLine = z.infer<typeof materialLine>;
