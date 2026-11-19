/**
 * The follow-up queues, one card per bid job: each job's GC opportunities
 * under it. A job sits where its first GC sat in the queue's own order (the
 * server sorts each queue by what is most pressing), and its GCs keep that
 * order inside it. A GC bid filed on no project stands as a job of its own.
 * Pure and client-safe.
 */

type Row = {
  id: string;
  projectName: string;
  bidDueAt: string | null;
  nextActionAt: string | null;
  bidProject: { id: string; number: string; name: string } | null;
};

export type JobGroup<T extends Row> = {
  key: string;
  project: T["bidProject"];
  name: string;
  rows: T[];
  /** The soonest next step and the soonest due date among the job's GCs. */
  nextAt: string | null;
  dueAt: string | null;
};

const earliest = (a: string | null, b: string | null) => (!a ? b : !b ? a : new Date(a) <= new Date(b) ? a : b);

export function groupByJob<T extends Row>(rows: readonly T[]): JobGroup<T>[] {
  const groups = new Map<string, JobGroup<T>>();
  for (const r of rows) {
    const key = r.bidProject ? `p:${r.bidProject.id}` : `o:${r.id}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, project: r.bidProject, name: r.bidProject?.name ?? r.projectName, rows: [], nextAt: null, dueAt: null };
      groups.set(key, g);
    }
    g.rows.push(r);
    g.nextAt = earliest(g.nextAt, r.nextActionAt);
    g.dueAt = earliest(g.dueAt, r.bidDueAt);
  }
  return [...groups.values()];
}
