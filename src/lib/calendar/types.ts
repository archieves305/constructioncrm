import type { Priority, TaskStatus } from "@/generated/prisma/enums";
import type { DayKey } from "@/lib/time/zone";
import type { CalendarStatus } from "./status";

/**
 * The wire shape of one thing on the calendar. Dates are ISO strings, day
 * keys are computed server-side in APP_TIME_ZONE so a browser in another
 * zone puts the card on the same day the office does.
 *
 * `kind` is "task" today; read-only overlays (permit inspections, hearings,
 * job starts) will join with their own kinds, and an ICS/Google exporter
 * reads `{ id, title, start, end, allDay }` without caring which.
 *
 * No runtime imports: safe for client components.
 */

export type CalendarPerson = { id: string; firstName: string; lastName: string };

export type CalendarLead = {
  id: string;
  fullName: string;
  companyName?: string | null;
  propertyAddress1: string;
  propertyAddress2?: string | null;
  city: string;
  state?: string;
  zipCode?: string;
  primaryPhone?: string | null;
};

export type CalendarJob = {
  id: string;
  jobNumber: string;
  title: string;
  serviceType?: string;
  lead: CalendarLead | null;
};

export type CalendarCase = { id: string; caseNumber: string; agencyCaseNumber: string | null; leadId: string };

export type CalendarItem = {
  kind: "task";
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  /** Overdue / blocked / … with the calendar's precedence (lib/calendar/status.ts). */
  derived: CalendarStatus;
  allDay: boolean;
  /** `scheduledStart ?? dueAt`. */
  start: string | null;
  /** `dueAt`: a timed item's end, or the pin of an all-day item's (last) day. */
  end: string | null;
  /** The day the item is due / ends. Null when unscheduled. */
  dayKey: DayKey | null;
  /** First day of a span, or the same as `dayKey`. */
  startDayKey: DayKey | null;
  dueAt: string | null;
  scheduledStart: string | null;
  completedAt: string | null;
  assignedUserId: string | null;
  createdByUserId: string;
  assignedTo: CalendarPerson | null;
  job: CalendarJob | null;
  lead: CalendarLead | null;
  violationCase: CalendarCase | null;
  blocking: boolean;
  blockedReason: string | null;
  dueLocked: boolean;
  workflowTaskKey: string | null;
  workflowModuleKey: string | null;
  workflowPhaseKey: string | null;
  checklist: { done: number; total: number };
  counts: { notes: number; files: number; waitingOn: number };
};

export type CalendarRangeResponse = {
  range: { from: DayKey; to: DayKey; timeZone: string };
  truncated: boolean;
  items: CalendarItem[];
};

export type CalendarUnscheduledResponse = {
  truncated: boolean;
  items: CalendarItem[];
};
