import type { RoleName } from "@/generated/prisma/client";
import type { ListScope } from "@/lib/lists/scope";
import type { Tone } from "@/lib/ui/tones";

/**
 * The dashboard's "Needs attention" rows. Pure and client-safe: what each row
 * is called, who sees it and where it opens. The queries live in `load.ts`,
 * and a row's count and its list are built from the same `where`, so the
 * number on the dashboard is always the length of the list it opens.
 *
 * Explicit role lists, never `hasMinRole`. A row is shown only to a role that
 * can act on it — more rows than that is the noise this block replaces.
 */

export const ATTENTION_KEYS = [
  "overdue-tasks",
  "inspections-to-correct",
  "violation-deadlines",
  "permits-expiring",
  "permits-waiting",
  "vendor-compliance",
  "overdue-follow-ups",
  "change-orders-awaiting",
  "contracts-awaiting",
  "pending-expenses",
  "logs-awaiting",
  "deposits-missing",
  "quiet-jobs",
] as const;
export type AttentionKey = (typeof ATTENTION_KEYS)[number];

/** Violation deadlines this close (or past) are on the list. */
export const VIOLATION_DEADLINE_DAYS = 14;
/** A permit in force that lapses within this many days — the same window the permit alerts use. */
export const PERMIT_EXPIRING_DAYS = 30;
/** A permit still not issued this long after it was submitted. */
export const PERMIT_WAITING_DAYS = 14;
/** An open job nobody has touched for this long. */
export const QUIET_JOB_DAYS = 14;

const OFFICE: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];
const PRODUCTION: readonly RoleName[] = [...OFFICE, "SALES_REP"];
const PRODUCTION_VIEW: readonly RoleName[] = [...PRODUCTION, "READ_ONLY"];
const EVERYONE: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "MARKETING", "READ_ONLY", "CREW_LEAD"];

export type AttentionRowDef = {
  key: AttentionKey;
  label: string;
  /** One line under the list page's title saying exactly what is counted. */
  description: string;
  tone: Tone;
  roles: readonly RoleName[];
};

export const ATTENTION_ROWS: readonly AttentionRowDef[] = [
  { key: "overdue-tasks", label: "Overdue tasks", description: "Open tasks past their due date.", tone: "danger", roles: EVERYONE },
  {
    key: "inspections-to-correct",
    label: "Inspections to correct",
    description: "Inspections that failed or passed with conditions, where the correction is still open.",
    tone: "danger",
    roles: PRODUCTION_VIEW,
  },
  {
    key: "violation-deadlines",
    label: "Violation deadlines",
    description: `Open code-violation cases whose compliance deadline has passed or falls within ${VIOLATION_DEADLINE_DAYS} days, and the agency has not confirmed compliance.`,
    tone: "danger",
    roles: PRODUCTION_VIEW,
  },
  {
    key: "permits-expiring",
    label: "Permits expiring",
    description: `Permits on open jobs that have expired or expire within ${PERMIT_EXPIRING_DAYS} days.`,
    tone: "warning",
    roles: PRODUCTION_VIEW,
  },
  {
    key: "permits-waiting",
    label: "Permits not issued",
    description: `Permits on open jobs submitted more than ${PERMIT_WAITING_DAYS} days ago and still not issued.`,
    tone: "warning",
    roles: PRODUCTION_VIEW,
  },
  {
    key: "vendor-compliance",
    label: "Subcontractors missing documents",
    description: "Active subcontractors with insurance, workers' comp or a W-9 missing, expired or expiring within 30 days. Nothing is blocked; this is the list to chase.",
    tone: "warning",
    roles: OFFICE,
  },
  {
    key: "overdue-follow-ups",
    label: "Overdue follow-ups",
    description: "Open leads whose next follow-up date has passed.",
    tone: "warning",
    roles: [...PRODUCTION, "MARKETING"],
  },
  {
    key: "change-orders-awaiting",
    label: "Change orders awaiting approval",
    description: "Change orders sent to the customer and not yet approved or rejected.",
    tone: "warning",
    roles: PRODUCTION_VIEW,
  },
  {
    key: "contracts-awaiting",
    label: "Contracts awaiting signature",
    description: "Customer contracts sent and not yet signed or declined.",
    tone: "warning",
    roles: PRODUCTION_VIEW,
  },
  {
    key: "pending-expenses",
    label: "Expenses to approve",
    description: "Job costs entered and waiting for approval. They count toward nothing until approved.",
    tone: "warning",
    roles: OFFICE,
  },
  {
    key: "logs-awaiting",
    label: "Daily logs to review",
    description: "Daily logs submitted from the field and not yet approved.",
    tone: "info",
    roles: OFFICE,
  },
  {
    key: "deposits-missing",
    label: "Deposits missing",
    description: "Open jobs where less than the required deposit has been received.",
    tone: "warning",
    roles: [...OFFICE, "READ_ONLY"],
  },
  {
    key: "quiet-jobs",
    label: "Quiet jobs",
    description: `Open jobs with no edit, stage change, task activity, daily log, payment or cost in the last ${QUIET_JOB_DAYS} days.`,
    tone: "neutral",
    roles: PRODUCTION_VIEW,
  },
];

export function isAttentionKey(s: unknown): s is AttentionKey {
  return typeof s === "string" && (ATTENTION_KEYS as readonly string[]).includes(s);
}

export function attentionRow(key: AttentionKey): AttentionRowDef {
  return ATTENTION_ROWS.find((r) => r.key === key)!;
}

/** The rows a role is shown, in display order. */
export function attentionRowsFor(role: RoleName | null | undefined): AttentionRowDef[] {
  if (!role) return [];
  return ATTENTION_ROWS.filter((r) => r.roles.includes(role));
}

export function canSeeAttentionRow(role: RoleName | null | undefined, key: AttentionKey): boolean {
  return !!role && attentionRow(key).roles.includes(role);
}

/**
 * Where a row opens. Overdue tasks already have a list that means exactly
 * this; every other row opens its own list under /attention.
 */
export function attentionHref(key: AttentionKey, scope: ListScope): string {
  if (key === "overdue-tasks") return scope === "mine" ? "/tasks?overdue=1&assignedUserId=me" : "/tasks?overdue=1&scope=all";
  return `/attention/${key}?scope=${scope}`;
}

export type AttentionCount = { key: AttentionKey; label: string; tone: Tone; count: number; href: string };

export type AttentionItem = {
  id: string;
  /** Address-first name of the record. */
  primary: string;
  secondary: string | null;
  code: string | null;
  /** What about it needs attention: "Roofing permit · expires Oct 12". */
  detail: string;
  /** ISO date the row is sorted and aged by, when it has one. */
  date: string | null;
  href: string;
};

export type AttentionList = {
  key: AttentionKey;
  label: string;
  description: string;
  scope: ListScope;
  count: number;
  items: AttentionItem[];
};

/** How many records a list page shows; the count above it is always the full number. */
export const ATTENTION_LIST_LIMIT = 200;

/** Rows worth showing: something to do, most severe first, then the order above. */
export function visibleAttention(rows: AttentionCount[]): AttentionCount[] {
  const rank: Record<Tone, number> = { danger: 0, warning: 1, info: 2, neutral: 3, success: 4 };
  return rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.count > 0)
    .sort((a, b) => rank[a.r.tone] - rank[b.r.tone] || a.i - b.i)
    .map(({ r }) => r);
}
