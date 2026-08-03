import { prisma } from "@/lib/db/prisma";
import type { RoleName } from "@/generated/prisma/client";

/**
 * Who gets a task email, and — just as importantly — who deliberately does not.
 *
 * Every suppression here is a decision someone will eventually ask about
 * ("why didn't Frank get it?"), so this returns the skips alongside the
 * recipients rather than silently filtering. Callers log them; the task
 * timeline records the sends.
 */

export type RecipientReason = "assignee" | "assignor" | "watcher" | "mentioned";

export type TaskRecipient = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: RoleName;
  reason: RecipientReason;
};

export type SkipReason =
  | "muted" // user turned task mail off
  | "inactive" // deactivated CRM row
  | "no-email"
  | "is-actor" // they just did the thing; telling them is noise
  | "duplicate";

export type SkippedRecipient = {
  userId: string;
  reason: SkipReason;
};

/**
 * When one person is both, say, assignee and watcher, we email them once and
 * the message is framed by the strongest relationship. Assignee outranks
 * everything: "you now own this" beats "something you follow changed".
 */
const REASON_RANK: Record<RecipientReason, number> = {
  assignee: 4,
  assignor: 3,
  mentioned: 2,
  watcher: 1,
};

export type Candidate = { userId: string | null | undefined; reason: RecipientReason };

/**
 * Resolve raw candidates to a deduped, filtered recipient list.
 *
 * `suppressUserId` is normally the person who triggered the change. Mailing
 * someone about their own click is the fastest way to teach them to ignore
 * task mail, which then costs us the assignment they actually needed to read.
 */
export async function resolveRecipients(input: {
  candidates: Candidate[];
  suppressUserId?: string | null;
}): Promise<{ recipients: TaskRecipient[]; skipped: SkippedRecipient[] }> {
  const skipped: SkippedRecipient[] = [];

  // Collapse to the strongest reason per user before touching the DB.
  const best = new Map<string, RecipientReason>();
  for (const c of input.candidates) {
    if (!c.userId) continue;
    const existing = best.get(c.userId);
    if (existing) {
      skipped.push({ userId: c.userId, reason: "duplicate" });
      if (REASON_RANK[c.reason] <= REASON_RANK[existing]) continue;
    }
    best.set(c.userId, c.reason);
  }

  if (input.suppressUserId && best.has(input.suppressUserId)) {
    best.delete(input.suppressUserId);
    skipped.push({ userId: input.suppressUserId, reason: "is-actor" });
  }

  if (best.size === 0) return { recipients: [], skipped };

  const users = await prisma.user.findMany({
    where: { id: { in: [...best.keys()] } },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      taskEmailsEnabled: true,
      role: { select: { name: true } },
    },
  });

  const recipients: TaskRecipient[] = [];
  for (const u of users) {
    if (!u.isActive) {
      skipped.push({ userId: u.id, reason: "inactive" });
      continue;
    }
    if (!u.email?.trim()) {
      skipped.push({ userId: u.id, reason: "no-email" });
      continue;
    }
    if (!u.taskEmailsEnabled) {
      skipped.push({ userId: u.id, reason: "muted" });
      continue;
    }
    recipients.push({
      userId: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role.name,
      reason: best.get(u.id)!,
    });
  }

  return { recipients, skipped };
}

/**
 * Everyone with a standing interest in a task: its assignee, whoever raised
 * it, and any explicit watchers. Used for completion mail, where the point is
 * to close the loop with the people who were waiting on the answer.
 */
export async function taskAudience(taskId: string): Promise<Candidate[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      assignedUserId: true,
      createdByUserId: true,
      watchers: { select: { userId: true } },
    },
  });
  if (!task) return [];

  return [
    { userId: task.assignedUserId, reason: "assignee" as const },
    { userId: task.createdByUserId, reason: "assignor" as const },
    ...task.watchers.map((w) => ({ userId: w.userId, reason: "watcher" as const })),
  ];
}
