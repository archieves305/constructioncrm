import { dayOfDate } from "@/lib/permits/alerts";
import { addDayKeys, weekdayOf, type DayKey } from "@/lib/time/zone";

/**
 * The "get ready" task a crew's install date calls for. Pure: the routes
 * save the assignment, this decides, `install-run.ts` writes.
 *
 * One ordinary task per install date, raised when the date is saved and due
 * the working day before the crew arrives. The source key carries the date,
 * so a moved install is a new task and the old one no longer applies.
 */

export const installTaskPrefix = (assignmentId: string) => `crew-install:${assignmentId}:ready@`;
export const installTaskKey = (assignmentId: string, day: DayKey) => `${installTaskPrefix(assignmentId)}${day}`;

export type InstallRow = { id: string; installDate: Date | null; crew: { name: string } };

export type PlannedInstallTask = {
  sourceKey: string;
  title: string;
  description: string;
  /** The day the crew installs. */
  installDay: DayKey;
  /** The day the task is due. */
  dueDay: DayKey;
};

function longDay(k: DayKey): string {
  return new Date(`${k}T12:00:00.000Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The last working day (Mon–Fri) before `day`. */
export function previousWorkingDay(day: DayKey): DayKey {
  let d = addDayKeys(day, -1);
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDayKeys(d, -1);
  return d;
}

/** The task for this assignment as it stands today, or null: no date, or the install day has passed. */
export function planInstallTask(a: InstallRow, today: DayKey): PlannedInstallTask | null {
  if (!a.installDate) return null;
  const installDay = dayOfDate(a.installDate);
  if (installDay < today) return null;
  const before = previousWorkingDay(installDay);
  return {
    sourceKey: installTaskKey(a.id, installDay),
    title: `Get ready: ${a.crew.name} installs ${longDay(installDay)}`,
    description: `${a.crew.name} is booked to install on ${longDay(installDay)}. Confirm the crew, that the materials are on site or on the way, and that the customer and site access are set. The date is kept on the job's Crews tab — moving it there moves this task.`,
    installDay,
    dueDay: before > today ? before : today,
  };
}

/** The key of this assignment's task that still applies, if any. */
export function liveInstallKey(a: Pick<InstallRow, "id" | "installDate">): string | null {
  return a.installDate ? installTaskKey(a.id, dayOfDate(a.installDate)) : null;
}
