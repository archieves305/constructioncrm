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
