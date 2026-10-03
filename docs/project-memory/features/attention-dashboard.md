# Attention dashboard (audit initiative 5)

The dashboard opens on **Needs attention**: one row per thing a person's role
can act on, each with a count, each opening the list it was counted from.
Today, My tasks and Workflow health follow; the sales tiles and charts sit
under a "Sales" heading at the bottom, with an error state instead of zeros.

## Where things are

- `src/lib/attention/rows.ts` — pure, client-safe: keys, labels, role lists,
  thresholds, `attentionRowsFor(role)`, `attentionHref`, `visibleAttention`
  (hides zeros, most severe first). Tested in `rows.test.ts`.
- `src/lib/attention/load.ts` — one exported `…Where(ctx)` per row; `COUNTERS`
  and `LISTERS` both read through it, so count = list by construction.
- `GET /api/attention?scope=` (counts for the role) and
  `GET /api/attention/[key]?scope=` (the records; 403 for a role that is not
  shown the row, 404 for an unknown key or `overdue-tasks`).
- `src/components/dashboard/needs-attention.tsx`,
  `src/app/(dashboard)/attention/[key]/page.tsx` (Mine | All, breadcrumb,
  first 200 with the full count in the title).

## Rows

| Row | What is counted | Roles |
|---|---|---|
| Overdue tasks | the dashboard's existing rule; opens `/tasks?overdue=1…` | everyone |
| Inspections to correct | workflow step BLOCKED + `inspectionResult FAIL`, or an open `permit-inspection:<id>:correction` task | office, SALES_REP, READ_ONLY |
| Violation deadlines | open case, no agency confirmation, deadline past or within 14 days | same |
| Permits expiring | open job; status EXPIRED, or ISSUED / IN_PROGRESS expiring within 30 days | same |
| Permits not issued | open job; APPLIED / IN_PROGRESS, no approved date, submitted > 14 days ago | same |
| Overdue follow-ups | open lead, `nextFollowUpAt` past | office, SALES_REP, MARKETING |
| Change orders awaiting approval | status SENT | office, SALES_REP, READ_ONLY |
| Contracts awaiting signature | status SENT | same |
| Expenses to approve | `JobExpense` PENDING | office |
| Daily logs to review | `DailyLog` SUBMITTED | office |
| Deposits missing | open job, `depositReceived < depositRequired` | office, READ_ONLY |
| Quiet jobs | open job with no edit, stage change, task activity, daily log, payment or cost in 14 days | office, SALES_REP, READ_ONLY |

Scope: Mine = jobs the person has a role on (`jobsInvolvingUserWhere`), their
leads, cases they are on; All still passes through `jobAccessWhere` /
`leadAccessWhere` / `violationVisibilityFilter`. SALES_REP and CREW_LEAD are
pinned to Mine as on every list.

This absorbs the dashboard part of Code Violations Stage 4.

## Adding a row

Add the key + definition in `rows.ts`, a `where` builder, a counter and a
lister in `load.ts`. Never count with one query and list with another.

## QA recipe (dev)

Dev has almost none of these records. Stage rows by SQL with ids prefixed
`qa-att-` (permits, a SENT change order, a SUBMITTED daily log, one expense
flipped to PENDING), run the count-vs-list comparison against both routes for
`scope=all` and `mine`, then delete them. 2026-10-03: every staged row matched;
SALES_REP got 403 on the two office-only lists and was forced to Mine.
Not exercised at runtime (typechecked only, no dev data): the list rows for
contracts, violation cases, inspections to correct and quiet jobs.
