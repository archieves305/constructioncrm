import { format } from "date-fns";
import type { RoleName } from "@/generated/prisma/enums";
import { canEditTask } from "@/lib/tasks/access";
import { APP_TIME_ZONE, atLocalTime, dayKey, dayKeyToLocalDate } from "@/lib/time/zone";
import type { DropTarget } from "./drop-target";
import { applySchedule, DEFAULT_DURATION_MIN } from "./schedule";
import { deriveCalendarStatus } from "./status";
import type { CalendarItem, CalendarPerson } from "./types";

/**
 * A drag, as a PATCH. Pure, so "drop Tuesday's 9:00 job on Thursday" and
 * "hand it to Lisette" are tested cases. The server still runs the same
 * `applySchedule` and `canEditTask`; the client only refuses what the server
 * would refuse, and paints the result while the request is in flight.
 */

/** The subset of the task PATCH body a drag can produce. */
export type MovePatch = {
  dueAt?: string | null;
  scheduledStart?: string | null;
  allDay?: boolean;
  assignedUserId?: string | null;
};

const MIN = 60_000;

function isClosed(item: CalendarItem): boolean {
  return item.status === "COMPLETED" || item.status === "CANCELLED";
}

/**
 * The PATCH a drop means, or null when it would change nothing (dropping a
 * card back where it came from is not an update, a toast or an email).
 */
export function movePatch(item: CalendarItem, target: DropTarget, tz: string = APP_TIME_ZONE): MovePatch | null {
  switch (target.kind) {
    case "day":
      return item.dayKey === target.day ? null : { dueAt: target.day };
    case "slot": {
      const start = atLocalTime(target.day, target.hour, target.minute, tz);
      const duration =
        !item.allDay && item.start && item.end ? new Date(item.end).getTime() - new Date(item.start).getTime() : DEFAULT_DURATION_MIN * MIN;
      const end = new Date(start.getTime() + (duration > 0 ? duration : DEFAULT_DURATION_MIN * MIN));
      const startIso = start.toISOString();
      const endIso = end.toISOString();
      if (!item.allDay && item.start === startIso && item.end === endIso) return null;
      return { allDay: false, scheduledStart: startIso, dueAt: endIso };
    }
    case "cell": {
      const patch: MovePatch = {};
      if (item.dayKey !== target.day) patch.dueAt = target.day;
      if (item.assignedUserId !== target.userId) patch.assignedUserId = target.userId;
      return Object.keys(patch).length ? patch : null;
    }
    case "unscheduled":
      return item.dueAt === null ? null : { dueAt: null };
  }
}

export type MoveActor = { id: string; role: RoleName };

/**
 * May this person drop this card here? Mirrors the server: editing rights
 * come from `canEditTask`; changing who does the work, or taking it off the
 * calendar, is dispatch (ADMIN / MANAGER / OFFICE_STAFF). Closed tasks stay put.
 */
export function canMove(actor: MoveActor, item: CalendarItem, target: DropTarget, opts: { dispatch: boolean }): boolean {
  if (isClosed(item)) return false;
  if (!canEditTask(actor, item)) return false;
  if (target.kind === "unscheduled") return opts.dispatch;
  if (target.kind === "cell" && target.userId !== item.assignedUserId) return opts.dispatch;
  return true;
}

/** Whether the card can be picked up at all (any target might accept it). */
export function canDrag(actor: MoveActor, item: CalendarItem): boolean {
  return !isClosed(item) && canEditTask(actor, item);
}

/**
 * The item as the server will return it, for the optimistic paint. Runs the
 * same pure schedule rule the PATCH route runs, so a timed task dragged to
 * another day keeps its clock times here too.
 */
export function applyMove(
  item: CalendarItem,
  patch: MovePatch,
  people: readonly CalendarPerson[],
  now: Date = new Date(),
  tz: string = APP_TIME_ZONE,
): CalendarItem {
  const sched = applySchedule(
    {
      dueAt: item.dueAt ? new Date(item.dueAt) : null,
      scheduledStart: item.scheduledStart ? new Date(item.scheduledStart) : null,
      allDay: item.allDay,
    },
    { dueAt: patch.dueAt, scheduledStart: patch.scheduledStart, allDay: patch.allDay },
    tz,
  );
  const next: CalendarItem = { ...item };
  if (sched.ok) {
    const start = sched.next.scheduledStart ?? sched.next.dueAt;
    next.allDay = sched.next.allDay;
    next.dueAt = sched.next.dueAt ? sched.next.dueAt.toISOString() : null;
    next.scheduledStart = sched.next.scheduledStart ? sched.next.scheduledStart.toISOString() : null;
    next.start = start ? start.toISOString() : null;
    next.end = next.dueAt;
    next.dayKey = sched.next.dueAt ? dayKey(sched.next.dueAt, tz) : null;
    next.startDayKey = start ? dayKey(start, tz) : null;
  }
  if (patch.assignedUserId !== undefined) {
    next.assignedUserId = patch.assignedUserId;
    next.assignedTo = patch.assignedUserId ? people.find((p) => p.id === patch.assignedUserId) ?? null : null;
  }
  next.derived = deriveCalendarStatus({ dueAt: next.dueAt, allDay: next.allDay, status: next.status }, now, tz);
  return next;
}

function dayLabel(day: string): string {
  return format(dayKeyToLocalDate(day), "EEE, MMM d");
}

function clock(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** The success toast: what happened, in the words the dispatcher used. */
export function describeMove(item: CalendarItem, target: DropTarget, people: readonly CalendarPerson[]): string {
  switch (target.kind) {
    case "day":
      return `Moved to ${dayLabel(target.day)}`;
    case "slot":
      return `Moved to ${dayLabel(target.day)} at ${clock(target.hour, target.minute)}`;
    case "cell": {
      const dayPart = dayLabel(target.day);
      if (target.userId === item.assignedUserId) return `Moved to ${dayPart}`;
      if (target.userId === null) return `Unassigned · ${dayPart}`;
      const p = people.find((u) => u.id === target.userId);
      return `${p ? `Assigned to ${p.firstName}` : "Reassigned"} · ${dayPart}`;
    }
    case "unscheduled":
      return "Taken off the calendar";
  }
}

/** The text a screen reader hears on pick-up, hover and drop. */
export function describeTarget(target: DropTarget, people: readonly CalendarPerson[]): string {
  switch (target.kind) {
    case "day":
      return dayLabel(target.day);
    case "slot":
      return `${dayLabel(target.day)} at ${clock(target.hour, target.minute)}`;
    case "cell": {
      const who = target.userId === null ? "Unassigned" : people.find((u) => u.id === target.userId)?.firstName ?? "someone";
      return `${who}, ${dayLabel(target.day)}`;
    }
    case "unscheduled":
      return "Unscheduled";
  }
}
