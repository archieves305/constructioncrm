import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { closeAutoTask } from "@/lib/tasks/auto-tasks";
import { createTask } from "@/lib/tasks/create";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { pinAllDay, todayKey, type DayKey } from "@/lib/time/zone";
import { userForJobRole } from "@/lib/workflows/roles";
import {
  alertForInspection,
  alertsForPermit,
  inspectionAlertPrefix,
  liveAlertKeys,
  liveInspectionKey,
  permitAlertKey,
  permitAlertPrefix,
  type PlannedAlert,
} from "./alerts";

/**
 * Permit follow-ups as ordinary tasks: a permit waiting on the building
 * department, a permit about to lapse, an inspection on the next working day.
 * The daily crons call the two `raise…` functions; every permit and
 * inspection write calls a `settle…` so an alert the record has overtaken
 * closes by itself.
 *
 * A task is raised once per source key, whatever became of it — closing the
 * follow-up does not bring it back the next morning.
 */

const PERMIT_SELECT = {
  id: true,
  status: true,
  submittedDate: true,
  expirationDate: true,
  permitType: true,
  municipality: true,
  permitNumber: true,
  assignedUserId: true,
  jobId: true,
  job: { select: { projectManagerId: true } },
} as const;

type Owner = { jobId: string; assignedUserId: string | null; projectManagerId: string | null };

