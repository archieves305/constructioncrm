import type { DeliveryClass, NotificationCategory, Priority } from "@/generated/prisma/client";
import type { RecipientReason } from "@/lib/tasks/recipients";

/**
 * The registry of notification kinds: what each one is, which category a
 * person can mute it under, where it lands in a digest, and how it is
 * delivered by default. Pure and client-safe.
 *
 * `kind` is a string in the database on purpose — adding a kind is a line
 * here, not a migration. Nothing outside this file may invent a kind.
 */

export const NOTIFICATION_KINDS = [
  "task.assigned",
  "task.reassigned",
  "task.ready",
  "task.completed",
  "task.blocked",
  "task.mentioned",
  "task.nudged",
  "task.overdue",
  "task.due_today",
  "task.reminder",
  "task.escalated",
  "task.checklist_updated",
  "case.assigned",
  "case.item_assigned",
  "case.inspection_scheduled",
  "case.agency_confirmed",
  "case.closed",
  "case.deadline",
  "case.escalated",
  "daily_log.draft_reminder",
  "field.ops_digest",
  "contract.outcome",
  "lead.follow_up",
  "lead.new",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export function isNotificationKind(s: string): s is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(s);
}

/** Digest sections, in the order they render. Action first, chatter last. */
export const DIGEST_SECTIONS = [
  "ACTION_REQUIRED",
  "TODAY",
  "ASSIGNED",
  "JOB_UPDATES",
  "COMPLETED",
  "UPCOMING",
  "OTHER",
] as const;
export type DigestSection = (typeof DIGEST_SECTIONS)[number];

export const DIGEST_SECTION_LABEL: Record<DigestSection, string> = {
  ACTION_REQUIRED: "Action required",
  TODAY: "Today",
  ASSIGNED: "Assigned to you",
  JOB_UPDATES: "Job updates",
  COMPLETED: "Completed work",
  UPCOMING: "Upcoming",
  OTHER: "Other activity",
};

/**
 * What the producer knew at the moment of the event. Everything optional:
 * the classifier only upgrades on what it is told, never on what it guesses.
 * Dates are ISO strings so the object survives a JSON column round trip.
 */
export type Signals = {
  taskPriority?: Priority | null;
  dueAt?: string | null;
  blocking?: boolean;
  inspectionResult?: "PASS" | "FAIL" | "CONDITIONAL" | null;
  emergency?: boolean;
  severity?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | null;
  /** Days until the case's compliance deadline; negative when overdue. */
  deadlineDays?: number | null;
  /** When an inspection / hearing is scheduled for. */
  scheduledFor?: string | null;
  escalationLevel?: number | null;
  /** True when the underlying task was created by an engine (workflow, stage template, auto rule). */
  engineTask?: boolean;
};

export type ImmediateContext = { now: Date; tz: string };

export type KindSpec = {
  label: string;
  category: NotificationCategory;
  section: DigestSection;
  defaultClass: DeliveryClass;
  /** Returns a short reason when the event should jump the digest, else null. */
  immediateWhen?: (s: Signals, reason: RecipientReason, ctx: ImmediateContext) => string | null;
  /** Person-to-person or genuinely urgent kinds never get demoted by caps or storms. */
  neverDemote?: boolean;
  /** Rows of this kind sharing a batch key collapse to one digest line. */
  collapsible: boolean;
  /** Puts the item under ACTION REQUIRED regardless of its home section. */
  actionRequired: (s: Signals, reason: RecipientReason) => boolean;
};

const HOUR = 3_600_000;

function dueSoon(s: Signals, ctx: ImmediateContext): boolean {
  if (!s.dueAt) return false;
  const due = Date.parse(s.dueAt);
  if (Number.isNaN(due)) return false;
  // "Due today" without a time zone lookup: within the next 24h or already past.
  return due - ctx.now.getTime() <= 24 * HOUR;
}

function urgentTask(s: Signals, ctx: ImmediateContext): string | null {
  if (s.taskPriority === "URGENT") return "priority URGENT";
  if (s.blocking) return "blocking gate";
  if (dueSoon(s, ctx)) return "due today or overdue";
  return null;
}

