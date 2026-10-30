import { z } from "zod";
import { Prisma, type RoleName, type TaskStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { jobAccessWhere } from "@/lib/access/records";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { jobText } from "@/lib/labels/job";
import { absoluteUrl } from "@/lib/notifications/links";
import { createTask } from "@/lib/tasks/create";
import { updateTask } from "@/lib/tasks/update";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";

/**
 * CareyOS Work → Construction CRM. Work sends a board item here as an
 * ordinary CRM task (through createTask, so it is a first-class task with
 * events, mail and visibility) and afterwards only READS its status.
 *
 * Rules:
 *  - Every write is done AS the person who pressed "Send" in Work. They must
 *    be an active CRM user, and the job must be one they can see in the CRM
 *    (jobAccessWhere) — Work can never reach a job its user couldn't open here.
 *  - `sourceKey = "work:<idempotencyKey>"`, unique for these rows (migration
 *    20261112120000_work_integration): a retried send returns the same task.
 *  - Work may cancel only tasks it created.
 */

export const SOURCE_KEY_PREFIX = "work:";

export class WorkApiError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "WorkApiError";
  }
}

export type WorkTaskView = {
  taskId: string;
  url: string;
  title: string;
  status: TaskStatus;
  assigneeEmail: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  jobId: string | null;
  jobLabel: string | null;
  updatedAt: string;
  completedAt: string | null;
  createdFromWork: boolean;
};

const VIEW_SELECT = {
  id: true,
  title: true,
  status: true,
  dueAt: true,
  updatedAt: true,
  completedAt: true,
  sourceKey: true,
  jobId: true,
  job: { select: JOB_LABEL_SELECT },
  assignedTo: { select: { email: true, firstName: true, lastName: true } },
} satisfies Prisma.TaskSelect;

type ViewRow = Prisma.TaskGetPayload<{ select: typeof VIEW_SELECT }>;

/** Calendar day of a CRM due instant in the office time zone. */
function dueDay(d: Date | null): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIME_ZONE || "America/New_York" }).format(d);
}

