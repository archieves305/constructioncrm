import type { Prisma, RoleName } from "@/generated/prisma/client";
import { jobsInvolvingUserWhere } from "@/lib/jobs/involvement";
import { seesAllTasks, type VisibilityScope } from "@/lib/tasks/access";
import { APP_TIME_ZONE, dayKey } from "@/lib/time/zone";
import type { UsersSelection } from "./access";
import type { CalendarItem, CalendarJob, CalendarLead, CalendarOverlay } from "./types";

/**
 * Dated records that are not tasks, drawn on the calendar read-only: a
 * permit inspection, a permit's expiry or expected approval, a code-violation hearing, an agency inspection on a
 * case, a job's target start, a crew's install day. They carry their own icon, open their own
 * record, never count as work and can never be dragged — the calendar shows
 * them so nobody schedules a roof tear-off on inspection morning.
 *
 * Pure: the route runs the queries, this turns rows into `CalendarItem`s
 * with `kind` set and `overlay` filled. Ids are prefixed so they can never
 * collide with a task id.
 */

const HOUR = 3_600_000;

/**
 * Inspections are saved from a date picker as `new Date("yyyy-MM-dd")`
 * (midnight UTC) and all-day pins sit at noon UTC; anything else is a real
 * appointment. Returns the item's window.
 */
export function overlayWhen(d: Date, tz: string = APP_TIME_ZONE): { allDay: boolean; start: Date; end: Date; day: string } {
  const h = d.getUTCHours();
  const pin = d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && (h === 0 || h === 12);
  if (pin) {
    const day = d.toISOString().slice(0, 10);
    const noon = new Date(`${day}T12:00:00.000Z`);
    return { allDay: true, start: noon, end: noon, day };
  }
  return { allDay: false, start: d, end: new Date(d.getTime() + HOUR), day: dayKey(d, tz) };
}

export type PermitInspectionRow = {
  id: string;
  type: string;
  scheduledFor: Date | null;
  result: string;
  permit: { id: string; permitType: string | null; permitNumber: string | null; job: CalendarJob };
};
/** A permit with a date worth seeing coming: the day it expires, or the day its approval is expected. */
export type PermitDateRow = {
  id: string;
  permitType: string | null;
  permitNumber: string | null;
  status: string;
  expirationDate: Date | null;
  expectedApprovalDate: Date | null;
  job: CalendarJob;
};
export type HearingRow = {
  id: string;
  type: string;
  status: string;
  scheduledAt: Date;
  location: string | null;
  case: { id: string; caseNumber: string; agencyCaseNumber: string | null; leadId: string; lead: CalendarLead | null };
};
export type CaseInspectionRow = {
  id: string;
  status: string;
  scheduledFor: Date | null;
  result: string | null;
  case: { id: string; caseNumber: string; agencyCaseNumber: string | null; leadId: string; lead: CalendarLead | null };
};
export type JobStartRow = CalendarJob & { targetStartDate: Date | null };

/** A vendor's dated document in force: an insurance certificate, an exemption, a license. */
export type VendorDocRow = { id: string; label: string; expiresAt: Date; vendor: { id: string; name: string } };

/** A crew booked to install on a job. */
export type CrewInstallRow = { id: string; installDate: Date | null; crew: { name: string; trades: string[] }; job: CalendarJob };

export type OverlayRows = {
  permitInspections: PermitInspectionRow[];
  permitDates?: PermitDateRow[];
  vendorDocs?: VendorDocRow[];
  crewInstalls?: CrewInstallRow[];
  hearings: HearingRow[];
  caseInspections: CaseInspectionRow[];
  jobStarts: JobStartRow[];
};

const words = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function base(kind: CalendarItem["kind"], id: string, title: string, when: ReturnType<typeof overlayWhen>, overlay: CalendarOverlay, done: boolean, now: Date): CalendarItem {
  const status = done ? "COMPLETED" : "PENDING";
  return {
    kind,
    id,
    title,
    description: null,
    status,
    priority: "MEDIUM",
    derived: done ? "completed" : when.end < now && !when.allDay ? "in_progress" : "not_started",
    allDay: when.allDay,
    start: when.start.toISOString(),
    end: when.end.toISOString(),
    dayKey: when.day,
    startDayKey: when.day,
    dueAt: when.end.toISOString(),
    scheduledStart: when.allDay ? null : when.start.toISOString(),
    completedAt: null,
    assignedUserId: null,
    createdByUserId: "",
    assignedTo: null,
    job: null,
    lead: null,
    violationCase: null,
    blocking: false,
    blockedReason: null,
    dueLocked: true,
    workflowTaskKey: null,
    workflowModuleKey: null,
    workflowPhaseKey: null,
    checklist: { done: 0, total: 0 },
    counts: { notes: 0, files: 0, waitingOn: 0 },
    overlay,
  };
}

