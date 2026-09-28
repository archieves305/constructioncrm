import { APP_TIME_ZONE, addDayKeys, addLocalDays, atLocalTime, dayKey, diffDayKeys, isDayKey, pinAllDay } from "@/lib/time/zone";

/**
 * The one set of rules for a task's place on the calendar.
 *
 * A task has a single date axis: `dueAt` is both the deadline every list,
 * digest and escalation already reads AND the day the task sits on the
 * calendar. Two optional fields describe more:
 *
 *   - `allDay = true`  (default)  `dueAt` is a day pin; only its calendar day
 *                                  matters. `scheduledStart`, when set, is an
 *                                  earlier day pin and the task spans days.
 *   - `allDay = false`             a timed item: `scheduledStart` is when the
 *                                  work begins and `dueAt` is when it ends.
 *
 * Pure so that "drag Tuesday's 9:00 job to Thursday" is a tested function
 * and not a chain of ifs inside `updateTask`. Every writer — the PATCH
 * route, quick-create, the future drag — calls this and stores `next`.
 *
 * Patch semantics follow the rest of the task API: `undefined` = leave
 * alone, `null` = clear. A `dueAt` that is a bare `yyyy-MM-dd` means "put it
 * on that day" (the window moves with it); an ISO instant means "end at
 * exactly this moment".
 */

export type ScheduleFields = {
  dueAt: Date | null;
  scheduledStart: Date | null;
  allDay: boolean;
};

export type SchedulePatch = {
  dueAt?: string | null;
  /** ISO instant, or a `yyyy-MM-dd` day for an all-day span. */
  scheduledStart?: string | null;
  allDay?: boolean;
};

export type ScheduleField = "dueAt" | "scheduledStart" | "allDay";

export type ScheduleResult =
  | {
      ok: true;
      next: ScheduleFields;
      /** The end instant moved. */
      dueChanged: boolean;
      /** The calendar day moved — a new deadline, so escalations restart. */
      dayChanged: boolean;
      /** The start or the all-day flag changed. */
      windowChanged: boolean;
    }
  | { ok: false; error: string; field: ScheduleField };

export const EMPTY_SCHEDULE: ScheduleFields = { dueAt: null, scheduledStart: null, allDay: true };

/** A task given a time with no end gets an hour. */
export const DEFAULT_DURATION_MIN = 60;
/** A task switched from all-day to timed starts at this hour. */
export const DEFAULT_START_HOUR = 9;

const MIN = 60_000;

function fail(field: ScheduleField, error: string): ScheduleResult {
  return { ok: false, error, field };
}

