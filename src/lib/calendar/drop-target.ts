import { isDayKey, type DayKey } from "@/lib/time/zone";

/**
 * Where a card can be dropped, and the string dnd-kit carries for it.
 *
 * Pure so a droppable's id round-trips through a tested function instead of
 * `id.split(":")` in three components. The People view's cell carries the
 * person and the day; `unassigned` is the lane for work nobody owns yet.
 */

export const UNASSIGNED_LANE = "unassigned";

export type DropTarget =
  | { kind: "day"; day: DayKey }
  /** A band start in the Day view: 8:00, 13:00, 17:00. */
  | { kind: "slot"; day: DayKey; hour: number; minute: number }
  /** A People-view cell. `userId` null = the Unassigned lane. */
  | { kind: "cell"; day: DayKey; userId: string | null }
  | { kind: "unscheduled" };

const pad2 = (n: number) => String(n).padStart(2, "0");

export function dropId(t: DropTarget): string {
  switch (t.kind) {
    case "day":
      return `day:${t.day}`;
    case "slot":
      return `slot:${t.day}T${pad2(t.hour)}:${pad2(t.minute)}`;
    case "cell":
      return `cell:${t.userId ?? UNASSIGNED_LANE}::${t.day}`;
    case "unscheduled":
      return "unscheduled";
  }
}

const SLOT_RE = /^slot:(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
const CELL_RE = /^cell:([^:]+)::(\d{4}-\d{2}-\d{2})$/;

export function parseDropId(id: string | number | null | undefined): DropTarget | null {
  if (typeof id !== "string") return null;
  if (id === "unscheduled") return { kind: "unscheduled" };
  if (id.startsWith("day:")) {
    const day = id.slice(4);
    return isDayKey(day) ? { kind: "day", day } : null;
  }
  const slot = SLOT_RE.exec(id);
  if (slot) {
    const [, day, h, m] = slot;
    const hour = Number(h);
    const minute = Number(m);
    if (!isDayKey(day) || hour > 23 || minute > 59) return null;
    return { kind: "slot", day, hour, minute };
  }
  const cell = CELL_RE.exec(id);
  if (cell) {
    const [, who, day] = cell;
    if (!isDayKey(day)) return null;
    return { kind: "cell", day, userId: who === UNASSIGNED_LANE ? null : who };
  }
  return null;
}

/** The day a target lands on, or null for the Unscheduled rail. */
export function targetDay(t: DropTarget): DayKey | null {
  return t.kind === "unscheduled" ? null : t.day;
}