export function overlayItems(rows: OverlayRows, now: Date = new Date(), tz: string = APP_TIME_ZONE): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const r of rows.permitInspections) {
    if (!r.scheduledFor) continue;
    const when = overlayWhen(r.scheduledFor, tz);
    const done = r.result !== "SCHEDULED";
    const item = base(
      "permit_inspection",
      `pi:${r.id}`,
      `${words(r.type)} inspection`,
      when,
      { label: "Permit inspection", detail: [r.permit.permitType, r.permit.permitNumber].filter(Boolean).join(" · ") || null, href: `/jobs/${r.permit.job.id}?tab=permits`, state: done ? "done" : "scheduled" },
      done,
      now,
    );
    item.job = r.permit.job;
    out.push(item);
  }
  for (const r of rows.permitDates ?? []) {
    const detail = [r.permitType, r.permitNumber].filter(Boolean).join(" · ") || null;
    const href = `/jobs/${r.job.id}?tab=permits`;
    // A closed or denied permit has no expiry to watch.
    if (r.expirationDate && r.status !== "FINAL" && r.status !== "DENIED") {
      const item = base("permit_date", `px:${r.id}`, "Permit expires", overlayWhen(r.expirationDate, tz), { label: "Permit expiry", detail, href, state: "scheduled" }, false, now);
      item.job = r.job;
      out.push(item);
    }
    // Only while the permit is still waiting on the building department.
    if (r.expectedApprovalDate && (r.status === "APPLIED" || r.status === "IN_PROGRESS")) {
      const item = base("permit_date", `pa:${r.id}`, "Permit approval expected", overlayWhen(r.expectedApprovalDate, tz), { label: "Permit approval", detail, href, state: "scheduled" }, false, now);
      item.job = r.job;
      out.push(item);
    }
  }
  for (const r of rows.vendorDocs ?? []) {
    out.push(base("vendor_doc", `vd:${r.id}`, `${r.label} expires — ${r.vendor.name}`, overlayWhen(r.expiresAt, tz), { label: "Vendor document", detail: r.vendor.name, href: `/vendors/${r.vendor.id}`, state: "scheduled" }, false, now));
  }
  for (const r of rows.hearings) {
    const when = overlayWhen(r.scheduledAt, tz);
    const cancelled = r.status === "CANCELLED";
    if (cancelled) continue;
    const done = r.status === "HELD";
    const item = base(
      "hearing",
      `hr:${r.id}`,
      `${words(r.type)} hearing`,
      when,
      { label: "Hearing", detail: r.location, href: `/violations/${r.case.id}?tab=hearings`, state: done ? "done" : r.status === "CONTINUED" ? "moved" : "scheduled" },
      done,
      now,
    );
    item.violationCase = { id: r.case.id, caseNumber: r.case.caseNumber, agencyCaseNumber: r.case.agencyCaseNumber, leadId: r.case.leadId };
    item.lead = r.case.lead;
    out.push(item);
  }
  for (const r of rows.caseInspections) {
    if (!r.scheduledFor || r.status === "CANCELLED") continue;
    const when = overlayWhen(r.scheduledFor, tz);
    const done = r.status === "COMPLETED";
    const item = base(
      "case_inspection",
      `ci:${r.id}`,
      "Agency inspection",
      when,
      { label: "Agency inspection", detail: r.result ? words(r.result) : null, href: `/violations/${r.case.id}?tab=inspections`, state: done ? "done" : "scheduled" },
      done,
      now,
    );
    item.violationCase = { id: r.case.id, caseNumber: r.case.caseNumber, agencyCaseNumber: r.case.agencyCaseNumber, leadId: r.case.leadId };
    item.lead = r.case.lead;
    out.push(item);
  }
  for (const j of rows.jobStarts) {
    if (!j.targetStartDate) continue;
    const when = overlayWhen(j.targetStartDate, tz);
    const item = base("job_start", `js:${j.id}`, "Job starts", when, { label: "Job start", detail: j.serviceType ?? null, href: `/jobs/${j.id}`, state: "scheduled" }, false, now);
    item.job = j;
    out.push(item);
  }
  for (const r of rows.crewInstalls ?? []) {
    if (!r.installDate) continue;
    const item = base(
      "crew_install",
      `cw:${r.id}`,
      `Install — ${r.crew.name}`,
      overlayWhen(r.installDate, tz),
      { label: "Crew install", detail: r.crew.trades.join(", ") || null, href: `/jobs/${r.job.id}?tab=field&sub=crews`, state: "scheduled" },
      false,
      now,
    );
    item.job = r.job;
    out.push(item);
  }
  return out;
}

/**
 * Whose overlays: "My calendar" means the jobs and cases I have a role on;
 * everyone / a picked set means all of them; own-only roles are held to
 * their visibility scope whatever they asked for.
 */
export function overlayScopes(
  sel: UsersSelection,
  user: { id: string; role: RoleName },
  scope: VisibilityScope | undefined,
): { jobs: Prisma.JobWhereInput; cases: Prisma.CodeViolationCaseWhereInput } {
  if (!seesAllTasks(user.role)) {
    return { jobs: { id: { in: scope?.jobIds ?? [] } }, cases: { id: { in: scope?.violationCaseIds ?? [] } } };
  }
  if (sel.kind === "me") {
    return {
      jobs: jobsInvolvingUserWhere(user.id),
      cases: { OR: [{ caseManagerId: user.id }, { workflow: { team: { some: { userId: user.id } } } }] },
    };
  }
  return { jobs: {}, cases: {} };
}

export function isOverlay(item: { kind: string }): boolean {
  return item.kind !== "task";
}