async function fallbackAdmin(): Promise<string | null> {
  const u = await prisma.user.findFirst({ where: { isActive: true, role: { name: "ADMIN" } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return u?.id ?? null;
}

/** Who an alert goes to. The permit's coordinator, the job's roles, and failing all of them the oldest admin. */
async function assigneeFor(audience: PlannedAlert["audience"], o: Owner): Promise<string | null> {
  const coordinator = async () => o.assignedUserId ?? (await userForJobRole(o.jobId, "PERMIT_COORDINATOR"));
  const manager = async () => o.projectManagerId ?? (await userForJobRole(o.jobId, "PROJECT_MANAGER"));
  const order =
    audience === "coordinator" ? [coordinator, manager] : audience === "manager" ? [manager, coordinator] : [() => userForJobRole(o.jobId, "SUPERINTENDENT"), manager, coordinator];
  for (const who of order) {
    const id = await who();
    if (id) return id;
  }
  return fallbackAdmin();
}

async function raise(alert: PlannedAlert, owner: Owner): Promise<boolean> {
  const seen = await prisma.task.findFirst({ where: { sourceKey: alert.sourceKey }, select: { id: true } });
  if (seen) return false;
  const assignee = await assigneeFor(alert.audience, owner);
  if (!assignee) return false;
  await createTask(
    {
      title: alert.title,
      description: alert.description,
      priority: alert.priority,
      dueAt: pinAllDay(alert.dueDay),
      allDay: true,
      assignedUserId: assignee,
      // Nobody raised it but the calendar: the owner is the only person it concerns.
      createdByUserId: assignee,
      jobId: owner.jobId,
      source: "auto",
      sourceKey: alert.sourceKey,
    },
    { actorUserId: null, notify: "inline" },
  );
  return true;
}

export type PermitAlertRun = { waiting7: number; waiting14: number; expiring: number };

/** Daily: raise what is due on every permit of an open job. */
export async function raisePermitAlerts(today: DayKey = todayKey()): Promise<PermitAlertRun> {
  const out: PermitAlertRun = { waiting7: 0, waiting14: 0, expiring: 0 };
  const permits = await prisma.jobPermit.findMany({
    where: { status: { in: ["APPLIED", "IN_PROGRESS", "ISSUED"] }, job: { currentStage: { isClosed: false } } },
    select: PERMIT_SELECT,
  });
  for (const p of permits) {
    try {
      for (const alert of alertsForPermit(p, today)) {
        const raised = await raise(alert, { jobId: p.jobId, assignedUserId: p.assignedUserId, projectManagerId: p.job.projectManagerId });
        if (!raised) continue;
        if (alert.kind === "waiting-14") {
          out.waiting14 += 1;
          // One follow-up at a time: the second replaces the first.
          const first = permitAlertKey(p.id, "waiting-7", alert.sourceKey.split("@")[1]);
          await closeAutoTask(first, { actorUserId: null, outcome: "CANCELLED", because: "Still not issued after 14 days — the newer follow-up replaces this one" });
        } else if (alert.kind === "waiting-7") out.waiting7 += 1;
        else out.expiring += 1;
      }
    } catch (err) {
      logger.exception(err, { where: "permits.raisePermitAlerts", permitId: p.id });
    }
  }
  return out;
}

/** Daily: "be ready" for inspections booked up to the next working day. */
export async function raiseInspectionAlerts(today: DayKey = todayKey()): Promise<{ scanned: number; raised: number }> {
  // Wide enough for a Friday run to see Monday; `alertForInspection` decides.
  const from = new Date(`${today}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 6 * 86_400_000);
  const rows = await prisma.jobPermitInspection.findMany({
    where: { result: "SCHEDULED", scheduledFor: { gte: from, lte: to }, permit: { job: { currentStage: { isClosed: false } } } },
    select: {
      id: true,
      type: true,
      result: true,
      scheduledFor: true,
      permit: { select: { permitType: true, municipality: true, assignedUserId: true, jobId: true, job: { select: { projectManagerId: true } } } },
    },
  });
  let raised = 0;
  for (const i of rows) {
    try {
      const alert = alertForInspection(i, today);
      if (alert && (await raise(alert, { jobId: i.permit.jobId, assignedUserId: i.permit.assignedUserId, projectManagerId: i.permit.job.projectManagerId }))) raised += 1;
    } catch (err) {
      logger.exception(err, { where: "permits.raiseInspectionAlerts", inspectionId: i.id });
    }
  }
  return { scanned: rows.length, raised };
}

async function closeOvertaken(prefix: string, live: Set<string>, actorUserId: string | null, because: string): Promise<number> {
  const open = await prisma.task.findMany({ where: { sourceKey: { startsWith: prefix }, status: { in: [...OPEN_TASK_STATUSES] } }, select: { sourceKey: true } });
  let closed = 0;
  for (const key of new Set(open.map((t) => t.sourceKey as string))) {
    if (live.has(key)) continue;
    closed += (await closeAutoTask(key, { actorUserId, outcome: "COMPLETED", because })).closed;
  }
  return closed;
}

/** After any change to a permit: close its follow-ups the record has overtaken. Never throws. */
export async function settlePermitAlerts(permitId: string, actorUserId: string | null): Promise<number> {
  try {
    const p = await prisma.jobPermit.findUnique({ where: { id: permitId }, select: PERMIT_SELECT });
    if (!p) return 0;
    const status = p.status.toLowerCase().replace(/_/g, " ");
    return await closeOvertaken(permitAlertPrefix(permitId), liveAlertKeys(p), actorUserId, `The permit was updated (now ${status})`);
  } catch (err) {
    logger.exception(err, { where: "permits.settlePermitAlerts", permitId });
    return 0;
  }
}

/** After a result, a cancellation, a new date or a delete: close the inspection's "be ready" task. Never throws. */
export async function settleInspectionAlerts(inspectionId: string, actorUserId: string | null): Promise<number> {
  try {
    const i = await prisma.jobPermitInspection.findUnique({ where: { id: inspectionId }, select: { id: true, result: true, scheduledFor: true } });
    const live = i ? liveInspectionKey(i) : null;
    const because = !i ? "The inspection was removed" : i.result === "SCHEDULED" ? "The inspection was moved" : `The inspection result was recorded (${i.result.toLowerCase()})`;
    return await closeOvertaken(inspectionAlertPrefix(inspectionId), new Set(live ? [live] : []), actorUserId, because);
  } catch (err) {
    logger.exception(err, { where: "permits.settleInspectionAlerts", inspectionId });
    return 0;
  }
}
