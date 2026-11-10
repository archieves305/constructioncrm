import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { jobsInvolvingUserWhere } from "@/lib/jobs/involvement";
import { formatAddressLine } from "@/lib/labels/address";
import { toDbDate } from "@/lib/labor/dates";
import { dayOfDate } from "@/lib/permits/alerts";
import { addDayKeys, type DayKey } from "@/lib/time/zone";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import type { z } from "zod";
import type { crewJobCard, crewToday, crewWeek, crewWeekItem } from "@/lib/mobile-api/crew";

/**
 * The crew mode's day and week (docs/audits/crew-experience): the open jobs a
 * person is on — the one "on the job" rule, `jobsInvolvingUserWhere` — as a
 * crew sees them. Nothing here selects money or the customer's contact, so
 * nothing can leak it. The pure parts (ordering, grouping) are tested.
 */
type Viewer = { id: string; role: RoleName };
type Card = z.infer<typeof crewJobCard>;
type WeekItem = z.infer<typeof crewWeekItem>;

/** Install days and tasks due today first, then the jobs with the most of the person's work. */
export function orderCards(cards: Card[], today: DayKey): Card[] {
  const dueToday = (c: Card) => c.tasks.filter((t) => t.dueAt !== null && t.dueAt.slice(0, 10) <= today).length;
  return [...cards].sort(
    (a, b) =>
      Number(b.installToday) - Number(a.installToday) ||
      dueToday(b) - dueToday(a) ||
      b.tasks.length - a.tasks.length ||
      a.street.localeCompare(b.street),
  );
}

/** Seven days from `from`, each with its items in start-time order (unset times last). */
export function groupWeek(items: (WeekItem & { day: DayKey })[], from: DayKey): z.infer<typeof crewWeek>["days"] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDayKeys(from, i);
    const day = items
      .filter((x) => x.day === date)
      .sort((a, b) => (a.startMinutes ?? 9999) - (b.startMinutes ?? 9999) || a.street.localeCompare(b.street))
      .map(({ day: _d, ...rest }) => { void _d; return rest; });
    return { date, items: day };
  });
}

const street = (lead: { propertyAddress1: string | null; city: string | null } | null, fallback: string) =>
  (lead?.propertyAddress1?.trim() || formatAddressLine(lead) || fallback).trim();

/** The open jobs this person is on (the crew rule). */
function onJobWhere(viewer: Viewer) {
  return { AND: [jobsInvolvingUserWhere(viewer.id), { currentStage: { isClosed: false } }] };
}

/** Day bounds that hold an install date pinned at noon UTC (`pinAllDay`). */
function dayRange(from: DayKey, days: number) {
  return { gte: new Date(`${from}T00:00:00.000Z`), lt: new Date(`${addDayKeys(from, days)}T00:00:00.000Z`) };
}

export async function loadCrewToday(viewer: Viewer, today: DayKey): Promise<z.infer<typeof crewToday>> {
  const jobs = await prisma.job.findMany({
    where: onJobWhere(viewer),
    select: {
      id: true,
      title: true,
      jobNumber: true,
      lead: { select: { propertyAddress1: true, city: true } },
      projectManager: { select: { firstName: true, lastName: true, phone: true } },
      crewAssignments: { where: { installDate: dayRange(today, 1) }, select: { startMinutes: true } },
      dailyLogs: { where: { logDate: toDbDate(today) }, select: { status: true } },
      tasks: {
        where: { assignedUserId: viewer.id, ...ACTIVE_OPEN_WHERE },
        select: { id: true, title: true, status: true, priority: true, dueAt: true },
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        take: 20,
      },
      _count: { select: { fieldIssues: { where: { status: { in: [...OPEN_TASK_STATUSES] } } } } },
    },
    take: 30,
  });

  const cards: Card[] = jobs.map((j) => {
    const starts = j.crewAssignments.map((c) => c.startMinutes).filter((m): m is number => m != null);
    return {
      jobId: j.id,
      street: street(j.lead, j.title || j.jobNumber),
      city: j.lead?.city ?? null,
      title: j.title,
      startMinutes: starts.length ? Math.min(...starts) : null,
      installToday: j.crewAssignments.length > 0,
      pm: j.projectManager ? { name: `${j.projectManager.firstName} ${j.projectManager.lastName}`.trim(), phone: j.projectManager.phone ?? null } : null,
      tasks: j.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt ? t.dueAt.toISOString() : null })),
      logStatus: (j.dailyLogs[0]?.status ?? "NONE") as Card["logStatus"],
      openIssues: j._count.fieldIssues,
    };
  });

  const nextRow = await prisma.crewAssignment.findFirst({
    where: { installDate: { gte: new Date(`${addDayKeys(today, 1)}T00:00:00.000Z`) }, job: onJobWhere(viewer) },
    orderBy: { installDate: "asc" },
    select: { installDate: true, jobId: true, job: { select: { title: true, jobNumber: true, lead: { select: { propertyAddress1: true, city: true } } } } },
  });

  return {
    date: today,
    jobs: orderCards(cards, today),
    next: nextRow?.installDate ? { date: dayOfDate(nextRow.installDate), jobId: nextRow.jobId, street: street(nextRow.job.lead, nextRow.job.title || nextRow.job.jobNumber) } : null,
  };
}

export async function loadCrewWeek(viewer: Viewer, from: DayKey): Promise<z.infer<typeof crewWeek>> {
  const rows = await prisma.crewAssignment.findMany({
    where: { installDate: dayRange(from, 7), job: onJobWhere(viewer) },
    select: {
      id: true,
      jobId: true,
      installDate: true,
      startMinutes: true,
      confirmation: true,
      crew: { select: { name: true } },
      job: { select: { title: true, jobNumber: true, lead: { select: { propertyAddress1: true, city: true } } } },
    },
    take: 200,
  });
  const items = rows.map((r) => ({
    day: dayOfDate(r.installDate as Date),
    crewAssignmentId: r.id,
    jobId: r.jobId,
    street: street(r.job.lead, r.job.title || r.job.jobNumber),
    crewName: r.crew?.name ?? null,
    startMinutes: r.startMinutes,
    confirmation: r.confirmation,
  }));
  return { from, days: groupWeek(items, from) };
}
