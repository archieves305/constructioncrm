import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { closeAutoTask } from "@/lib/tasks/auto-tasks";
import { createTask } from "@/lib/tasks/create";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { pinAllDay, todayKey, type DayKey } from "@/lib/time/zone";
import { userForJobRole } from "@/lib/workflows/roles";
import { installTaskPrefix, planInstallTask } from "./install";
import { notify } from "@/lib/notifications/notify";
import { formatAddressLine } from "@/lib/labels/address";
import { dayOfDate } from "@/lib/permits/alerts";

/**
 * A crew's install date as an ordinary task for the person who has to have
 * the job ready. Every write to a crew assignment calls `syncInstallTask`:
 * it closes the task a moved, cleared or removed date has overtaken and
 * raises the one the date now calls for.
 *
 * A task is raised once per source key, whatever became of it — completing
 * the get-ready task does not bring it back on the next save.
 */

/** Who gets it: the job's superintendent, then its project manager, and failing both the oldest admin. */
async function ownerFor(jobId: string, projectManagerId: string | null): Promise<string | null> {
  const superintendent = await userForJobRole(jobId, "SUPERINTENDENT");
  if (superintendent) return superintendent;
  const manager = projectManagerId ?? (await userForJobRole(jobId, "PROJECT_MANAGER"));
  if (manager) return manager;
  const admin = await prisma.user.findFirst({ where: { isActive: true, role: { name: "ADMIN" } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return admin?.id ?? null;
}

export type InstallSync = { closed: number; raised: boolean };

/**
 * Bring the assignment's get-ready task in line with its install date. Pass
 * the id of an assignment that was just deleted too — its open task closes.
 * Never throws: the assignment was saved whatever happens here.
 */
export async function syncInstallTask(
  assignmentId: string,
  actorUserId: string | null,
  opts: { notify?: "after" | "inline"; today?: DayKey } = {},
): Promise<InstallSync> {
  const out: InstallSync = { closed: 0, raised: false };
  try {
    const a = await prisma.crewAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, installDate: true, jobId: true, crew: { select: { name: true } }, job: { select: { projectManagerId: true } } },
    });
    const plan = a ? planInstallTask(a, opts.today ?? todayKey()) : null;

    const prefix = installTaskPrefix(assignmentId);
    const open = await prisma.task.findMany({ where: { sourceKey: { startsWith: prefix }, status: { in: [...OPEN_TASK_STATUSES] } }, select: { sourceKey: true } });
    const because = !a ? "The crew was taken off the job" : !a.installDate ? "The install date was cleared" : "The install date was moved";
    for (const key of new Set(open.map((t) => t.sourceKey as string))) {
      if (plan && key === plan.sourceKey) continue;
      out.closed += (await closeAutoTask(key, { actorUserId, outcome: "CANCELLED", because })).closed;
    }

    if (!a || !plan) return out;
    const seen = await prisma.task.findFirst({ where: { sourceKey: plan.sourceKey }, select: { id: true } });
    if (seen) return out;
    const owner = await ownerFor(a.jobId, a.job.projectManagerId);
    if (!owner) return out;
    await createTask(
      {
        title: plan.title,
        description: plan.description,
        priority: "HIGH",
        dueAt: pinAllDay(plan.dueDay),
        allDay: true,
        assignedUserId: owner,
        createdByUserId: actorUserId ?? owner,
        jobId: a.jobId,
        source: "auto",
        sourceKey: plan.sourceKey,
      },
      { actorUserId, notify: opts.notify ?? "after" },
    );
    out.raised = true;
  } catch (err) {
    logger.exception(err, { where: "crews.syncInstallTask", assignmentId });
  }
  return out;
}

export type InstallTaskSummary = { id: string; status: string; dueAt: string | null; assignedTo: { firstName: string; lastName: string } | null };

/** The open get-ready task of each assignment, for the Crews tab. */
export async function openInstallTasks(assignmentIds: string[]): Promise<Map<string, InstallTaskSummary>> {
  const out = new Map<string, InstallTaskSummary>();
  if (assignmentIds.length === 0) return out;
  const tasks = await prisma.task.findMany({
    where: { OR: assignmentIds.map((id) => ({ sourceKey: { startsWith: installTaskPrefix(id) } })), status: { in: [...OPEN_TASK_STATUSES] } },
    select: { id: true, status: true, dueAt: true, sourceKey: true, assignedTo: { select: { firstName: true, lastName: true } } },
  });
  for (const t of tasks) {
    const id = assignmentIds.find((a) => t.sourceKey?.startsWith(installTaskPrefix(a)));
    if (id) out.set(id, { id: t.id, status: t.status, dueAt: t.dueAt?.toISOString() ?? null, assignedTo: t.assignedTo });
  }
  return out;
}

/**
 * Tell the crew an install day was set, moved or given a start time: the
 * job's field-assigned crew leads and any crew member with a login, never the
 * person who made the change. On a crew phone it buzzes (kind crew.scheduled)
 * and opens the week, where they answer Got it / Can't make it. Best effort:
 * a failure is logged, the date change stands.
 */
export async function notifyCrewOfInstall(assignmentId: string, actorUserId: string | null): Promise<void> {
  try {
    const a = await prisma.crewAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        installDate: true,
        startMinutes: true,
        jobId: true,
        crew: { select: { name: true, members: { where: { userId: { not: null } }, select: { userId: true } } } },
        job: { select: { leadId: true, lead: { select: { propertyAddress1: true, city: true } }, fieldAssignments: { select: { userId: true } } } },
      },
    });
    if (!a?.installDate) return;
    const ids = new Set<string>([...a.job.fieldAssignments.map((f) => f.userId), ...a.crew.members.map((m) => m.userId as string)]);
    if (actorUserId) ids.delete(actorUserId);
    if (!ids.size) return;
    const day = dayOfDate(a.installDate);
    const when = new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    const start = a.startMinutes != null ? ` at ${Math.floor(a.startMinutes / 60) % 12 || 12}:${String(a.startMinutes % 60).padStart(2, "0")} ${a.startMinutes < 720 ? "AM" : "PM"}` : "";
    const where = formatAddressLine(a.job.lead) || "the job";
    await notify({
      kind: "crew.scheduled",
      candidates: [...ids].map((userId) => ({ userId, reason: "owner" as const })),
      actorUserId,
      subject: { type: "job", id: assignmentId, jobId: a.jobId, leadId: a.job.leadId },
      title: `${a.crew.name}: ${when}${start} · ${where}`,
      body: "Open KNU Field to say Got it or Can't make it.",
      href: `/jobs/${a.jobId}?tab=field&sub=crews`,
    });
  } catch (err) {
    logger.exception(err, { where: "crews.notifyCrewOfInstall", assignmentId });
  }
}
