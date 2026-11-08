/**
 * What the phone keeps of the CRM between launches, and for how long.
 * Pure, so it is tested without the app. Money never reaches the phone (the
 * CRM redacts it and the app's contracts drop unknown fields), and document
 * files are stored apart (docs/open.ts).
 */
export const PERSIST_ROOTS = new Set([
  "calendar",
  "jobs",
  "job",
  "tasks",
  "task",
  "files",
  "inspections",
  "issues",
  "dailyLog",
  "crew",
  "users",
  "me",
]);

/** A week: older than that, the copy is more likely to mislead than help. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** The background refresh runs at most this often. */
export const WARM_EVERY_MS = 15 * 60_000;
/** How much the background refresh fetches. */
export const WARM_LIMITS = { jobs: 25, tasks: 60 };

export function shouldPersist(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === "string" && PERSIST_ROOTS.has(queryKey[0]);
}

type SavedQuery = { queryKey: readonly unknown[]; state: { status: string; dataUpdatedAt: number } };

/** Keep the successful, allowed, recent queries of a saved cache. */
export function keepQueries<T extends SavedQuery>(queries: T[], now: number, maxAge = MAX_AGE_MS): T[] {
  return queries.filter((x) => x.state.status === "success" && shouldPersist(x.queryKey) && now - x.state.dataUpdatedAt <= maxAge);
}

/** "Saved 2:15 PM", "Saved yesterday 4:40 PM", "Saved Nov 3". */
export function savedLabel(at: number, now: number, timeZone = "America/New_York"): string {
  const day = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(ms));
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
  if (day(at) === day(now)) return `Saved ${time}`;
  if (day(at) === day(now - 86_400_000)) return `Saved yesterday ${time}`;
  return `Saved ${new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(at))}`;
}

/** Background refresh: due when signed in, online, and not done recently. */
export function warmDue(lastWarm: number | null, now: number, online: boolean): boolean {
  return online && (lastWarm == null || now - lastWarm >= WARM_EVERY_MS);
}
