import type { CalendarItemDto } from "@crm/mobile-api";
import { addDays } from "./format";

/** Read-only records first, then timed items by start, then all-day. */
export function orderDay(items: CalendarItemDto[]): CalendarItemDto[] {
  const rank = (i: CalendarItemDto) => (i.kind !== "task" ? 0 : i.allDay ? 2 : 1);
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.start ?? "").localeCompare(b.start ?? ""));
}

/**
 * `days` days from `from`, each with its items in day order. An item sits on
 * the day it is due (`dayKey`); open items are listed before finished ones.
 * Days with nothing are kept, so the week reads as a week.
 */
export function groupByDay(items: CalendarItemDto[], from: string, days: number): { day: string; items: CalendarItemDto[] }[] {
  const out = Array.from({ length: days }, (_, n) => ({ day: addDays(from, n), items: [] as CalendarItemDto[] }));
  const index = new Map(out.map((d, n) => [d.day, n]));
  for (const item of items) {
    const n = item.dayKey ? index.get(item.dayKey) : undefined;
    if (n !== undefined) out[n].items.push(item);
  }
  const finished = (i: CalendarItemDto) => i.status === "COMPLETED" || i.status === "CANCELLED";
  for (const d of out) {
    const ordered = orderDay(d.items);
    d.items = [...ordered.filter((i) => !finished(i)), ...ordered.filter(finished)];
  }
  return out;
}
