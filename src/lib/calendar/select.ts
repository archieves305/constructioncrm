import type { Prisma } from "@/generated/prisma/client";
import { JOB_LABEL_SELECT, LEAD_LABEL_SELECT } from "@/lib/labels/select";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";

/**
 * What one calendar card needs, and nothing a week of them does not. One
 * `findMany` with filtered relation counts: notes, files and how many open
 * blocking predecessors the step is still waiting on. No N+1.
 */
const LEAD_WITH_PHONE = { ...LEAD_LABEL_SELECT, primaryPhone: true } satisfies Prisma.LeadSelect;

export const CALENDAR_ITEM_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueAt: true,
  scheduledStart: true,
  allDay: true,
  completedAt: true,
  assignedUserId: true,
  createdByUserId: true,
  blocking: true,
  blockedReason: true,
  dueLocked: true,
  workflowTaskKey: true,
  workflowModuleKey: true,
  workflowPhaseKey: true,
  checklist: true,
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  job: { select: { ...JOB_LABEL_SELECT, lead: { select: LEAD_WITH_PHONE } } },
  lead: { select: LEAD_WITH_PHONE },
  violationCase: { select: { id: true, caseNumber: true, agencyCaseNumber: true, leadId: true } },
  _count: {
    select: {
      events: { where: { type: "NOTE" } },
      files: true,
      dependencies: { where: { kind: "BLOCKING", dependsOn: { status: { in: [...OPEN_TASK_STATUSES] } } } },
    },
  },
} satisfies Prisma.TaskSelect;

export type CalendarRow = Prisma.TaskGetPayload<{ select: typeof CALENDAR_ITEM_SELECT }>;