function criticalCase(s: Signals): string | null {
  if (s.emergency) return "emergency case";
  if (s.severity === "CRITICAL") return "severity CRITICAL";
  if (typeof s.deadlineDays === "number" && s.deadlineDays <= 1) return "deadline within a day";
  return null;
}

function within24h(s: Signals, ctx: ImmediateContext): boolean {
  if (!s.scheduledFor) return false;
  const at = Date.parse(s.scheduledFor);
  return !Number.isNaN(at) && at - ctx.now.getTime() <= 24 * HOUR;
}

const ownerLike = (reason: RecipientReason) =>
  reason === "assignee" || reason === "mentioned" || reason === "manager" || reason === "owner";

export const KINDS: Record<NotificationKind, KindSpec> = {
  "task.assigned": {
    label: "Task assigned",
    category: "TASKS",
    section: "ASSIGNED",
    defaultClass: "DIGEST",
    immediateWhen: (s, _r, ctx) => urgentTask(s, ctx),
    collapsible: true,
    actionRequired: (s) => s.taskPriority === "URGENT" || Boolean(s.blocking),
  },
  "task.reassigned": {
    label: "Task reassigned",
    category: "TASKS",
    section: "ASSIGNED",
    defaultClass: "DIGEST",
    immediateWhen: (s, _r, ctx) => urgentTask(s, ctx),
    collapsible: true,
    actionRequired: (s) => s.taskPriority === "URGENT" || Boolean(s.blocking),
  },
  "task.ready": {
    label: "Workflow step ready",
    category: "TASKS",
    section: "ASSIGNED",
    defaultClass: "DIGEST",
    immediateWhen: (s, _r, ctx) => urgentTask(s, ctx),
    collapsible: true,
    actionRequired: (s) => s.taskPriority === "URGENT" || Boolean(s.blocking),
  },
  "task.completed": {
    label: "Task completed",
    category: "JOB_ACTIVITY",
    section: "COMPLETED",
    defaultClass: "DIGEST",
    collapsible: true,
    actionRequired: () => false,
  },
  "task.blocked": {
    label: "Task blocked",
    category: "TASKS",
    section: "ACTION_REQUIRED",
    defaultClass: "DIGEST",
    immediateWhen: (s) =>
      s.blocking ? "blocking gate blocked" : s.inspectionResult === "FAIL" ? "inspection failed" : s.taskPriority === "URGENT" ? "priority URGENT" : null,
    collapsible: false,
    actionRequired: (_s, r) => ownerLike(r),
  },
  "task.mentioned": {
    label: "Mentioned in a note",
    category: "MENTIONS",
    section: "ACTION_REQUIRED",
    defaultClass: "IMMEDIATE",
    neverDemote: true,
    collapsible: false,
    actionRequired: () => true,
  },
  "task.nudged": {
    label: "Nudge",
    category: "MENTIONS",
    section: "ACTION_REQUIRED",
    defaultClass: "IMMEDIATE",
    neverDemote: true,
    collapsible: false,
    actionRequired: () => true,
  },
  "task.overdue": {
    label: "Task overdue",
    category: "REMINDERS",
    section: "ACTION_REQUIRED",
    defaultClass: "DIGEST",
    collapsible: false,
    actionRequired: () => true,
  },
  "task.due_today": {
    label: "Task due today",
    category: "REMINDERS",
    section: "TODAY",
    defaultClass: "DIGEST",
    collapsible: false,
    actionRequired: () => false,
  },
  "task.reminder": {
    label: "Reminder",
    category: "REMINDERS",
    section: "TODAY",
    defaultClass: "DIGEST",
    collapsible: false,
    actionRequired: () => true,
  },
  "task.escalated": {
    label: "Overdue task escalated",
    category: "ESCALATIONS",
    section: "ACTION_REQUIRED",
    defaultClass: "IMMEDIATE",
    neverDemote: true,
    collapsible: false,
    actionRequired: () => true,
  },
  "task.checklist_updated": {
    label: "Checklist updated",
    category: "JOB_ACTIVITY",
    section: "OTHER",
    defaultClass: "IN_APP_ONLY",
    collapsible: true,
    actionRequired: () => false,
  },
  "case.assigned": {
    label: "Violation case assigned",
    category: "VIOLATIONS",
    section: "ASSIGNED",
    defaultClass: "DIGEST",
    immediateWhen: (s) => criticalCase(s),
    neverDemote: false,
    collapsible: false,
    actionRequired: () => true,
  },
  "case.item_assigned": {
    label: "Violation item assigned",
    category: "VIOLATIONS",
    section: "ASSIGNED",
    defaultClass: "DIGEST",
    immediateWhen: (s) => criticalCase(s),
    collapsible: true,
    actionRequired: () => true,
  },
  "case.inspection_scheduled": {
    label: "Agency inspection scheduled",
    category: "VIOLATIONS",
    section: "UPCOMING",
    defaultClass: "DIGEST",
    immediateWhen: (s, _r, ctx) => (within24h(s, ctx) ? "inspection within 24h" : null),
    collapsible: false,
    actionRequired: () => false,
  },
  "case.agency_confirmed": {
    label: "Agency confirmed compliance",
    category: "VIOLATIONS",
    section: "JOB_UPDATES",
    defaultClass: "DIGEST",
    collapsible: false,
    actionRequired: () => false,
  },
  "case.closed": {
    label: "Violation case closed",
    category: "VIOLATIONS",
    section: "JOB_UPDATES",
    defaultClass: "DIGEST",
    collapsible: false,
    actionRequired: () => false,
  },
  "case.deadline": {
    label: "Violation deadline",
    category: "REMINDERS",
    section: "UPCOMING",
    defaultClass: "DIGEST",
    immediateWhen: (s) => criticalCase(s),
    collapsible: false,
    actionRequired: (s) => typeof s.deadlineDays === "number" && s.deadlineDays <= 3,
  },
  "case.escalated": {
    label: "Violation deadline escalated",
    category: "ESCALATIONS",
    section: "ACTION_REQUIRED",
    defaultClass: "IMMEDIATE",
    neverDemote: true,
    collapsible: false,
    actionRequired: () => true,
  },
  "daily_log.draft_reminder": {
    label: "Daily log not submitted",
    category: "REMINDERS",
    section: "ACTION_REQUIRED",
    defaultClass: "DIGEST",
    collapsible: true,
    actionRequired: () => true,
  },
  "field.ops_digest": {
    label: "Field operations digest",
    category: "JOB_ACTIVITY",
    section: "OTHER",
    defaultClass: "IMMEDIATE",
    collapsible: false,
    actionRequired: () => false,
  },
  "contract.outcome": {
    label: "Contract signed or declined",
    category: "JOB_ACTIVITY",
    section: "JOB_UPDATES",
    defaultClass: "IMMEDIATE",
    neverDemote: true,
    collapsible: false,
    actionRequired: () => false,
  },
  "lead.follow_up": {
    label: "Follow-up rule fired",
    category: "JOB_ACTIVITY",
    section: "OTHER",
    defaultClass: "IN_APP_ONLY",
    collapsible: false,
    actionRequired: () => false,
  },
  "lead.new": {
    label: "New lead assigned",
    category: "JOB_ACTIVITY",
    section: "ASSIGNED",
    defaultClass: "IN_APP_ONLY",
    collapsible: false,
    actionRequired: () => true,
  },
};

export const NOTIFICATION_CATEGORIES = ["TASKS", "MENTIONS", "REMINDERS", "ESCALATIONS", "VIOLATIONS", "JOB_ACTIVITY"] as const;

export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, { title: string; help: string }> = {
  TASKS: { title: "Task assignments", help: "Work handed to you, steps that become ready, and blocked work." },
  MENTIONS: { title: "Mentions and nudges", help: "Someone @mentioned you in a note or is checking in on a task. Always sent right away." },
  REMINDERS: { title: "Due dates and deadlines", help: "Overdue and due-today work, your own reminders, violation deadlines." },
  ESCALATIONS: { title: "Escalations", help: "Overdue work that reached the raiser or the managers." },
  VIOLATIONS: { title: "Code violations", help: "Case and item assignments, inspections, agency confirmations, closures." },
  JOB_ACTIVITY: { title: "Job activity", help: "Completed work and other progress on jobs you are involved in." },
};
