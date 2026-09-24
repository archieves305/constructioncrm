/**
 * Nudge rate limit, as pure functions so the sheet can grey the button out
 * with the same rule the route enforces. The ledger is the task's own
 * timeline: the latest NUDGED row is the last nudge.
 */
export const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type EventLike = { type: string; createdAt: string | Date };

export function lastNudgeAt(events: EventLike[]): Date | null {
  let latest: Date | null = null;
  for (const e of events) {
    if (e.type !== "NUDGED") continue;
    const d = e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt);
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

/** 0 when a nudge is allowed now. */
export function nudgeCooldownRemainingMs(events: EventLike[], now: Date = new Date()): number {
  const last = lastNudgeAt(events);
  if (!last) return 0;
  return Math.max(0, last.getTime() + NUDGE_COOLDOWN_MS - now.getTime());
}

export function nudgeCooldownMessage(assigneeFirstName: string, remainingMs: number): string {
  const hoursAgo = Math.round((NUDGE_COOLDOWN_MS - remainingMs) / 3_600_000);
  const ago = hoursAgo < 1 ? "just now" : hoursAgo === 1 ? "an hour ago" : `${hoursAgo} hours ago`;
  return `${assigneeFirstName} was already nudged about this ${ago} — give it until tomorrow.`;
}
