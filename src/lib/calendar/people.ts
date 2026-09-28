import type { UsersSelection } from "./access";
import type { CalendarItem, CalendarPerson } from "./types";

/**
 * The People view's rows: who is doing what this week, and how loaded they
 * are. Lanes are the people the Viewing selector asked for (so a lane with
 * nothing on it still shows — an empty lane is where work gets dropped), plus
 * Unassigned when the selection includes it. Pure, client-safe.
 */

export type LaneUser = CalendarPerson & { isActive: boolean };

export type PersonRow = {
  /** null = the Unassigned lane. */
  id: string | null;
  person: CalendarPerson | null;
  items: CalendarItem[];
  /** Distinct open tasks (a span counts once). */
  open: number;
  /** Minutes of open timed work. */
  timedMinutes: number;
};

function isClosed(i: CalendarItem): boolean {
  return i.status === "COMPLETED" || i.status === "CANCELLED";
}

export function workloadOf(items: readonly CalendarItem[]): { open: number; timedMinutes: number } {
  const seen = new Set<string>();
  let open = 0;
  let timedMinutes = 0;
  for (const i of items) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    if (isClosed(i)) continue;
    open++;
    if (!i.allDay && i.start && i.end) {
      const ms = new Date(i.end).getTime() - new Date(i.start).getTime();
      if (ms > 0) timedMinutes += Math.round(ms / 60_000);
    }
  }
  return { open, timedMinutes };
}

function byName(a: CalendarPerson, b: CalendarPerson): number {
  return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
}

/**
 * Rows in reading order: Unassigned first (it is the dispatcher's inbox),
 * then people by how much open work they carry, busiest first, ties by name.
 */
export function peopleRows(items: readonly CalendarItem[], users: readonly LaneUser[], sel: UsersSelection, currentUserId: string): PersonRow[] {
  const active = users.filter((u) => u.isActive);
  let lanes: CalendarPerson[];
  let unassigned: boolean;
  if (sel.kind === "all") {
    lanes = active;
    unassigned = true;
  } else if (sel.kind === "ids") {
    const wanted = new Set(sel.ids);
    lanes = users.filter((u) => wanted.has(u.id));
    unassigned = sel.includeUnassigned;
  } else {
    lanes = users.filter((u) => u.id === currentUserId);
    unassigned = false;
  }

  const byPerson = new Map<string | null, CalendarItem[]>();
  for (const i of items) {
    if (i.kind !== "task") continue; // an inspection has no lane
    const key = i.assignedUserId;
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key)!.push(i);
  }

  const rows: PersonRow[] = lanes.map((p) => {
    const list = byPerson.get(p.id) ?? [];
    return { id: p.id, person: p, items: list, ...workloadOf(list) };
  });
  rows.sort((a, b) => b.open - a.open || byName(a.person!, b.person!));

  if (unassigned) {
    const list = byPerson.get(null) ?? [];
    rows.unshift({ id: null, person: null, items: list, ...workloadOf(list) });
  }
  return rows;
}

/** "9 tasks · 6.5 h timed" · "1 task" · "Nothing this week". */
export function formatWorkload(row: { open: number; timedMinutes: number }): string {
  if (row.open === 0) return "Nothing this week";
  const tasks = `${row.open} ${row.open === 1 ? "task" : "tasks"}`;
  if (row.timedMinutes === 0) return tasks;
  const h = row.timedMinutes / 60;
  const hours = Number.isInteger(h) ? String(h) : h.toFixed(1).replace(/\.0$/, "");
  return `${tasks} · ${hours} h timed`;
}
