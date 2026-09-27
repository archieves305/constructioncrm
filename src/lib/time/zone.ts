import { TZDate } from "@date-fns/tz";

/**
 * One time zone for "what day is it" questions.
 *
 * Tasks store UTC instants. A manual due date is pinned to noon UTC, the
 * workflow engine writes 17:00, and a timed calendar item is a real clock
 * time — all of which have to land on the same calendar day the office sees.
 * Before this module, the morning digest used the droplet's local midnight
 * (correct only because the droplet happens to run UTC), list buckets used
 * the browser's, and nothing agreed once a task carried a real time.
 *
 * Client-safe: no env, no Prisma. The browser and the server must group by
 * the same day, so both import this. One office, one zone; if a second
 * office ever appears this becomes a settings row, not an env var.
 */
export const APP_TIME_ZONE = "America/New_York";

/** Monday, as every list and the old schedule grid already assumed. */
export const CALENDAR_WEEK_STARTS_ON = 1;

/** A calendar day as `yyyy-MM-dd`, in APP_TIME_ZONE unless said otherwise. */
export type DayKey = string;

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type LocalParts = {
  year: number;
  /** 0-based, as Date.getMonth. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday, as Date.getDay. */
  weekday: number;
};

export function localParts(d: Date, tz: string = APP_TIME_ZONE): LocalParts {
  const z = new TZDate(d.getTime(), tz);
  return {
    year: z.getFullYear(),
    month: z.getMonth(),
    day: z.getDate(),
    hour: z.getHours(),
    minute: z.getMinutes(),
    weekday: z.getDay(),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function dayKey(d: Date, tz: string = APP_TIME_ZONE): DayKey {
  const p = localParts(d, tz);
  return `${p.year}-${pad2(p.month + 1)}-${pad2(p.day)}`;
}

/** Same as `dayKey`, in the argument order `nurture/time.ts` always used. */
export function localDateKey(d: Date, tz: string): DayKey {
  return dayKey(d, tz);
}

export function isDayKey(s: unknown): s is DayKey {
  if (typeof s !== "string") return false;
  const m = DAY_KEY_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

export function parseDayKey(k: DayKey): { year: number; month: number; day: number } {
  const m = DAY_KEY_RE.exec(k);
  if (!m) throw new Error(`Not a day key: ${k}`);
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

/** UTC-midnight Date for pure calendar arithmetic on a key (never shown to anyone). */
function keyToUtc(k: DayKey): Date {
  const p = parseDayKey(k);
  return new Date(Date.UTC(p.year, p.month, p.day));
}

function utcToKey(d: Date): DayKey {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDayKeys(k: DayKey, n: number): DayKey {
  const d = keyToUtc(k);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToKey(d);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDayKeys(a: DayKey, b: DayKey): number {
  return Math.round((keyToUtc(b).getTime() - keyToUtc(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(k: DayKey): number {
  return keyToUtc(k).getUTCDay();
}

/** The instant a local day begins (00:00:00.000 in `tz`). */
export function startOfDayIn(k: DayKey, tz: string = APP_TIME_ZONE): Date {
  return atLocalTime(k, 0, 0, tz);
}

/** The last instant of a local day (23:59:59.999 in `tz`). */
export function endOfDayIn(k: DayKey, tz: string = APP_TIME_ZONE): Date {
  const p = parseDayKey(k);
  return new Date(new TZDate(p.year, p.month, p.day, 23, 59, 59, 999, tz).getTime());
}

export function atLocalTime(k: DayKey, hour: number, minute: number, tz: string = APP_TIME_ZONE): Date {
  const p = parseDayKey(k);
  return new Date(new TZDate(p.year, p.month, p.day, hour, minute, 0, 0, tz).getTime());
}

/**
 * Calendar days later, keeping the local clock time — 23 or 25 hours across
 * a DST change, not 24. A 9:00 job dragged from Friday to Monday is still a
 * 9:00 job.
 */
export function addLocalDays(d: Date, n: number, tz: string = APP_TIME_ZONE): Date {
  const z = new TZDate(d.getTime(), tz);
  const next = new TZDate(z.getFullYear(), z.getMonth(), z.getDate() + n, z.getHours(), z.getMinutes(), z.getSeconds(), z.getMilliseconds(), tz);
  return new Date(next.getTime());
}

export const shiftPreservingLocalTime = addLocalDays;

/**
 * The day pin for an all-day item: noon UTC, the same rule `parseDueAt` has
 * always applied to a bare `yyyy-MM-dd`, so a date reads as that day in
 * every zone from UTC-12 to UTC+11.
 */
export function pinAllDay(k: DayKey): Date {
  return new Date(`${k}T12:00:00.000Z`);
}

export type DayRange = { from: DayKey; to: DayKey };

/** The week (7 days) containing `k`. */
export function weekRange(k: DayKey, weekStartsOn: number = CALENDAR_WEEK_STARTS_ON): DayRange {
  const back = (weekdayOf(k) - weekStartsOn + 7) % 7;
  const from = addDayKeys(k, -back);
  return { from, to: addDayKeys(from, 6) };
}

export type MonthGrid = DayRange & { monthStart: DayKey; monthEnd: DayKey };

/** The 6-row × 7-day grid that shows the month containing `k`. */
export function monthRange(k: DayKey, weekStartsOn: number = CALENDAR_WEEK_STARTS_ON): MonthGrid {
  const p = parseDayKey(k);
  const monthStart = `${p.year}-${pad2(p.month + 1)}-01`;
  const lastDay = new Date(Date.UTC(p.year, p.month + 1, 0)).getUTCDate();
  const monthEnd = `${p.year}-${pad2(p.month + 1)}-${pad2(lastDay)}`;
  const { from } = weekRange(monthStart, weekStartsOn);
  return { from, to: addDayKeys(from, 41), monthStart, monthEnd };
}

/** Every key from `from` to `to`, inclusive. */
export function dayKeysBetween(from: DayKey, to: DayKey): DayKey[] {
  const n = diffDayKeys(from, to);
  if (n < 0) return [];
  const out: DayKey[] = [];
  for (let i = 0; i <= n; i++) out.push(addDayKeys(from, i));
  return out;
}

/** Today's key in the app zone. */
export function todayKey(now: Date = new Date(), tz: string = APP_TIME_ZONE): DayKey {
  return dayKey(now, tz);
}

/**
 * A day key as a local-midnight Date, for formatting with date-fns in the
 * browser ("Mon, Sep 28"). Never store or compare this — it is the
 * browser's zone, not the app's.
 */
export function dayKeyToLocalDate(k: DayKey): Date {
  const p = parseDayKey(k);
  return new Date(p.year, p.month, p.day);
}
