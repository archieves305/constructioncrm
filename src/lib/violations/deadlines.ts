import { format } from "date-fns";
import { daysRemaining } from "./dates";

/**
 * Every dated thing on a case that somebody should be reminded of, in one
 * shape, and the pure planner that decides which reminders are due today.
 *
 * A reminder's identity is (case, kind, entityId, offsetKey). `entityId`
 * carries the date ("<rowId>@<yyyy-MM-dd>"), so a moved deadline starts a
 * fresh series on its own and nothing has to be reset by hand.
 */

export type DeadlineKind = "COMPLIANCE" | "APPEAL" | "FINE_ACCRUAL_START" | "HEARING" | "AGENCY_INSPECTION" | "PERMIT_EXPIRATION";

export type DeadlineRef = {
  kind: DeadlineKind;
  caseId: string;
  caseNumber: string;
  leadId: string;
  /** "<rowId>@<yyyy-MM-dd>" — a moved date is a new entity. */
  entityId: string;
  label: string;
  at: Date;
  /** Overdue reminders every run (compliance only); the rest go quiet once past. */
  overdueDaily: boolean;
  recipientUserId: string | null;
  /** The case tab the reminder should open. */
  tab: string | null;
};

export type CaseForDeadlines = {
  id: string;
  caseNumber: string;
  leadId: string;
  status: string;
  caseManagerId: string | null;
  currentDeadline: Date | null;
  appealDeadline: Date | null;
  agencyConfirmedAt: Date | null;
  fineAccrualStartDate: Date | null;
  fineAccrualStoppedAt: Date | null;
  hearings: { id: string; scheduledAt: Date; status: string; type: string; attendeeUserId: string | null }[];
  inspections: { id: string; scheduledFor: Date | null; status: string; kind: string; attendeeUserId: string | null }[];
  job: { projectManagerId: string | null; permits: { id: string; permitNumber: string | null; expirationDate: Date | null; status: string }[] } | null;
};

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const OPEN_HEARING = new Set(["SCHEDULED", "CONTINUED"]);
const OPEN_INSPECTION = new Set(["REQUESTED", "SCHEDULED"]);
const LIVE_PERMIT = new Set(["APPLIED", "ISSUED", "IN_PROGRESS"]);

