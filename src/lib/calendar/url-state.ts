import { format } from "date-fns";
import type { RoleName } from "@/generated/prisma/enums";
import type { ListScopePref } from "@/lib/lists/scope";
import {
  addDayKeys,
  dayKeyToLocalDate,
  isDayKey,
  monthRange,
  parseDayKey,
  weekRange,
  type DayKey,
  type DayRange,
} from "@/lib/time/zone";
import { canViewAllCalendars } from "./access";

/**
 * What the calendar URL says, resolved against the person's preferences and
 * device. Pure so "a phone with `?view=people`" and "a rep asking for
 * everyone" are tested cases, not surprises.
 *
 *   ?view=day|week|month   ?date=yyyy-MM-dd   ?users=me|all|id,id[,unassigned]
 *   ?job= ?status= ?priority= ?q= ?completed=0 ?task=<id>
 */

export type CalendarView = "day" | "week" | "month";
export const CALENDAR_VIEWS: readonly CalendarView[] = ["day", "week", "month"];

export type CalendarViewPref = "DAY" | "WEEK" | "MONTH";

export function parseCalendarView(v: string | null | undefined): CalendarView | undefined {
  return v === "day" || v === "week" || v === "month" ? v : undefined;
}

export function prefToView(pref: CalendarViewPref | null | undefined): CalendarView | undefined {
  if (pref === "DAY") return "day";
  if (pref === "WEEK") return "week";
  if (pref === "MONTH") return "month";
  return undefined;
}

/** URL > (phone → day) > saved preference > week. */
export function resolveView(input: { url?: string | null; pref?: CalendarViewPref | null; isPhone: boolean }): CalendarView {
  const fromUrl = parseCalendarView(input.url);
  if (fromUrl) return fromUrl;
  if (input.isPhone) return "day";
  return prefToView(input.pref) ?? "week";
}

export function resolveDate(url: string | null | undefined, today: DayKey): DayKey {
  return isDayKey(url) ? url : today;
}

/**
 * URL > list preference (ALL → everyone) > me. Own-only roles are pinned to
 * `me` here as well as on the server, so the UI never even offers more.
 */
export function resolveUsers(input: { url?: string | null; pref?: ListScopePref | null; role: RoleName | null }): string {
  if (!input.role || !canViewAllCalendars(input.role)) return "me";
  const v = input.url?.trim();
  if (v) return v;
  return input.pref === "ALL" ? "all" : "me";
}

export function rangeForView(view: CalendarView, anchor: DayKey): DayRange {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") return weekRange(anchor);
  const g = monthRange(anchor);
  return { from: g.from, to: g.to };
}

/** The anchor after pressing Previous / Next. */
export function shiftAnchor(view: CalendarView, anchor: DayKey, dir: 1 | -1): DayKey {
  if (view === "day") return addDayKeys(anchor, dir);
  if (view === "week") return addDayKeys(anchor, 7 * dir);
  const p = parseDayKey(anchor);
  const d = new Date(Date.UTC(p.year, p.month + dir, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** "Monday, September 28, 2026" · "Sep 28 – Oct 4, 2026" · "October 2026". */
export function rangeLabel(view: CalendarView, anchor: DayKey): string {
  const a = dayKeyToLocalDate(anchor);
  if (view === "day") return format(a, "EEEE, MMMM d, yyyy");
  if (view === "month") return format(a, "MMMM yyyy");
  const { from, to } = weekRange(anchor);
  const f = dayKeyToLocalDate(from);
  const t = dayKeyToLocalDate(to);
  if (f.getFullYear() !== t.getFullYear()) return `${format(f, "MMM d, yyyy")} – ${format(t, "MMM d, yyyy")}`;
  if (f.getMonth() !== t.getMonth()) return `${format(f, "MMM d")} – ${format(t, "MMM d, yyyy")}`;
  return `${format(f, "MMM d")} – ${format(t, "d, yyyy")}`;
}

export type CalendarFilters = {
  job?: string;
  status?: string;
  priority?: string;
  q?: string;
  /** `completed=0` hides done and cancelled items. */
  hideCompleted: boolean;
};

export function readFilters(get: (k: string) => string | null): CalendarFilters {
  return {
    job: get("job") || undefined,
    status: get("status") || undefined,
    priority: get("priority") || undefined,
    q: get("q")?.trim() || undefined,
    hideCompleted: get("completed") === "0",
  };
}

export function activeFilterCount(f: CalendarFilters): number {
  return [f.job, f.status, f.priority, f.q].filter(Boolean).length + (f.hideCompleted ? 1 : 0);
}
