import { prisma } from "@/lib/db/prisma";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";
import { overdueWhere } from "@/lib/calendar/status";
import { dayKey, endOfDayIn, localParts, startOfDayIn, weekdayOf } from "@/lib/time/zone";
import { pushToUsers } from "./push-send";

/**
 * The morning "your day" push: one buzz on a working day at 7 am office time
 * for each person with a phone signed in and push on — how many of their tasks
 * are due today and how many are overdue. Nothing when both are zero. Sent
 * once per person per day (the ledger is the idempotency table, key
 * `my-day:<day>`), so the cron may run it more than once.
 */

/** The text, or null for nothing to say. */
export function myDayText(dueToday: number, overdue: number): { title: string; body: string } | null {
  if (dueToday <= 0 && overdue <= 0) return null;
  const parts: string[] = [];
  if (dueToday > 0) parts.push(`${dueToday} task${dueToday === 1 ? "" : "s"} due today`);
  if (overdue > 0) parts.push(`${overdue} overdue`);
  return { title: "Your day", body: `${parts.join(", ")}. Tap to see them.` };
}

/** 7 am to before 10 am on a weekday in the office: a late cron still sends, an evening one never does. */
export function isMyDayWindow(now: Date): boolean {
  const day = dayKey(now);
  const wd = weekdayOf(day);
  if (wd === 0 || wd === 6) return false;
  const { hour } = localParts(now);
  return hour >= 7 && hour < 10;
}

export async function runMyDay(opts: { now?: Date; dryRun?: boolean; force?: boolean } = {}): Promise<{ window: boolean; people: number; sent: number; skipped: number }> {
  const now = opts.now ?? new Date();
  if (!opts.force && !isMyDayWindow(now)) return { window: false, people: 0, sent: 0, skipped: 0 };
  const day = dayKey(now);
  const devices = await prisma.mobileDevice.findMany({
    where: { revokedAt: null, pushToken: { not: null }, tokens: { some: { endedAt: null } }, user: { isActive: true, pushEnabled: true } },
    select: { userId: true },
    distinct: ["userId"],
  });
  let sent = 0;
  let skipped = 0;
  for (const { userId } of devices) {
    const mine = { assignedUserId: userId, ...ACTIVE_OPEN_WHERE };
    const [dueToday, overdue] = await Promise.all([
      prisma.task.count({ where: { ...mine, dueAt: { gte: startOfDayIn(day), lte: endOfDayIn(day) } } }),
      prisma.task.count({ where: { AND: [mine, overdueWhere(now)] } }),
    ]);
    const text = myDayText(dueToday, overdue);
    if (!text) {
      skipped++;
      continue;
    }
    if (opts.dryRun) {
      sent++;
      continue;
    }
    // Claim the day first: a second run (or a second droplet) sends nothing.
    const claimed = await prisma.apiIdempotency
      .create({ data: { userId, key: `my-day:${day}`, route: "cron my-day", statusCode: 200 } })
      .then(() => true)
      .catch(() => false);
    if (!claimed) {
      skipped++;
      continue;
    }
    await pushToUsers({ userIds: [userId], kind: "my_day", subject: {}, text: { ...text, path: "/" } });
    sent++;
  }
  return { window: true, people: devices.length, sent, skipped };
}