export function toView(t: ViewRow): WorkTaskView {
  return {
    taskId: t.id,
    url: absoluteUrl(`/tasks?task=${t.id}`),
    title: t.title,
    status: t.status,
    assigneeEmail: t.assignedTo?.email ?? null,
    assigneeName: t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}`.trim() : null,
    dueDate: dueDay(t.dueAt),
    jobId: t.jobId,
    jobLabel: t.job ? jobText(t.job) : null,
    updatedAt: t.updatedAt.toISOString(),
    completedAt: t.completedAt?.toISOString() ?? null,
    createdFromWork: Boolean(t.sourceKey?.startsWith(SOURCE_KEY_PREFIX)),
  };
}

/** The active CRM user behind a Work email, or a 403. */
export async function actingUser(email: string): Promise<{ id: string; role: RoleName }> {
  const user = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase(), isActive: true },
    select: { id: true, role: { select: { name: true } } },
  });
  if (!user) throw new WorkApiError(403, "That person doesn't have an active Construction CRM account.");
  return { id: user.id, role: user.role.name };
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export async function listJobsFor(actingEmail: string, q: string) {
  const viewer = await actingUser(actingEmail);
  const text = q.trim();
  const jobs = await prisma.job.findMany({
    where: {
      AND: [
        jobAccessWhere(viewer),
        { currentStage: { isClosed: false } },
        text
          ? {
              OR: [
                { jobNumber: { contains: text, mode: "insensitive" } },
                { title: { contains: text, mode: "insensitive" } },
                { lead: { propertyAddress1: { contains: text, mode: "insensitive" } } },
                { lead: { fullName: { contains: text, mode: "insensitive" } } },
              ],
            }
          : {},
      ],
    },
    select: { ...JOB_LABEL_SELECT, currentStage: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  return jobs.map((j) => ({
    jobId: j.id,
    jobNumber: j.jobNumber,
    label: jobText(j),
    stage: j.currentStage.name,
    url: absoluteUrl(`/jobs/${j.id}`),
  }));
}

// ── Users (for assignee matching) ───────────────────────────────────────────

export async function listActiveUsers() {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, email: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  return users.map((u) => ({ id: u.id, email: u.email.toLowerCase(), name: `${u.firstName} ${u.lastName}`.trim() }));
}

// ── Create ──────────────────────────────────────────────────────────────────

export const createFromWorkSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  actingEmail: z.string().trim().email(),
  jobId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(255),
  description: z.string().max(20_000).nullish(),
  assigneeEmail: z.string().trim().email().nullish(),
  watcherEmails: z.array(z.string().trim().email()).max(20).default([]),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  status: z.enum(["PENDING", "IN_PROGRESS"]).default("PENDING"),
  workItemUrl: z.string().url().max(2000).nullish(),
});
export type CreateFromWorkInput = z.input<typeof createFromWorkSchema>;

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

async function findByKey(sourceKey: string) {
  return prisma.task.findFirst({ where: { sourceKey }, select: VIEW_SELECT });
}

/**
 * Create the CRM task for a Work item, or return the one already created for
 * this idempotency key (`created: false`). Safe to retry.
 */
export async function createFromWork(raw: unknown): Promise<{ task: WorkTaskView; created: boolean }> {
  const parsed = createFromWorkSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new WorkApiError(400, `${i?.path.join(".") || "body"}: ${i?.message ?? "invalid"}`);
  }
  const input = parsed.data;
  const sourceKey = `${SOURCE_KEY_PREFIX}${input.idempotencyKey}`;

  // Access first, THEN the idempotent replay: a replayed key must never hand
  // the task to someone who couldn't have created it.
  const viewer = await actingUser(input.actingEmail);
  const job = await prisma.job.findFirst({ where: { AND: [{ id: input.jobId }, jobAccessWhere(viewer)] }, select: { id: true } });
  if (!job) throw new WorkApiError(404, "Job not found, or not one this person can see in the CRM.");

  const existing = await findByKey(sourceKey);
  if (existing) return { task: toView(existing), created: false };

  let assignedUserId: string | null = null;
  if (input.assigneeEmail) {
    const a = await prisma.user.findFirst({ where: { email: input.assigneeEmail.toLowerCase(), isActive: true }, select: { id: true } });
    if (!a) throw new WorkApiError(400, `${input.assigneeEmail} doesn't have an active Construction CRM account.`);
    assignedUserId = a.id;
  }
  const watchers = input.watcherEmails.length
    ? await prisma.user.findMany({ where: { email: { in: input.watcherEmails.map((e) => e.toLowerCase()) }, isActive: true }, select: { id: true } })
    : [];

  const description = [input.description?.trim(), input.workItemUrl ? `From CareyOS Work: ${input.workItemUrl}` : null]
    .filter(Boolean)
    .join("\n\n");

  let taskId: string;
  try {
    const task = await createTask(
      {
        title: input.title,
        description: description || null,
        priority: input.priority,
        // A date-only due day is pinned at noon UTC, like a manual task (lib/calendar/schedule.ts).
        dueAt: input.dueDate ? new Date(`${input.dueDate}T12:00:00.000Z`) : null,
        assignedUserId,
        createdByUserId: viewer.id,
        jobId: job.id,
        watcherUserIds: watchers.map((w) => w.id),
        source: "work",
        sourceKey,
      },
      { actorUserId: viewer.id },
    );
    taskId = task.id;
  } catch (e) {
    // Two sends raced past the lookup; the unique index let exactly one win.
    if (isUniqueViolation(e)) {
      const winner = await findByKey(sourceKey);
      if (winner) return { task: toView(winner), created: false };
    }
    throw e;
  }

  if (input.status === "IN_PROGRESS") {
    await updateTask({ id: taskId, input: { status: "IN_PROGRESS" }, actorUserId: viewer.id });
  }
  const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: VIEW_SELECT });
  return { task: toView(row), created: true };
}

// ── Read ────────────────────────────────────────────────────────────────────

/** Status mirror for tasks Work created. Unknown or foreign ids are simply absent. */
export async function tasksByIds(ids: string[]): Promise<WorkTaskView[]> {
  const unique = Array.from(new Set(ids)).slice(0, 200);
  if (unique.length === 0) return [];
  const rows = await prisma.task.findMany({
    where: { id: { in: unique }, sourceKey: { startsWith: SOURCE_KEY_PREFIX } },
    select: VIEW_SELECT,
  });
  return rows.map(toView);
}

/** Open CRM tasks assigned to a person — Work's "My Work" shows them read-only. */
export async function openTasksFor(email: string): Promise<WorkTaskView[]> {
  const rows = await prisma.task.findMany({
    where: {
      assignedTo: { email: email.trim().toLowerCase(), isActive: true },
      status: { in: [...OPEN_TASK_STATUSES] },
      activatedAt: { not: null },
    },
    select: VIEW_SELECT,
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 200,
  });
  return rows.map(toView);
}

// ── Cancel ──────────────────────────────────────────────────────────────────

/** Cancel a task Work created, as the person asking. Already closed → returned unchanged. */
export async function cancelFromWork(taskId: string, actingEmail: string): Promise<WorkTaskView> {
  const viewer = await actingUser(actingEmail);
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: VIEW_SELECT });
  if (!task || !task.sourceKey?.startsWith(SOURCE_KEY_PREFIX)) throw new WorkApiError(404, "Task not found.");
  if (task.status === "COMPLETED" || task.status === "CANCELLED") return toView(task);
  if (task.jobId) {
    const visible = await prisma.job.findFirst({ where: { AND: [{ id: task.jobId }, jobAccessWhere(viewer)] }, select: { id: true } });
    if (!visible) throw new WorkApiError(404, "Task not found.");
  }
  await updateTask({ id: taskId, input: { status: "CANCELLED" }, actorUserId: viewer.id });
  return toView(await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: VIEW_SELECT }));
}
