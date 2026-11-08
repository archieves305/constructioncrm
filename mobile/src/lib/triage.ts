import { addDays } from "./format";

/** The days a task can be moved to in one tap. `today` is yyyy-MM-dd in the office's zone. */
export function moveChoices(today: string): { label: string; day: string }[] {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const toMonday = ((8 - dow) % 7) || 7;
  const out = [
    { label: "Today", day: today },
    { label: "Tomorrow", day: addDays(today, 1) },
    { label: "Next Monday", day: addDays(today, toMonday) },
    { label: "In a week", day: addDays(today, 7) },
  ];
  // Tomorrow can be next Monday (on a Sunday): keep each day once.
  return out.filter((c, i) => out.findIndex((x) => x.day === c.day) === i);
}

/** Overdue: an open task whose date is before today (all-day tasks are due through their day). */
export function isOverdue(t: { status: string; dueAt: string | null }, today: string, dayOf: (iso: string) => string): boolean {
  if (!t.dueAt || t.status === "COMPLETED" || t.status === "CANCELLED") return false;
  return dayOf(t.dueAt) < today;
}
