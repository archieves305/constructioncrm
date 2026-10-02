# Job Overview tab (audit initiative 1, 2026-10-02)

The job page opens on **Overview**: how the job is doing and why, what is
next, what is in the way, permit and money position, and one activity
timeline. No new data and no migration — it reads what the other tabs hold.

## Shape

- `src/lib/jobs/health.ts` — pure `deriveJobHealth`: closed → delayed (failed
  inspection, blocked task, a task ≥ 7 days overdue, an expired permit) →
  at risk (any overdue task, a permit expiring within 30 days) → not started
  (no workflow, nothing open) → on track. Reasons are returned as phrases.
  Nothing is stored.
- `src/lib/jobs/timeline.ts` — pure `mergeTimeline`: newest first, deduped,
  capped at 20.
- `src/lib/jobs/overview.ts` — `loadJobOverview(jobId)`: one read (16
  queries in parallel) → health, stage + days in stage, PM, workflow summary
  (`loadJobWorkflowSummaries`), open tasks (to do now, also due in 7 days,
  overdue, blockers), permits with days to expiry, next scheduled permit
  inspection, money (contract, paid, cost to date in the same three streams
  as Collections, profit only once a cost exists, change orders awaiting,
  pending expenses), daily logs awaiting approval, timeline.
- `GET /api/jobs/[id]/overview` — `guardJob(…, "read")`.
- `src/components/jobs/job-overview.tsx` — status banner, Next up, Needs
  attention, Permits and inspections, Money, Also due in the next 7 days,
  Recent activity. Every block links to the owning tab through the page's
  `setTab`. Query key `["job", id, "overview"]`, so any invalidation of the
  job refreshes it.

## Rules

- The timeline merges only rows that carry the job directly (stage history,
  payments, approved expenses, issued invoices, change orders, contracts,
  permits and their inspections, daily logs, task events). The lead's
  `ActivityLog` is not used: it mixes every job of a customer.
- Task events shown: completed, blocked, inspection result, file attached.
  Skips are left out — a re-plan or migration skips dozens at once.
- Any new count of "overdue" must use `isPastDue` / `overdueWhere`.

## Not yet

Projected finish, budget and committed cost (initiative 2), stage following
the workflow (initiative 3), failed permit inspections (initiative 4).
