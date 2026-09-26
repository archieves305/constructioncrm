# Feature — Friendlier CRM: address-first labels, calmer navigation

_Plan approved 2026-09-25 (`~/.claude/plans/spicy-drifting-shore.md`). Four
stages, each deployed and QA'd before the next: 1 labels · 2 sidebar +
Table|Board merge + ⌘K search · 3 job + lead page · 4 polish._

## Why

Richard: "task items are identified by a Job number instead of a property
address where users will know the address better." The audit found no
canonical job label, a task API that never returned an address, a job
search that could not find a job by address, a 41-link sidebar, and a
989-line job page with the customer's phone missing from it.

## Stage 1 — address-first labels (`fa52de5` core, `3f462e7` long tail)

**One label module, `src/lib/labels/`** (pure, client-safe: `import type
{ Prisma }` only).

- `address.ts` — `isPlaceholderAddress` (empty or exactly TBD / TBA / N/A /
  unknown / pending / "-"; **"2188 (street TBD)" is kept** because the
  house number is what tells that job apart from the same customer's
  other job), `formatAddressLine` → "2192 Wind Trace, Navarre" (street[,
  unit], city), `formatAddressFull` (+ state zip, for PDFs).
- `job.ts` — `jobLabel(job, { customer?, trade? })` → `{ primary,
  secondary, code, placeholder }`: address | title | number; secondary
  "customer · trade"; code = jobNumber (null when it is already the
  primary). `jobText` → "2192 Wind Trace, Navarre (JOB-00005)",
  `jobTextWithCustomer` → "… — Carey Real Estate (JOB-00005)".
- `case.ts` — `caseLabel` / `caseText` (address via the case's lead).
- `subject.ts` — `subjectLabel(task)` / `subjectText(task)`: one answer for
  "what is this task about?" with the old chip's precedence (violation >
  invoice > estimate > daily log > prospect > job > lead) and hrefs, address
  first for every kind.
- `select.ts` — `LEAD_LABEL_SELECT`, `JOB_LABEL_SELECT`, `CASE_LABEL_SELECT`.
  Used by the task include, task mail loads, workflow read/health/report,
  violations include, payroll run, the crews / field-logs / referrals /
  field-issues / reviews / jobs / reconciliation routes, auto-tasks and the
  field-log crons.

**Components:** `components/shared/entity-label.tsx` (`EntityLabel`,
`JobRef`, `CaseRef`; `inline` for cells, `customer={false}` /
`trade={false}` to drop a line the column already shows) and
`components/shared/job-picker.tsx` (Popover + `ui/command.tsx`,
`shouldFilter={false}`, server-searched `/api/jobs?search=` with a 200 ms
debounce, 20 recent when empty, fetches `/api/jobs/:id` for a URL-seeded
value). Client types `LeadLabel` / `JobLabel` live in
`components/tasks/types.ts`.

**Search:** `buildJobListWhere` ORs jobNumber, title and a nested
`lead.OR` over fullName, companyName, propertyAddress1, city (insensitive),
zipCode, primaryPhone. "wind" also matches "Windows" in a title — expected.

**Surfaces switched:** task chip / sheet / dashboard widget, `/tasks` job
filter and the New task dialog (JobPicker replaced two 500-row selects),
jobs list ("Property" column + CSV Property column), job header /
breadcrumb / stepper confirm text (+ "Copy address" menu item), production
board card (address top, customer, number in the bottom row), schedule
card, workflow-health widget, field home / task list / task detail (which
read `task.lead.address1`, never selected — fixed), field logs, violations
intake picker / link dialog / case page / CSV, collections, permits,
crews, referrals, field logs, payroll, cost reconciliation, workflow
stalled-step report, Won toast.

