import type { QueryClient } from "@tanstack/react-query";
import { q } from "@/api/queries";
import { addDays, dayKey } from "@/lib/format";
import { WARM_EVERY_MS, WARM_LIMITS } from "./rules";

/** Run `jobs` a few at a time, so the phone never sends a burst of requests. */
async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await Promise.allSettled(items.slice(i, i + size).map(run));
}

/**
 * Fill the saved copy with what a person is likely to open without signal:
 * today, this week, overdue, inspections, my tasks and each one's detail, my
 * jobs and each one's tasks and issues. Anything fetched in the last 15
 * minutes is skipped. Failures are ignored: this is a convenience.
 */
export async function warmSavedCopy(qc: QueryClient, userId: string): Promise<void> {
  const fresh = { staleTime: WARM_EVERY_MS };
  const today = dayKey();
  await Promise.allSettled([
    qc.prefetchQuery({ ...q.today(today), ...fresh }),
    qc.prefetchQuery({ ...q.overdue(today), ...fresh }),
    qc.prefetchQuery({ ...q.range(today, addDays(today, 6)), ...fresh }),
    qc.prefetchQuery({ ...q.inspections(), ...fresh }),
  ]);
  const [jobs, tasks] = await Promise.allSettled([
    qc.fetchQuery({ ...q.myJobs(), ...fresh }),
    qc.fetchQuery({ ...q.myTasks(userId), ...fresh }),
  ]);
  if (tasks.status === "fulfilled") {
    const open = tasks.value.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED").slice(0, WARM_LIMITS.tasks);
    await inBatches(open, 4, (t) => qc.prefetchQuery({ ...q.task(t.id), ...fresh }));
  }
  if (jobs.status === "fulfilled") {
    await inBatches(jobs.value.data.slice(0, WARM_LIMITS.jobs), 3, (j) =>
      Promise.allSettled([
        qc.prefetchQuery({ ...q.job(j.id), ...fresh }),
        qc.prefetchQuery({ ...q.jobTasks(j.id), ...fresh }),
        qc.prefetchQuery({ ...q.jobIssues(j.id), ...fresh }),
      ]),
    );
  }
}