/** Every remindable date on an open case. Closed and cancelled cases have none. */
export function collectDeadlines(c: CaseForDeadlines, now: Date): DeadlineRef[] {
  if (c.status === "CLOSED" || c.status === "CANCELLED") return [];
  const out: DeadlineRef[] = [];
  const base = { caseId: c.id, caseNumber: c.caseNumber, leadId: c.leadId };
  if (c.currentDeadline && !c.agencyConfirmedAt) {
    out.push({ ...base, kind: "COMPLIANCE", entityId: `deadline@${ymd(c.currentDeadline)}`, label: "Compliance deadline", at: c.currentDeadline, overdueDaily: true, recipientUserId: c.caseManagerId, tab: null });
  }
  if (c.appealDeadline && daysRemaining(c.appealDeadline, now) >= 0) {
    out.push({ ...base, kind: "APPEAL", entityId: `appeal@${ymd(c.appealDeadline)}`, label: "Appeal deadline", at: c.appealDeadline, overdueDaily: false, recipientUserId: c.caseManagerId, tab: null });
  }
  if (c.fineAccrualStartDate && !c.fineAccrualStoppedAt && daysRemaining(c.fineAccrualStartDate, now) >= 0) {
    out.push({ ...base, kind: "FINE_ACCRUAL_START", entityId: `accrual@${ymd(c.fineAccrualStartDate)}`, label: "Daily fines start accruing", at: c.fineAccrualStartDate, overdueDaily: false, recipientUserId: c.caseManagerId, tab: "fines" });
  }
  for (const h of c.hearings) {
    if (!OPEN_HEARING.has(h.status) || daysRemaining(h.scheduledAt, now) < 0) continue;
    out.push({ ...base, kind: "HEARING", entityId: `${h.id}@${ymd(h.scheduledAt)}`, label: `${h.type === "SPECIAL_MAGISTRATE" ? "Special magistrate" : h.type === "CODE_ENFORCEMENT_BOARD" ? "Code enforcement board" : h.type === "APPEAL" ? "Appeal" : h.type === "LIEN_REDUCTION" ? "Lien reduction" : "Hearing"} hearing`, at: h.scheduledAt, overdueDaily: false, recipientUserId: h.attendeeUserId ?? c.caseManagerId, tab: "hearings" });
  }
  for (const i of c.inspections) {
    if (!i.scheduledFor || !OPEN_INSPECTION.has(i.status) || daysRemaining(i.scheduledFor, now) < 0) continue;
    out.push({ ...base, kind: "AGENCY_INSPECTION", entityId: `${i.id}@${ymd(i.scheduledFor)}`, label: `Agency ${i.kind.toLowerCase()}`, at: i.scheduledFor, overdueDaily: false, recipientUserId: i.attendeeUserId ?? c.caseManagerId, tab: "inspections" });
  }
  for (const p of c.job?.permits ?? []) {
    if (!p.expirationDate || !LIVE_PERMIT.has(p.status) || daysRemaining(p.expirationDate, now) < 0) continue;
    out.push({ ...base, kind: "PERMIT_EXPIRATION", entityId: `${p.id}@${ymd(p.expirationDate)}`, label: `Permit ${p.permitNumber ?? ""} expires`.replace("  ", " "), at: p.expirationDate, overdueDaily: false, recipientUserId: c.job?.projectManagerId ?? c.caseManagerId, tab: "permits" });
  }
  return out;
}

/** Days before the date at which a reminder goes out. */
export const REMINDER_OFFSETS = [30, 14, 7, 3, 1, 0] as const;

export type PlannedReminder = { ref: DeadlineRef; offsetKey: string; daysRemaining: number };

export function reminderKey(r: { caseId: string; kind: string; entityId: string; offsetKey: string }): string {
  return `${r.caseId}|${r.kind}|${r.entityId}|${r.offsetKey}`;
}

/**
 * Which reminders are due right now, given what was already sent.
 *
 * A future date gets at most ONE reminder per run: the most recently crossed
 * offset that has not been sent (so a cron that was off for a week sends one
 * catch-up mail, not four). An overdue compliance deadline gets one reminder
 * per calendar day, keyed by the day.
 */
export function planReminders(refs: DeadlineRef[], now: Date, sentKeys: ReadonlySet<string>): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const ref of refs) {
    if (!ref.recipientUserId) continue;
    const n = daysRemaining(ref.at, now);
    if (n < 0) {
      if (!ref.overdueDaily) continue;
      const offsetKey = `od:${ymd(now)}`;
      if (!sentKeys.has(reminderKey({ ...ref, offsetKey }))) out.push({ ref, offsetKey, daysRemaining: n });
      continue;
    }
    // Offsets whose day has arrived, nearest first; the first unsent one wins.
    const crossed = REMINDER_OFFSETS.filter((o) => n <= o).sort((a, b) => a - b);
    for (const o of crossed) {
      const offsetKey = `d${o}`;
      if (sentKeys.has(reminderKey({ ...ref, offsetKey }))) break; // everything larger was implicitly covered
      out.push({ ref, offsetKey, daysRemaining: n });
      break;
    }
  }
  return out;
}

/** Group planned reminders by who hears about them. */
export function groupByRecipient(planned: PlannedReminder[]): Map<string, PlannedReminder[]> {
  const out = new Map<string, PlannedReminder[]>();
  for (const p of planned) {
    const id = p.ref.recipientUserId!;
    out.set(id, [...(out.get(id) ?? []), p]);
  }
  return out;
}
