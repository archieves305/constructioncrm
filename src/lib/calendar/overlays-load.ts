import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { JOB_LABEL_SELECT, LEAD_LABEL_SELECT } from "@/lib/labels/select";
import type { VisibilityScope } from "@/lib/tasks/access";
import { endOfDayIn } from "@/lib/time/zone";
import type { UsersSelection } from "./access";
import { overlayItems, overlayScopes, type OverlayRows } from "./overlays";
import type { CalendarParams } from "./query";
import type { CalendarItem } from "./types";
import { canManageVendors } from "@/lib/vendors/access";
import { DOC_TYPE_LABEL, docInForce, type RequirementKey } from "@/lib/vendors/compliance";

const CASE_SELECT = { id: true, caseNumber: true, agencyCaseNumber: true, leadId: true, lead: { select: LEAD_LABEL_SELECT } } as const;

/**
 * Read-only overlays for a range: permit inspections, permit expiry and
 * expected-approval days, hearings, agency
 * inspections, job starts, crew installs. Shared by `GET /api/calendar` and the digest's
 * agenda. Skipped when a task-shaped filter (status, priority, search) is
 * on — those questions are about work, not appointments. A job filter narrows
 * the job-based ones and drops the case-based ones.
 */
export async function loadOverlays(params: CalendarParams, sel: UsersSelection, user: { id: string; role: RoleName }, scope: VisibilityScope | undefined, now: Date): Promise<CalendarItem[]> {
  if (params.status?.length || params.priority?.length || params.q) return [];
  // Date pickers store these as midnight UTC, which is the previous evening in
  // the office's zone — so the window opens at UTC midnight of the first day
  // and the mapped day key (see overlayWhen) is checked afterwards.
  const from = new Date(`${params.from}T00:00:00.000Z`);
  const to = endOfDayIn(params.to);
  const scopes = overlayScopes(sel, user, scope);
  const jobs = params.jobId ? { AND: [scopes.jobs, { id: params.jobId }] } : scopes.jobs;
  const [permitInspections, permitDates, hearings, caseInspections, jobStarts, vendorDocs, crewInstalls] = await Promise.all([
    prisma.jobPermitInspection.findMany({
      where: { scheduledFor: { gte: from, lte: to }, permit: { job: jobs } },
      select: { id: true, type: true, scheduledFor: true, result: true, permit: { select: { id: true, permitType: true, permitNumber: true, job: { select: JOB_LABEL_SELECT } } } },
      take: 200,
    }),
    prisma.jobPermit.findMany({
      where: {
        job: jobs,
        OR: [
          { expirationDate: { gte: from, lte: to }, status: { notIn: ["FINAL", "DENIED"] } },
          { expectedApprovalDate: { gte: from, lte: to }, status: { in: ["APPLIED", "IN_PROGRESS"] } },
        ],
      },
      select: { id: true, permitType: true, permitNumber: true, status: true, expirationDate: true, expectedApprovalDate: true, job: { select: JOB_LABEL_SELECT } },
      take: 200,
    }),
    params.jobId
      ? []
      : prisma.codeViolationHearing.findMany({
          where: { scheduledAt: { gte: from, lte: to }, case: scopes.cases },
          select: { id: true, type: true, status: true, scheduledAt: true, location: true, case: { select: CASE_SELECT } },
          take: 200,
        }),
    params.jobId
      ? []
      : prisma.codeViolationInspection.findMany({
          where: { scheduledFor: { gte: from, lte: to }, case: scopes.cases },
          select: { id: true, status: true, scheduledFor: true, result: true, case: { select: CASE_SELECT } },
          take: 200,
        }),
    prisma.job.findMany({
      where: { AND: [jobs, { targetStartDate: { gte: from, lte: to }, currentStage: { isClosed: false } }] },
      select: { ...JOB_LABEL_SELECT, targetStartDate: true },
      take: 200,
    }),
    // Vendor documents belong to no job: shown to the roles that keep the
    // vendor directory, and never under a job filter.
    params.jobId || !canManageVendors(user.role) ? [] : loadVendorDocs(from, to),
    prisma.crewAssignment.findMany({
      where: { installDate: { gte: from, lte: to }, job: { AND: [jobs, { currentStage: { isClosed: false } }] } },
      select: { id: true, installDate: true, crew: { select: { name: true, trades: true } }, job: { select: JOB_LABEL_SELECT } },
      take: 200,
    }),
  ]);
  const rows: OverlayRows = { permitInspections, permitDates, hearings, caseInspections, jobStarts, vendorDocs, crewInstalls };
  return overlayItems(rows, now).filter((i) => i.dayKey !== null && i.dayKey >= params.from && i.dayKey <= params.to);
}

const WATCHED: readonly RequirementKey[] = ["liability", "workers_comp", "license"];

/** Expiry days of the documents in force on active vendors — a superseded certificate is not on the calendar. */
async function loadVendorDocs(from: Date, to: Date): Promise<NonNullable<OverlayRows["vendorDocs"]>> {
  const vendors = await prisma.vendor.findMany({
    where: { isActive: true, documents: { some: { expiresAt: { gte: from, lte: to } } } },
    select: { id: true, name: true, documents: { select: { id: true, type: true, expiresAt: true, createdAt: true } } },
    take: 200,
  });
  const out: NonNullable<OverlayRows["vendorDocs"]> = [];
  for (const v of vendors) {
    for (const key of WATCHED) {
      const doc = docInForce(key, v.documents);
      if (!doc?.expiresAt || doc.expiresAt < from || doc.expiresAt > to) continue;
      out.push({ id: doc.id, label: DOC_TYPE_LABEL[doc.type], expiresAt: doc.expiresAt, vendor: { id: v.id, name: v.name } });
    }
  }
  return out;
}
