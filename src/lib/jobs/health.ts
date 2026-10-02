/**
 * One word for how a job is doing, and why.
 *
 * Derived on read from facts the CRM already holds — nothing is stored, so
 * the status can never disagree with the tasks, permits and inspections it
 * is made of. Pure, so the rules are testable and the same on every surface.
 */
export type JobHealthLevel = "closed" | "delayed" | "at_risk" | "on_track" | "not_started";

export type JobHealthInput = {
  closed: boolean;
  hasWorkflow: boolean;
  /** Open, activated tasks on the job (workflow steps and ordinary tasks). */
  openTasks: number;
  overdueTasks: number;
  /** Whole days the longest-overdue open task is past its day; 0 when none. */
  oldestOverdueDays: number;
  blockedTasks: number;
  failedInspections: number;
  /** Days until the soonest permit expiry; negative = already expired; null = no dated permit in force. */
  permitExpiresInDays: number | null;
};

export type JobHealth = { level: JobHealthLevel; label: string; reasons: string[] };

/** A task this many days late moves the job from "at risk" to "delayed". */
export const DELAYED_AFTER_DAYS = 7;
/** A permit expiring within this many days puts the job at risk. */
export const PERMIT_WARNING_DAYS = 30;

const LABEL: Record<JobHealthLevel, string> = {
  closed: "Closed",
  delayed: "Delayed",
  at_risk: "At risk",
  on_track: "On track",
  not_started: "Not started",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function deriveJobHealth(i: JobHealthInput): JobHealth {
  if (i.closed) return { level: "closed", label: LABEL.closed, reasons: [] };

  const delayed: string[] = [];
  if (i.failedInspections > 0) delayed.push(`${plural(i.failedInspections, "failed inspection")} waiting on corrections`);
  if (i.blockedTasks > 0) delayed.push(`${plural(i.blockedTasks, "blocked task")}`);
  if (i.oldestOverdueDays >= DELAYED_AFTER_DAYS) delayed.push(`a task is ${plural(i.oldestOverdueDays, "day")} overdue`);
  if (i.permitExpiresInDays !== null && i.permitExpiresInDays < 0) delayed.push("a permit has expired");

  const risk: string[] = [];
  if (i.overdueTasks > 0 && i.oldestOverdueDays < DELAYED_AFTER_DAYS) risk.push(`${plural(i.overdueTasks, "overdue task")}`);
  if (i.permitExpiresInDays !== null && i.permitExpiresInDays >= 0 && i.permitExpiresInDays <= PERMIT_WARNING_DAYS) {
    risk.push(i.permitExpiresInDays === 0 ? "a permit expires today" : `a permit expires in ${plural(i.permitExpiresInDays, "day")}`);
  }

  if (delayed.length > 0) return { level: "delayed", label: LABEL.delayed, reasons: [...delayed, ...risk] };
  if (risk.length > 0) return { level: "at_risk", label: LABEL.at_risk, reasons: risk };
  if (!i.hasWorkflow && i.openTasks === 0) {
    return { level: "not_started", label: LABEL.not_started, reasons: ["No workflow has been applied and no tasks are open"] };
  }
  return { level: "on_track", label: LABEL.on_track, reasons: [] };
}
