import type { CalendarItem, CalendarPerson } from "./types";

/** A CalendarItem for tests: an open all-day task on 2026-09-29 unless said otherwise. */
export function makeItem(over: Partial<CalendarItem> = {}): CalendarItem {
  const dueAt = over.dueAt === undefined ? "2026-09-29T12:00:00.000Z" : over.dueAt;
  const scheduledStart = over.scheduledStart ?? null;
  const allDay = over.allDay ?? true;
  const start = scheduledStart ?? dueAt;
  return {
    kind: "task",
    id: "t1",
    title: "Roof tear-off",
    description: null,
    status: "PENDING",
    priority: "MEDIUM",
    derived: "not_started",
    allDay,
    start,
    end: dueAt,
    dayKey: dueAt ? dueAt.slice(0, 10) : null,
    startDayKey: start ? start.slice(0, 10) : null,
    dueAt,
    scheduledStart,
    completedAt: null,
    assignedUserId: "u-lisette",
    createdByUserId: "u-richard",
    assignedTo: { id: "u-lisette", firstName: "Lisette", lastName: "Perez" },
    job: null,
    lead: null,
    violationCase: null,
    blocking: false,
    blockedReason: null,
    dueLocked: false,
    workflowTaskKey: null,
    workflowModuleKey: null,
    workflowPhaseKey: null,
    checklist: { done: 0, total: 0 },
    counts: { notes: 0, files: 0, waitingOn: 0 },
    ...over,
  };
}

export const PEOPLE: CalendarPerson[] = [
  { id: "u-richard", firstName: "Richard", lastName: "Carey" },
  { id: "u-lisette", firstName: "Lisette", lastName: "Perez" },
  { id: "u-frank", firstName: "Frank", lastName: "Ortiz" },
];
