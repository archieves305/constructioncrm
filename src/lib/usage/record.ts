import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { clampAt, subjectFor, type UsageEventName } from "./events";

/** How long usage rows are kept. */
export const KEEP_DAYS = 180;

/** Store a batch of usage events for one person. Never throws: usage is best-effort. */
export async function recordUsage(userId: string, source: "phone" | "web", events: { event: UsageEventName; subject?: string; at: string }[]): Promise<number> {
  const now = Date.now();
  try {
    const r = await prisma.usageEvent.createMany({
      data: events.map((e) => ({ userId, source, event: e.event, subjectType: subjectFor(e.event, e.subject), at: clampAt(e.at, now) })),
    });
    // Now and then, drop what is older than the retention period.
    if (Math.random() < 0.02) {
      void prisma.usageEvent.deleteMany({ where: { at: { lt: new Date(now - KEEP_DAYS * 86_400_000) } } }).catch(() => undefined);
    }
    return r.count;
  } catch (err) {
    logger.warn("usage events not stored", { message: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

/** Weekly active people and the most-used events, for the owner summary. */
export async function usageSummary(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [people, bySource, top] = await Promise.all([
    prisma.usageEvent.groupBy({ by: ["userId"], where: { at: { gte: since } } }),
    prisma.usageEvent.groupBy({ by: ["source"], where: { at: { gte: since } }, _count: { _all: true } }),
    prisma.usageEvent.groupBy({ by: ["event", "subjectType"], where: { at: { gte: since } }, _count: { _all: true }, orderBy: { _count: { event: "desc" } }, take: 12 }),
  ]);
  const phonePeople = await prisma.usageEvent.groupBy({ by: ["userId"], where: { at: { gte: since }, source: "phone" } });
  return {
    days,
    activePeople: people.length,
    phonePeople: phonePeople.length,
    events: Object.fromEntries(bySource.map((s) => [s.source, s._count._all])) as Record<string, number>,
    top: top.map((t) => ({ event: t.event, subject: t.subjectType, count: t._count._all })),
  };
}
