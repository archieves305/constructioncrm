import { APP_TIME_ZONE, dayKey } from "@/lib/time/zone";
import type { CalendarRow } from "./select";
import { deriveCalendarStatus } from "./status";
import type { CalendarItem } from "./types";

/** Count the checklist without importing the evidence module (it pulls in Prisma). */
function checklistCounts(raw: unknown): { done: number; total: number } {
  if (!Array.isArray(raw)) return { done: 0, total: 0 };
  let done = 0;
  for (const c of raw) if (c && typeof c === "object" && (c as { done?: unknown }).done === true) done++;
  return { done, total: raw.length };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** One Prisma row → one wire item. Pure. */
export function toCalendarItem(row: CalendarRow, now: Date = new Date(), tz: string = APP_TIME_ZONE): CalendarItem {
  const start = row.scheduledStart ?? row.dueAt;
  return {
    kind: "task",
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    derived: deriveCalendarStatus(row, now, tz),
    allDay: row.allDay,
    start: iso(start),
    end: iso(row.dueAt),
    dayKey: row.dueAt ? dayKey(row.dueAt, tz) : null,
    startDayKey: start ? dayKey(start, tz) : null,
    dueAt: iso(row.dueAt),
    scheduledStart: iso(row.scheduledStart),
    completedAt: iso(row.completedAt),
    assignedUserId: row.assignedUserId,
    createdByUserId: row.createdByUserId,
    assignedTo: row.assignedTo,
    job: row.job,
    lead: row.lead,
    violationCase: row.violationCase,
    blocking: row.blocking,
    blockedReason: row.blockedReason,
    dueLocked: row.dueLocked,
    workflowTaskKey: row.workflowTaskKey,
    workflowModuleKey: row.workflowModuleKey,
    workflowPhaseKey: row.workflowPhaseKey,
    checklist: checklistCounts(row.checklist),
    counts: { notes: row._count.events, files: row._count.files, waitingOn: row._count.dependencies },
    overlay: null,
  };
}