**Emails / strings:** task assigned / reminder / escalation context,
invoice + returned-log auto-task text, deposit task title ("Collect
deposit — <address>"), daily-report subject + heading (**PDF filenames
unchanged**), field-log reminder + digest, review request ("your recent
project at …", no number), change-order mail + `/co/<token>` page,
contract signed / declined internal mail. Violation notices unchanged
(they already carried a Property row). New jobs are titled
`<trade> — <address>`; the 18 prod titles were **not** backfilled (the
title is now only a fallback and CSV/QBO text).

**Kept as identifiers:** contract numbers `${jobNumber}-C${n}`, invoice
numbers, QBO export, PDF filenames, `nextJobNumber`, audit / activity
bodies, server-side `WorkflowSubject.label`, job-sync case events, "Copy
job number".

**Dev QA (headless Chromium, ADMIN):** task chips, picker searches for
"wind" / "2188" / "equifirst" in the filter drawer and the dialog, jobs
table + board + schedule + dashboard + field pages, collections; `curl
/api/jobs?search=navarre|2188|JOB-00005|equifirst` → expected jobs. Dev
has no permits, change orders or violation cases, so those surfaces are
covered by typecheck only. 916 tests (+28), lint 6/27, build clean.

## Stage 2 — sidebar, Table | Board, ⌘K (branch `ux-nav`)

**Sidebar** (`components/layout/sidebar.tsx`, data-only): 11 entries for an
admin (32 links, was 41 flat) — Dashboard · Leads · Jobs · Tasks ·
Schedule · Permits · Canvassing · **Code Violations** {Overview, Cases,
Inspections, Hearings} · **Field** {Field Mode, Daily Logs, Crews,
Personnel} · **Money** {Collections, Referrals, Reports, Labor Reports,
Response Times} · **Admin** with sub-headings People / Templates /
Automation / Canvassing / Finance ("Job Workflow Templates" vs "Violation
Workflow Templates", "Knock Scoring"). The seven `?view=` links are gone
(the Cases page has its own queue pills). `NavItem.heading` prints a
sub-heading inside a group; `NavItem.hint` is a plain-English `title`.
`navSections` is exported for the palette. A "Search… ⌘K" button sits
under the logo. A sales rep sees 9 entries.

**Table | Board**: `/pipeline` and `/production` are server pages that
`redirect()` to `/leads?view=board` and `/jobs?view=board`, forwarding
every param (`lib/lists/board-redirect.ts`, tested). The board bodies
moved verbatim to `components/leads/leads-board.tsx` and
`components/jobs/jobs-board.tsx`; the list pages own the header, a
`SegmentedControl` (Table / Board) writes `?view`, and the table query is
gated off while the board shows. Deep links like
`/jobs/<id>?tab=money&sub=invoices` are untouched.

**⌘K** (`components/layout/command-palette.tsx`, mounted in `AppShell`;
⌘K / Ctrl+K anywhere outside an input, plus the sidebar button and a
mobile-header icon): `GET /api/search?q=` (≥ 2 chars, 5 per kind) runs
`lib/search/query.ts` `buildSearchWheres`, which **reuses the list
builders** — `buildJobListWhere`, `buildLeadListWhere({includeClosed})`,
`buildViolationListWhere` — so the rep floor and the case visibility
filter apply unchanged; prospects use the rule lifted into
`lib/prospects/access.ts` (also used by the prospects route).
`lib/search/format.ts` `toSearchHits` labels hits with `jobLabel` /
`caseLabel` / `formatAddressLine`. Empty palette: "Recently viewed" (last
8, localStorage `recent:viewed`, written by `<RecordRecent>` on the job,
lead and case pages) + "Go to" (role-filtered pages). While typing, pages
still match by name ("hearings"). cmdk's filter is off and the
highlighted row is **controlled** (first in render order) because rows
mount after cmdk's own select-first pass — without that, Enter did
nothing. `/canvassing/prospects` seeds its search box from `?search=`.

Tests: `board-redirect.test.ts`, `search.test.ts` (ADMIN vs SALES_REP
wheres, hit formatting), `nav-active.test.ts` gains the new tree. Dev QA
(headless Chromium): admin 32 links / rep 13 links (× 2 sidebars in the
DOM), `/pipeline?scope=all&assignee=x` → `/leads?scope=all&assignee=x&view=board`,
toggle flips the URL, Money → Invoices deep link lands, ⌘K "equifirst" →
2 jobs + 2 leads → Enter opens the job, recents listed, "hearings" jumps,
rep search for "navarre" returns nothing. 926 tests, lint 6/27, build
clean.

## Stage 3 — job page and lead page (branch `ux-pages`, off `ux-nav`)

- `components/shared/contact-card.tsx` — customer name (linked to the lead
  on the job page), company (hidden when it equals the name), phones as
  `tel:` links when they have ≥ 7 digits (a "TBD" stays plain), `mailto:`,
  the address with an "Open in Maps" link, county, property type. Replaces
  the Property card on the job page and Contact Info + Property on the
  lead page. `/api/jobs/[id]` now selects `companyName`, `secondaryPhone`,
  `propertyType`.
- `lib/jobs/money-step.ts` (tested) — `moneyStep(job, contracts)` →
  `{ panel, title, body }`: owned rehab → invoices; a SIGNED contract →
  invoices; a DRAFT/SENT contract → contract ("send" / "waiting on the
  signature"); no contract and $0 → estimates; otherwise invoices. The job
  page uses it for the Money default sub-panel **only when `?sub` is
  absent** and for the "Next:" callout, so estimate → contract is one
  click and email deep links are untouched.
- Job page 989 → ~600 lines: the inline payment, permit and crew forms and
  the inspections / stage-history lists moved verbatim (state, queries and
  invalidations included) into `components/jobs/payments-panel.tsx`,
  `job-permits-panel.tsx` (label now "Jurisdiction *"), `crews-panel.tsx`
  (renders `JobPersonnelScopePanel`), `inspections-list.tsx`,
  `stage-history-list.tsx`; each empty list is an `EmptyState`.
  `job-page-skeleton.tsx` replaces "Loading...".
- Lead page: the tab lives in `?tab=` (`useSearchParamState`, `activity`
  omitted); the lead + stages queries and the stage / reassign / note /
  communication mutations use `fetchJson` with `toast.error` on failure
  (they used to report success on a failed save); not-found vs
  couldn't-load split with "Try again", like the job page; skeleton.

Dev QA (headless Chromium, ADMIN): job page has 1 tel: and 1 maps link;
Money opens on Invoices for a priced job and the URL gains `sub=invoices`;
`?tab=money&sub=payments` lands on Payments with the Record Payment
button; Permits / Crews / History panels render; `/leads/<id>?tab=comms`
selects Communications and clicking Tasks writes `?tab=tasks`;
`/leads/does-not-exist` shows "Lead not found". 930 tests (+4), lint
6/22, build clean.

## Stage 4

See the plan file. Stage 2 (sidebar tree of 11 entries, `/leads` +
`/jobs` with `?view=board`, `/pipeline` + `/production` redirects, ⌘K
search over jobs / leads / cases / prospects with list-route scoping,
recently viewed) is built on the `ux-nav` branch so Stage 1 can deploy
alone from `main`.
