import { format } from "date-fns";
import { APP_TIME_ZONE, addDayKeys, diffDayKeys, localParts, type DayKey, type DayRange } from "@/lib/time/zone";
import type { CalendarItem } from "./types";

/**
 * Arranging items on days. Pure, client-safe.
 *
 * A span appears on every day it covers (clipped to the visible range); a
 * single-day item once. Within a day: open before closed, all-day before
 * timed (spans first), timed by start, all-day by priority then title — so the eye reads
 * "what is fixed today" first and "what is left" without hunting.
 */

const PRIORITY_RANK = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

function isClosed(i: CalendarItem): boolean {
  return i.status === "COMPLETED" || i.status === "CANCELLED";
}

export function compareDayItems(a: CalendarItem, b: CalendarItem): number {
  const ca = isClosed(a) ? 1 : 0;
  const cb = isClosed(b) ? 1 : 0;
  if (ca !== cb) return ca - cb;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  // A multi-day span is the background of the day; it reads first.
  const sa = a.allDay && a.startDayKey !== a.dayKey ? 0 : 1;
  const sb = b.allDay && b.startDayKey !== b.dayKey ? 0 : 1;
  if (sa !== sb) return sa - sb;
  if (!a.allDay && !b.allDay && a.start && b.start && a.start !== b.start) return a.start < b.start ? -1 : 1;
  const pa = PRIORITY_RANK[a.priority];
  const pb = PRIORITY_RANK[b.priority];
  if (pa !== pb) return pa - pb;
  return a.title.localeCompare(b.title);
}

export function sortDayItems(items: CalendarItem[]): CalendarItem[] {
  return [...items].sort(compareDayItems);
}

/** Day → the items on it, every key in the range present (possibly empty). */
export function itemsByDay(items: CalendarItem[], range: DayRange): Map<DayKey, CalendarItem[]> {
  const out = new Map<DayKey, CalendarItem[]>();
  const n = diffDayKeys(range.from, range.to);
  for (let i = 0; i <= n; i++) out.set(addDayKeys(range.from, i), []);
  for (const item of items) {
    if (!item.dayKey) continue;
    const first = item.startDayKey ?? item.dayKey;
    const start = first < range.from ? range.from : first;
    const end = item.dayKey > range.to ? range.to : item.dayKey;
    if (start > end) continue;
    const days = diffDayKeys(start, end);
    for (let i = 0; i <= days; i++) out.get(addDayKeys(start, i))?.push(item);
  }
  for (const [k, list] of out) out.set(k, sortDayItems(list));
  return out;
}

export type CalendarSummary = { total: number; done: number; remaining: number; overdue: number; blocked: number };

/** Counts over distinct items (a span is one task, however many days it shows on). */
export function summarizeCalendarItems(items: CalendarItem[]): CalendarSummary {
  const seen = new Set<string>();
  const out: CalendarSummary = { total: 0, done: 0, remaining: 0, overdue: 0, blocked: 0 };
  for (const i of items) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    out.total++;
    if (i.status === "COMPLETED") out.done++;
    else if (i.status !== "CANCELLED") out.remaining++;
    if (i.derived === "overdue") out.overdue++;
    if (i.status === "BLOCKED") out.blocked++;
  }
  return out;
}

/** The worst thing on a day, for a month cell's tone. */
export type DayTone = "empty" | "quiet" | "busy" | "blocked" | "overdue";

export function dayTone(items: CalendarItem[]): DayTone {
  if (items.length === 0) return "empty";
  if (items.some((i) => i.derived === "overdue")) return "overdue";
  if (items.some((i) => i.status === "BLOCKED")) return "blocked";
  return items.some((i) => !isClosed(i)) ? "busy" : "quiet";
}

export type Band = "allDay" | "morning" | "afternoon" | "evening";
export const BANDS: readonly Band[] = ["allDay", "morning", "afternoon", "evening"];
export const BAND_LABEL: Record<Band, string> = { allDay: "All day", morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
/** The hour a "+ at …" chip proposes for each band. */
export const BAND_START_HOUR: Record<Exclude<Band, "allDay">, number> = { morning: 8, afternoon: 13, evening: 17 };

export function bandOf(item: CalendarItem, tz: string = APP_TIME_ZONE): Band {
  if (item.allDay || !item.start) return "allDay";
  const h = localParts(new Date(item.start), tz).hour;
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

export function groupByBand(items: CalendarItem[], tz: string = APP_TIME_ZONE): Record<Band, CalendarItem[]> {
  const out: Record<Band, CalendarItem[]> = { allDay: [], morning: [], afternoon: [], evening: [] };
  for (const i of sortDayItems(items)) out[bandOf(i, tz)].push(i);
  return out;
}

/** "9:00 – 11:30 AM" / "11:30 AM – 1:00 PM"; formatted in the browser's zone. */
export function formatTimeRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sameMeridiem = format(s, "a") === format(e, "a");
  const start = sameMeridiem ? format(s, "h:mm") : format(s, "h:mm a");
  return `${start} – ${format(e, "h:mm a")}`;
}

export function formatTime(iso: string): string {
  return format(new Date(iso), "h:mm a");
}
