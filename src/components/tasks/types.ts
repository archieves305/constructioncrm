import type { Priority, TaskStatus } from "@/generated/prisma/client";

export type { Priority, TaskStatus };

export type Person = { id: string; firstName: string; lastName: string };

export type UserOption = Person & { isActive: boolean; role?: { name: string } };

/** What `/api/tasks` returns — `TaskListRow` with dates as ISO strings. */
export type TaskListItem = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueAt: string | null;
  completedAt?: string | null;
  blockedReason: string | null;
  assignedUserId?: string | null;
  createdByUserId?: string;
  remindAt?: string | null;
  sourceKey?: string | null;
  lead: { id: string; fullName: string } | null;
  job: { id: string; jobNumber: string; title: string } | null;
  estimate?: { id: string; estimateNumber: string; name: string; leadId: string } | null;
  invoice?: { id: string; invoiceNumber: string; jobId: string } | null;
  prospect?: { id: string; propertyAddress1: string; city: string } | null;
  dailyLog?: { id: string; jobId: string; logDate: string } | null;
  assignedTo: Person | null;
  createdBy?: Person | null;
  _count?: { events: number; files?: number; dependents?: number };
  // ── Workflow metadata (null/absent on an ordinary task) ──
  workflowInstanceId?: string | null;
  workflowTaskKey?: string | null;
  workflowPhaseKey?: string | null;
  workflowModuleKey?: string | null;
  workflowRole?: string | null;
  blocking?: boolean;
  activatedAt?: string | null;
  dueLocked?: boolean;
  skipReason?: string | null;
  inspectionResult?: string | null;
};

/**
 * The record a task hangs off. One id is the anchor; `label` is what the
 * chip says; `href` is where the chip goes. Passed to the dialog so the link
 * is pre-filled and shown, and to the panel so it knows what to list.
 */
export type TaskEntityContext = {
  leadId?: string;
  jobId?: string;
  estimateId?: string;
  invoiceId?: string;
  prospectId?: string;
  dailyLogId?: string;
  label: string;
  href?: string;
};

export type EntityLinkKey = "leadId" | "jobId" | "estimateId" | "invoiceId" | "prospectId" | "dailyLogId";

/** Most specific link first — that is the one the panel filters on. */
export const ENTITY_LINK_KEYS: EntityLinkKey[] = [
  "dailyLogId",
  "invoiceId",
  "estimateId",
  "prospectId",
  "jobId",
  "leadId",
];

export function primaryLink(ctx: TaskEntityContext): { key: EntityLinkKey; id: string } | null {
  for (const key of ENTITY_LINK_KEYS) {
    const id = ctx[key];
    if (id) return { key, id };
  }
  return null;
}

export type UpdatePatch = Partial<{
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  assignedUserId: string | null;
  dueAt: string | null;
  blockedReason: string | null;
  remindAt: string | null;
  // Workflow steps
  skipReason: string | null;
  dueLocked: boolean;
  checklist: { key: string; done: boolean }[];
  evidenceOverrideReason: string;
}>;

export type CreateTaskPayload = {
  title: string;
  description?: string;
  priority?: Priority;
  dueAt?: string;
  assignedUserId?: string;
  watcherUserIds?: string[];
  remindAt?: string;
} & Partial<Record<EntityLinkKey, string>>;

export function fullName(p: Person | null | undefined): string {
  if (!p) return "";
  return `${p.firstName} ${p.lastName}`.trim();
}

export function shortName(p: Person | null | undefined): string {
  if (!p) return "";
  const last = p.lastName?.trim();
  return last ? `${p.firstName} ${last.charAt(0)}.` : p.firstName;
}
