import { prisma } from "@/lib/db/prisma";
import type { NotificationCategory, NotificationEmailMode, RoleName } from "@/generated/prisma/client";

/**
 * Who gets a task email, and — just as importantly — who deliberately does not.
 *
 * Every suppression here is a decision someone will eventually ask about
 * ("why didn't Frank get it?"), so this returns the skips alongside the
 * recipients rather than silently filtering. Callers log them; the task
 * timeline records the sends.
 */

export type RecipientReason =
  | "assignee"
  | "assignor"
  | "watcher"
  | "mentioned"
  | "manager" // escalation: ADMIN/MANAGER pulled in at the second threshold
  | "reminder-setter" // custom reminder: whoever asked for it, if not the assignee
  | "owner" // the job's PM or the case manager, told about engine work on their subject
  | "actor"; // the person who did it — a bell receipt, never mail

/**
 * Which per-user switch a mail is subject to. "task" is the master switch
 * (assignment, completion, blocked, mention); the other three sit under it
 * and can each be muted on their own.
 */
export type NotifyChannel = "task" | "escalation" | "reminder" | "nudge";

export type TaskRecipient = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: RoleName;
  reason: RecipientReason;
  /**
   * Notifications v2 delivery facts. `emailAllowed` is "has an address";
   * what to do with it is the person's `emailMode` + muted categories.
   * `emailBlock` is the legacy switch that would have stopped this mail,
   * for the log. Always populated; only `includeMuted` callers see rows
   * where `emailAllowed` is false.
   */
  emailAllowed: boolean;
  emailBlock: SkipReason | null;
  emailMode: NotificationEmailMode;
  mutedCategories: NotificationCategory[];
  digestWindows: string[];
};

export type SkipReason =
  | "muted" // user turned task mail off
  | "inactive" // deactivated CRM row
  | "no-email"
  | "is-actor" // they just did the thing; telling them is noise
  | "duplicate"
  | "channel-muted"; // master switch on, but this particular kind muted

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
  manager: 3,
  owner: 3,
  mentioned: 2,
  "reminder-setter": 2,
  watcher: 1,
  actor: 0,
};

const CHANNEL_FIELD = {
  escalation: "escalationEmailsEnabled",
  reminder: "reminderDigestEnabled",
  nudge: "nudgeEmailsEnabled",
} as const;

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
  channel?: NotifyChannel;
  /**
   * Notifications v2: return people the legacy switches would have muted
   * (with `emailAllowed: false`) instead of dropping them, so the bell row
   * still exists. Inactive users and the actor are skipped either way.
   */
  includeMuted?: boolean;
}): Promise<{ recipients: TaskRecipient[]; skipped: SkippedRecipient[] }> {
  const skipped: SkippedRecipient[] = [];
  const channel = input.channel ?? "task";

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
      escalationEmailsEnabled: true,
      reminderDigestEnabled: true,
      nudgeEmailsEnabled: true,
      notificationEmailMode: true,
      mutedCategories: true,
      digestWindows: true,
      role: { select: { name: true } },
    },
  });

  const recipients: TaskRecipient[] = [];
  for (const u of users) {
    if (!u.isActive) {
      skipped.push({ userId: u.id, reason: "inactive" });
      continue;
    }
    const hasEmail = Boolean(u.email?.trim());
    const block: SkipReason | null = !hasEmail
      ? "no-email"
      : !u.taskEmailsEnabled
        ? "muted"
        : channel !== "task" && !u[CHANNEL_FIELD[channel]]
          ? "channel-muted"
          : null;
    if (block && !input.includeMuted) {
      skipped.push({ userId: u.id, reason: block });
      continue;
    }
    recipients.push({
      userId: u.id,
      email: u.email ?? "",
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role.name,
      reason: best.get(u.id)!,
      emailAllowed: hasEmail,
      emailBlock: block,
      emailMode: u.notificationEmailMode ?? "DIGEST",
      mutedCategories: u.mutedCategories ?? [],
      digestWindows: u.digestWindows ?? [],
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

/**
 * Everyone who manages the team, for the second escalation threshold. Active
 * only; muting is applied later by `resolveRecipients` like any other
 * candidate.
 */
export async function managerCandidates(): Promise<Candidate[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { name: { in: ["ADMIN", "MANAGER"] } } },
    select: { id: true },
  });
  return users.map((u) => ({ userId: u.id, reason: "manager" as const }));
}
