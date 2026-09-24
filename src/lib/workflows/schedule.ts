import type { TaskStatus, WorkflowAnchor } from "@/generated/prisma/client";

/**
 * Due-date arithmetic for workflow steps. Pure, and the business-day
 * predicate is injectable so a holiday table can slot in later without
 * touching the callers.
 *
 * Due times land at 17:00 server-local, matching `dueInBusinessDays` used by
 * the follow-up automation, so a workflow step and a manual follow-up due on
 * the same day sort together.
 */

export type IsBusinessDay = (d: Date) => boolean;

export const isWeekday: IsBusinessDay = (d) => d.getDay() !== 0 && d.getDay() !== 6;

export const DUE_HOUR = 17;

export function atDueHour(d: Date): Date {
  const x = new Date(d);
  x.setHours(DUE_HOUR, 0, 0, 0);
  return x;
}

function stepDay(d: Date, dir: 1 | -1): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + dir);
  return x;
}

/**
 * `from` + n business days. n = 0 returns `from` itself, rolled forward to
 * the next business day if it falls on a non-working day. Negative n walks
 * backwards (used for "N days before target start").
 */
export function addBusinessDaysFrom(from: Date, n: number, isBusinessDay: IsBusinessDay = isWeekday): Date {
  let d = new Date(from);
  if (n === 0) {
    let guard = 0;
    while (!isBusinessDay(d) && guard++ < 14) d = stepDay(d, 1);
    return d;
  }
  const dir: 1 | -1 = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  let guard = 0;
  while (remaining > 0 && guard++ < 10_000) {
    d = stepDay(d, dir);
    if (isBusinessDay(d)) remaining--;
  }
  return d;
}

export type ScheduleTask = { anchor: WorkflowAnchor; dueOffsetBusinessDays: number };

export type ScheduleContext = {
  jobCreatedAt: Date;
  appliedAt: Date;
  targetStartDate: Date | null;
  isBusinessDay?: IsBusinessDay;
};

/**
 * Due date at apply time. JOB_CREATED counts from whichever is later, job
 * creation or the apply, so a workflow applied to a month-old job does not
 * start with every setup task already overdue. Predecessor-anchored tasks
 * have no date until they activate.
 */
export function initialDueAt(task: ScheduleTask, ctx: ScheduleContext): Date | null {
  const bd = ctx.isBusinessDay ?? isWeekday;
  switch (task.anchor) {
    case "JOB_CREATED": {
      const base = ctx.jobCreatedAt > ctx.appliedAt ? ctx.jobCreatedAt : ctx.appliedAt;
      return atDueHour(addBusinessDaysFrom(base, task.dueOffsetBusinessDays, bd));
    }
    case "APPLIED_AT":
      return atDueHour(addBusinessDaysFrom(ctx.appliedAt, task.dueOffsetBusinessDays, bd));
    case "TARGET_START":
      return ctx.targetStartDate
        ? atDueHour(addBusinessDaysFrom(ctx.targetStartDate, task.dueOffsetBusinessDays, bd))
        : null;
    case "PHASE_START":
    case "PREDECESSOR":
      return null;
  }
}

/**
 * Due date when a step becomes Ready. Predecessor/phase anchors count from
 * the activation moment; date anchors keep their apply-time value, falling
 * back to activation when TARGET_START is still unknown, so no active task
 * ever sits without a date.
 */
export function activationDueAt(task: ScheduleTask, activatedAt: Date, ctx: ScheduleContext): Date {
  const bd = ctx.isBusinessDay ?? isWeekday;
  if (task.anchor === "PREDECESSOR" || task.anchor === "PHASE_START") {
    return atDueHour(addBusinessDaysFrom(activatedAt, task.dueOffsetBusinessDays, bd));
  }
  return initialDueAt(task, ctx) ?? atDueHour(addBusinessDaysFrom(activatedAt, Math.max(0, task.dueOffsetBusinessDays), bd));
}

export type RescheduleCandidate = ScheduleTask & {
  id: string;
  status: TaskStatus;
  dueLocked: boolean;
  activatedAt: Date | null;
};

/**
 * Which tasks move when the job's target start date changes: open,
 * TARGET_START-anchored, not hand-edited. Returns the new dates; the caller
 * writes them through `updateTask` so the timeline records the shift.
 */
export function recomputeAfterTargetStartChange(
  tasks: RescheduleCandidate[],
  ctx: ScheduleContext,
): { id: string; dueAt: Date | null }[] {
  const out: { id: string; dueAt: Date | null }[] = [];
  for (const t of tasks) {
    if (t.anchor !== "TARGET_START" || t.dueLocked) continue;
    if (t.status === "COMPLETED" || t.status === "CANCELLED") continue;
    out.push({ id: t.id, dueAt: initialDueAt(t, ctx) });
  }
  return out;
}
