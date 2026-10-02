/**
 * One activity timeline for a job.
 *
 * The facts already exist — stage changes, completed tasks, payments,
 * expenses, change orders, permits, inspections, daily logs, files — but each
 * lived in its own tab (and the lead's activity log mixed every job of a
 * customer together). This merges rows that carry the job directly, newest
 * first. Pure: the loader maps each table to `JobEvent`s and hands them over.
 */
export type JobEventKind =
  | "stage"
  | "task"
  | "inspection"
  | "payment"
  | "expense"
  | "invoice"
  | "change_order"
  | "permit"
  | "daily_log"
  | "file"
  | "contract";

export type JobEvent = {
  /** Unique across kinds, e.g. "payment:<id>". */
  id: string;
  kind: JobEventKind;
  at: Date;
  /** One plain sentence: "Permit issued", "Deposit of $5,000 received". */
  title: string;
  /** Who did it, when known. */
  actor?: string | null;
  /** Where to look, relative to the job page: a tab and optional sub-tab. */
  tab?: string;
  sub?: string;
};

/** Newest first, capped. Events with an unusable date are dropped rather than sorted to the top. */
export function mergeTimeline(sources: JobEvent[][], limit = 20): JobEvent[] {
  const seen = new Set<string>();
  const all: JobEvent[] = [];
  for (const e of sources.flat()) {
    if (!(e.at instanceof Date) || Number.isNaN(e.at.getTime())) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    all.push(e);
  }
  all.sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id));
  return all.slice(0, limit);
}

export const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
