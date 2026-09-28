import { formatTimeRange } from "./agenda";
import type { CalendarItem, CalendarPerson } from "./types";

/**
 * Two timed tasks for the same person at the same time. Warn, never block:
 * the office knows when a double-booking is deliberate (a delivery during a
 * site visit) and when it is a mistake. All-day work never conflicts — it has
 * no window — and unassigned work has nobody to be in two places.
 */

export type Timed = {
  id: string;
  assignedUserId: string | null;
  allDay: boolean;
  start: string | null;
  end: string | null;
  status: CalendarItem["status"];
};

function isTimedOpen(t: Timed): t is Timed & { start: string; end: string; assignedUserId: string } {
  return !t.allDay && t.start !== null && t.end !== null && t.assignedUserId !== null && t.status !== "COMPLETED" && t.status !== "CANCELLED";
}

export function overlaps(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Every open timed item of the same person whose window touches the candidate's. */
export function findConflicts(candidate: Timed, items: readonly CalendarItem[]): CalendarItem[] {
  if (!isTimedOpen(candidate)) return [];
  const seen = new Set<string>();
  const out: CalendarItem[] = [];
  for (const other of items) {
    if (other.id === candidate.id || seen.has(other.id)) continue;
    if (!isTimedOpen(other) || other.assignedUserId !== candidate.assignedUserId) continue;
    if (overlaps(candidate, other)) {
      seen.add(other.id);
      out.push(other);
    }
  }
  return out.sort((a, b) => (a.start! < b.start! ? -1 : a.start! > b.start! ? 1 : 0));
}

/** "Lisette already has 'Roof tear-off' 9:00 – 12:00 PM." */
export function describeConflict(other: CalendarItem, person: CalendarPerson | null): string {
  const who = person?.firstName ?? "They";
  const when = other.start && other.end ? ` ${formatTimeRange(other.start, other.end)}` : "";
  return `${who} already ${who === "They" ? "have" : "has"} “${other.title}”${when}.`;
}
