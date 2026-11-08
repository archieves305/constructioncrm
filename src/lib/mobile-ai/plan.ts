import type { LogDraftAnswer } from "./prompts/log-draft";
import type { TaskDraftAnswer } from "./prompts/task-draft";

/**
 * Turning the model's answer into a draft the phone shows. Pure. The model
 * names a job or a person only by its number in the lists it was given; a
 * number outside them is dropped (and said so), never trusted.
 */
export type Pick = { number: number; id: string; label: string };

export type TaskDraft = {
  title: string;
  description: string | null;
  jobId: string | null;
  jobLabel: string | null;
  assignedUserId: string | null;
  assigneeLabel: string | null;
  /** YYYY-MM-DD, office time. */
  dueDate: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  unclear: string[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function numbered<T>(rows: T[], id: (r: T) => string, label: (r: T) => string): Pick[] {
  return rows.map((r, i) => ({ number: i + 1, id: id(r), label: label(r) }));
}

export function taskDraftFrom(a: TaskDraftAnswer, jobs: Pick[], people: Pick[], today: string): TaskDraft {
  const unclear = [...a.unclear];
  const job = a.jobNumber == null ? null : jobs.find((j) => j.number === a.jobNumber) ?? null;
  if (a.jobNumber != null && !job) unclear.push("The job could not be matched; pick it below.");
  const who = a.assigneeNumber == null ? null : people.find((p) => p.number === a.assigneeNumber) ?? null;
  if (a.assigneeNumber != null && !who) unclear.push("The person could not be matched; pick them below.");
  let due = a.dueDate && DAY.test(a.dueDate) && !Number.isNaN(Date.parse(`${a.dueDate}T12:00:00Z`)) ? a.dueDate : null;
  if (a.dueDate && !due) unclear.push(`The due date "${a.dueDate}" was not a date; set it below.`);
  if (due && due < today) {
    unclear.push(`The due date came out in the past (${due}); check it.`);
    due = null;
  }
  return {
    title: a.title.trim().slice(0, 200) || "New task",
    description: a.description?.trim() ? a.description.trim().slice(0, 4000) : null,
    jobId: job?.id ?? null,
    jobLabel: job?.label ?? null,
    assignedUserId: who?.id ?? null,
    assigneeLabel: who?.label ?? null,
    dueDate: due,
    priority: a.priority,
    unclear: unclear.map((u) => u.trim()).filter(Boolean).slice(0, 6),
  };
}

export const LOG_DRAFT_TEXT = [
  "workPerformed",
  "areasWorked",
  "delays",
  "safetyIssues",
  "materialsDelivered",
  "subcontractorsOnsite",
  "tomorrowPlan",
  "notes",
] as const;
export const LOG_DRAFT_CHECKS = ["safetyToolboxTalk", "safetyPpeVerified", "safetyHousekeeping"] as const;

export type LogDraft = Partial<Record<(typeof LOG_DRAFT_TEXT)[number], string>> & Partial<Record<(typeof LOG_DRAFT_CHECKS)[number], boolean>>;

/** Only the sections the speaker spoke to; empty text dropped. */
export function logDraftFrom(a: LogDraftAnswer): LogDraft {
  const out: LogDraft = {};
  for (const k of LOG_DRAFT_TEXT) {
    const v = a[k]?.trim();
    if (v) out[k] = v.slice(0, 4000);
  }
  for (const k of LOG_DRAFT_CHECKS) if (typeof a[k] === "boolean") out[k] = a[k] as boolean;
  return out;
}

/** A person's AI drafts share one allowance a month (AI_MAX_USD_PER_SUBJECT). */
export function voiceSubjectId(userId: string, today: string): string {
  return `${userId}:${today.slice(0, 7)}`;
}
