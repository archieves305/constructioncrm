import { addDayKeys, APP_TIME_ZONE, diffDayKeys, weekdayOf, type DayKey } from "@/lib/time/zone";
import { overlayWhen } from "@/lib/calendar/overlays";

/**
 * Which follow-up tasks a permit and its inspections call for today. Pure:
 * the crons load the rows, this decides, `alert-run.ts` writes.
 *
 * Each alert is an ordinary task, raised once. The source key carries the
 * date it hangs on, so a re-submitted permit, a new expiration date or a
 * re-booked inspection is a new alert and the old one no longer applies.
 */

export const WAITING_FIRST_DAYS = 7;
export const WAITING_SECOND_DAYS = 14;
export const EXPIRING_WITHIN_DAYS = 30;
/** The expiring task is due this many days before the permit lapses. */
export const EXPIRING_DUE_LEAD_DAYS = 14;

export type PermitAlertKind = "waiting-7" | "waiting-14" | "expiring";

export type PermitAlertRow = {
  id: string;
  status: string;
  submittedDate: Date | null;
  expirationDate: Date | null;
  permitType: string | null;
  municipality: string | null;
  permitNumber: string | null;
};

export type PlannedAlert = {
  sourceKey: string;
  kind: PermitAlertKind | "inspection";
  title: string;
  description: string;
  priority: "MEDIUM" | "HIGH";
  /** The day the task is due. */
  dueDay: DayKey;
  /** Who it is for, in order: the first role or person that resolves gets it. */
  audience: "coordinator" | "manager" | "field";
};

/** A day saved from a date picker, or the office day of a real instant. */
export const dayOfDate = (d: Date): DayKey => overlayWhen(d).day;

const permitPrefix = (permitId: string) => `permit:${permitId}:`;
export const permitAlertKey = (permitId: string, kind: PermitAlertKind, day: DayKey) => `${permitPrefix(permitId)}${kind}@${day}`;
export const permitAlertPrefix = permitPrefix;
export const inspectionAlertPrefix = (inspectionId: string) => `permit-inspection:${inspectionId}:ready@`;
export const inspectionAlertKey = (inspectionId: string, day: DayKey) => `${inspectionAlertPrefix(inspectionId)}${day}`;

const IN_REVIEW = new Set(["APPLIED", "IN_PROGRESS"]);
const IN_FORCE = new Set(["ISSUED", "IN_PROGRESS"]);

function permitName(p: PermitAlertRow): string {
  const what = p.permitType ? `${p.permitType} permit` : "Permit";
  return p.permitNumber ? `${what} #${p.permitNumber}` : what;
}

function longDay(k: DayKey): string {
  return new Date(`${k}T12:00:00.000Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The alerts that apply to one permit today — at most one waiting alert and one expiring alert. */
export function alertsForPermit(p: PermitAlertRow, today: DayKey): PlannedAlert[] {
  const out: PlannedAlert[] = [];
  const where = p.municipality ? ` at ${p.municipality}` : "";

  if (IN_REVIEW.has(p.status) && p.submittedDate) {
    const submitted = dayOfDate(p.submittedDate);
    const waited = diffDayKeys(submitted, today);
    if (waited >= WAITING_SECOND_DAYS) {
      out.push({
        sourceKey: permitAlertKey(p.id, "waiting-14", submitted),
        kind: "waiting-14",
        title: `${permitName(p)} still not issued after ${waited} days`,
        description: `Submitted ${longDay(submitted)}${where}. Call the building department, find out what is holding it, and update the permit on the job's Permits tab.`,
        priority: "HIGH",
        dueDay: today,
        audience: "manager",
      });
    } else if (waited >= WAITING_FIRST_DAYS) {
      out.push({
        sourceKey: permitAlertKey(p.id, "waiting-7", submitted),
        kind: "waiting-7",
        title: `Check on the ${permitName(p).replace(/^Permit/, "permit")} — submitted ${waited} days ago`,
        description: `Submitted ${longDay(submitted)}${where}. Check its status with the building department and update the permit on the job's Permits tab.`,
        priority: "MEDIUM",
        dueDay: today,
        audience: "coordinator",
      });
    }
  }

  if (IN_FORCE.has(p.status) && p.expirationDate) {
    const expires = dayOfDate(p.expirationDate);
    const left = diffDayKeys(today, expires);
    if (left >= 0 && left <= EXPIRING_WITHIN_DAYS) {
      const due = addDayKeys(expires, -EXPIRING_DUE_LEAD_DAYS);
      out.push({
        sourceKey: permitAlertKey(p.id, "expiring", expires),
        kind: "expiring",
        title: `${permitName(p)} expires ${longDay(expires)}`,
        description: `${left === 0 ? "It expires today" : `${left} day${left === 1 ? "" : "s"} left`}${where}. Get the final inspection passed before then, or ask for an extension and enter the new date on the job's Permits tab.`,
        priority: "HIGH",
        dueDay: due > today ? due : today,
        audience: "manager",
      });
    }
  }
  return out;
}

/** Source keys of this permit's alerts that still apply; an open alert task outside this set has been overtaken. */
export function liveAlertKeys(p: PermitAlertRow): Set<string> {
  const keys = new Set<string>();
  if (IN_REVIEW.has(p.status) && p.submittedDate) {
    const d = dayOfDate(p.submittedDate);
    keys.add(permitAlertKey(p.id, "waiting-7", d));
    keys.add(permitAlertKey(p.id, "waiting-14", d));
  }
  if (IN_FORCE.has(p.status) && p.expirationDate) keys.add(permitAlertKey(p.id, "expiring", dayOfDate(p.expirationDate)));
  return keys;
}

/** The next working day after `today` (Mon–Fri). */
export function nextWorkingDay(today: DayKey): DayKey {
  let d = addDayKeys(today, 1);
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDayKeys(d, 1);
  return d;
}

export type InspectionAlertRow = {
  id: string;
  type: string;
  result: string;
  scheduledFor: Date | null;
  permit: { permitType: string | null; municipality: string | null };
};

/**
 * "Be ready" for a booked inspection: raised on the last working day before
 * it — so a Friday run covers the weekend and Monday.
 */
export function alertForInspection(i: InspectionAlertRow, today: DayKey): PlannedAlert | null {
  if (i.result !== "SCHEDULED" || !i.scheduledFor) return null;
  const when = overlayWhen(i.scheduledFor);
  if (when.day <= today || when.day > nextWorkingDay(today)) return null;
  const type = i.type.toLowerCase().replace(/_/g, " ");
  const time = when.allDay ? "" : ` at ${when.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_TIME_ZONE })}`;
  return {
    sourceKey: inspectionAlertKey(i.id, when.day),
    kind: "inspection",
    title: `Be ready for the ${type} inspection — ${longDay(when.day)}${time}`,
    description: `${i.permit.permitType ? `${i.permit.permitType} permit` : "Permit"}${i.permit.municipality ? `, ${i.permit.municipality}` : ""}. Make sure the work is ready, the site is open and the permit card is posted. Record the result on the job's Permits tab.`,
    priority: "HIGH",
    dueDay: when.day,
    audience: "field",
  };
}

/** The key of this inspection's reminder that still applies, if any. */
export function liveInspectionKey(i: Pick<InspectionAlertRow, "id" | "result" | "scheduledFor">): string | null {
  if (i.result !== "SCHEDULED" || !i.scheduledFor) return null;
  return inspectionAlertKey(i.id, overlayWhen(i.scheduledFor).day);
}