function parseInstant(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO or day key → an instant; a day key becomes its noon pin. */
function parseStart(s: string): Date | null {
  return isDayKey(s) ? pinAllDay(s) : parseInstant(s);
}

function durationOf(f: ScheduleFields): number {
  if (!f.allDay && f.scheduledStart && f.dueAt && f.dueAt > f.scheduledStart) {
    return f.dueAt.getTime() - f.scheduledStart.getTime();
  }
  return DEFAULT_DURATION_MIN * MIN;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

export function applySchedule(current: ScheduleFields, patch: SchedulePatch, tz: string = APP_TIME_ZONE): ScheduleResult {
  // Rows written before the calendar existed carry the column defaults; be
  // explicit so a partial fixture or an old select behaves like one of them.
  const existing: ScheduleFields = {
    dueAt: current.dueAt ?? null,
    scheduledStart: current.scheduledStart ?? null,
    allDay: current.allDay ?? true,
  };
  const touches = patch.dueAt !== undefined || patch.scheduledStart !== undefined || patch.allDay !== undefined;
  if (!touches) return { ok: true, next: { ...existing }, dueChanged: false, dayChanged: false, windowChanged: false };

  // ── Clear ──
  if (patch.dueAt === null) {
    if (patch.scheduledStart) return fail("dueAt", "A scheduled task needs a due date");
    return finish(existing, { ...EMPTY_SCHEDULE }, tz);
  }

  const allDay = patch.allDay ?? existing.allDay;
  let dueAt: Date | null = existing.dueAt;
  let start: Date | null = existing.scheduledStart;

  // The explicit start, if the patch names one.
  let patchedStart: Date | null | undefined = undefined;
  if (patch.scheduledStart !== undefined) {
    if (patch.scheduledStart === null) patchedStart = null;
    else {
      patchedStart = parseStart(patch.scheduledStart);
      if (!patchedStart) return fail("scheduledStart", "That start time is not a valid date");
    }
  }

  if (patch.dueAt !== undefined) {
    if (isDayKey(patch.dueAt)) {
      // ── "Put it on this day" ──
      const key = patch.dueAt;
      if (!allDay) {
        if (patchedStart) {
          // A time given with a day: start as given, end keeps the old length.
          start = patchedStart;
          dueAt = new Date(start.getTime() + durationOf(existing));
        } else if (!existing.allDay && existing.dueAt && existing.scheduledStart) {
          // A timed item dragged to another day keeps its clock times.
          const delta = diffDayKeys(dayKey(existing.dueAt, tz), key);
          start = addLocalDays(existing.scheduledStart, delta, tz);
          dueAt = addLocalDays(existing.dueAt, delta, tz);
        } else {
          // Becoming timed with nothing to go on: a default morning slot.
          start = atLocalTime(key, DEFAULT_START_HOUR, 0, tz);
          dueAt = new Date(start.getTime() + DEFAULT_DURATION_MIN * MIN);
        }
      } else {
        dueAt = pinAllDay(key);
        if (patchedStart !== undefined) {
          start = patchedStart;
        } else if (existing.allDay && existing.scheduledStart && existing.dueAt) {
          // A span keeps its length.
          const delta = diffDayKeys(dayKey(existing.dueAt, tz), key);
          start = pinAllDay(addDayKeys(dayKey(existing.scheduledStart, tz), delta));
        } else {
          // Plain all-day (or timed → all-day): the day is the whole story.
          start = null;
        }
      }
    } else {
      // ── "End at exactly this instant" ──
      const end = parseInstant(patch.dueAt);
      if (!end) return fail("dueAt", "That due date is not valid");
      dueAt = end;
      if (patchedStart !== undefined) start = patchedStart;
      // An explicit start is taken at its word (and validated below); only an
      // inherited start that the new end has overtaken is moved to keep the length.
      if (!allDay && patchedStart === undefined && (!start || start >= dueAt)) {
        start = new Date(dueAt.getTime() - durationOf(existing));
      }
    }
  } else if (patchedStart !== undefined) {
    // ── Only the start moved ──
    if (!dueAt) return fail("dueAt", "A scheduled task needs a due date");
    start = patchedStart;
    if (!allDay) {
      if (!start) return fail("scheduledStart", "A timed task needs a start time");
      if (start >= dueAt) dueAt = new Date(start.getTime() + durationOf(existing));
    }
  } else if (patch.allDay !== undefined && patch.allDay !== existing.allDay) {
    // ── Only the flag flipped ──
    if (!dueAt) return fail("dueAt", "Give the task a day before giving it a time");
    if (!allDay) {
      start = atLocalTime(dayKey(dueAt, tz), DEFAULT_START_HOUR, 0, tz);
      dueAt = new Date(start.getTime() + DEFAULT_DURATION_MIN * MIN);
    } else {
      const endKey = dayKey(dueAt, tz);
      dueAt = pinAllDay(endKey);
      start = start && dayKey(start, tz) < endKey ? start : null;
    }
  }

  // ── Normalize ──
  if (allDay && start && dueAt) {
    const startKey = dayKey(start, tz);
    const endKey = dayKey(dueAt, tz);
    start = startKey < endKey ? pinAllDay(startKey) : null;
    if (startKey > endKey) return fail("scheduledStart", "A task cannot start after the day it is due");
  }

  // ── Validate ──
  if (start && !dueAt) return fail("dueAt", "A scheduled task needs a due date");
  if (!allDay) {
    if (!dueAt) return fail("dueAt", "A timed task needs a day");
    if (!start) return fail("scheduledStart", "A timed task needs a start time");
    if (start >= dueAt) return fail("scheduledStart", "The start must be before the end");
  }
  if (start && dueAt && start > dueAt) return fail("scheduledStart", "The start must be before the end");

  return finish(existing, { dueAt, scheduledStart: start, allDay }, tz);
}

function finish(existing: ScheduleFields, next: ScheduleFields, tz: string): ScheduleResult {
  const dueChanged = !sameInstant(existing.dueAt, next.dueAt);
  const dayChanged =
    (existing.dueAt ? dayKey(existing.dueAt, tz) : null) !== (next.dueAt ? dayKey(next.dueAt, tz) : null);
  const windowChanged = !sameInstant(existing.scheduledStart, next.scheduledStart) || existing.allDay !== next.allDay;
  return { ok: true, next, dueChanged, dayChanged, windowChanged };
}
