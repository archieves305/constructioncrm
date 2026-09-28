import { formatAddressLine } from "@/lib/labels/address";
import type { CalendarItem, CalendarLead } from "./types";

/**
 * What a crew lead can do to a task from the day screen, decided once and
 * tested, so the action row never shows a button that would 400 or a
 * Directions link to "TBD". Pure, client-safe.
 */

function isClosed(i: CalendarItem): boolean {
  return i.status === "COMPLETED" || i.status === "CANCELLED";
}

/** The address and phone a task points at: the job's customer, else the lead. */
export function contactOf(item: CalendarItem): CalendarLead | null {
  return item.job?.lead ?? item.lead ?? null;
}

function dialable(phone: string | null | undefined): phone is string {
  return !!phone && phone.replace(/\D/g, "").length >= 7;
}

export type FieldActions = {
  /** PATCH IN_PROGRESS: open and not already started. */
  start: boolean;
  /** PATCH COMPLETED: open. */
  done: boolean;
  /** The address to navigate to, when the record has a real one. */
  directions: CalendarLead | null;
  /** The number to dial. */
  call: string | null;
  /** The job's daily-log page, where photos belong (`/field/jobs/<id>/daily/<day>`). */
  photoHref: string | null;
  /** "2/5" when the step has a checklist. */
  checklist: { done: number; total: number } | null;
};

export function fieldActions(item: CalendarItem, day: string): FieldActions {
  const open = !isClosed(item);
  const contact = contactOf(item);
  const address = contact && formatAddressLine(contact) ? contact : null;
  return {
    start: open && item.status !== "IN_PROGRESS",
    done: open,
    directions: address,
    call: dialable(contact?.primaryPhone) ? contact.primaryPhone : null,
    photoHref: item.job ? `/field/jobs/${item.job.id}/daily/${day}` : null,
    checklist: item.checklist.total > 0 ? item.checklist : null,
  };
}

export type FieldDay = {
  /** Open work in time order: timed by start, then all-day by priority (agenda order). */
  remaining: CalendarItem[];
  done: CalendarItem[];
  total: number;
};

/** Split a day's already-sorted items into what is left and what is finished. */
export function splitFieldDay(items: readonly CalendarItem[]): FieldDay {
  const remaining: CalendarItem[] = [];
  const done: CalendarItem[] = [];
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    (isClosed(i) ? done : remaining).push(i);
  }
  return { remaining, done, total: remaining.length + done.length };
}

/** "6 tasks · 4 remaining" · "1 task · done" · "Nothing scheduled". */
export function fieldDayLine(d: FieldDay): string {
  if (d.total === 0) return "Nothing scheduled";
  const tasks = `${d.total} ${d.total === 1 ? "task" : "tasks"}`;
  if (d.remaining.length === 0) return `${tasks} · all done`;
  return `${tasks} · ${d.remaining.length} remaining`;
}

export function greeting(hour: number, firstName: string): string {
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return firstName ? `${part}, ${firstName}` : part;
}
