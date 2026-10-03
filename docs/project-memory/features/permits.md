# Permits and inspections as one record (audit initiative 4, 2026-10-03)

A permit fact is entered once. The permit's status stamps its dates; an
inspection result entered on the permit is the workflow step's result, and
the other way round; a failed inspection always has a correction task.

## Shape

- `src/lib/permits/rules.ts` — pure, client-safe. `statusStamps` (Issued /
  Final fill an empty issue / final-passed date; a typed date is never
  overwritten), `passClosesPermit` (a passed FINAL / ROOFING_FINAL closes an
  ISSUED / IN_PROGRESS permit when nothing else is booked on it),
  `matchInspectionStep` (permit inspection type → the workflow inspection
  step of the same kind: final / in-progress / rough; an OTHER inspection
  takes the only open step), `typesForStep`, `inspectionTypeForStep`,
  `stepCoversSeveral`, `resultAppliesToStep`.
- `src/lib/permits/effects.ts` — shared by both sides.
  `closePermitIfFinalPassed`, `fileStepResultOnPermit` (a result recorded on
  a step lands on the named permit inspection, else the booked one of the
  step's kind, else a new row when the job has exactly one live permit).
- `src/lib/permits/service.ts` — `updatePermit`, `createPermitInspection`,
  `updatePermitInspection`, `recordPermitInspectionResult`,
  `inspectionStepsForJob`. `PermitError` (400 / 404).
- `src/lib/workflows/inspections.ts` — `recordInspectionResult` now files the
  result on the permit and closes it on a passed final.
- `JobPermitInspection.taskId` (migration
  `20261012120000_permit_inspection_task_link`, nullable, SET NULL) — the
  step a permit inspection belongs to.
- Routes: `PATCH /api/permits/[id]`, `GET|POST /api/permits/[id]/inspections`,
  `PATCH|DELETE /api/inspections/[id]` (all `guardJob` on the permit's job, so
  a sales rep is held to their own jobs), `GET /api/jobs/[id]/permits`
  (permits + inspections + open inspection steps + `canEdit`),
  `GET /api/inspections` (booked + the last 30 days, across jobs).
- UI: `src/components/permits/{shared.ts,permit-editor.tsx,permit-inspections.tsx}`
  used by the job's Permits tab (`components/jobs/job-permits-panel.tsx`) and
  the Permit Center drawer. Permit Center: Expired column, Inspections tab.

## Rules

- **A failure always reaches the step**: it goes BLOCKED with its correction
  task (the existing workflow path). With no matching active step — no
  workflow, or no step of that kind — an ordinary HIGH task is raised on the
  job (`sourceKey permit-inspection:<id>:correction`, superintendent → PM →
  permit coordinator, due in 2 business days), once per inspection while open.
- **A pass completes the step only when one pass can.** Single-inspection
  steps (dry-in, deck, in-progress, insulation): yes. "Rough inspections":
  only when the person ticks "this is the last one" (`completesStep`).
  "Final inspection passed": when every permit on the job that is not Denied
  is Final, or on the tick. A step blocked on a correction is never completed
  by a pass — it reopens through its correction task.
- Only **active** steps are matched (activated, PENDING / IN_PROGRESS /
  BLOCKED).
- A passed final closes the permit (status FINAL, final-passed date), which
  ticks "Permit closed on the Permits tab" and completes the gates waiting on
  it (`settleJobGates`).
- Dates: a day from a date picker is midnight UTC; `shared.ts` `dayOf` /
  `formatDay` read such a "pinned" day from its UTC parts so it never shows
  as the day before. An inspection with a time is stored as a real instant.
- `IN_PROGRESS` stamps nothing: on the board it also holds permits still in
  review.

## Retired

The job's Field → Inspections tab, `components/jobs/inspections-list.tsx` and
`POST /api/jobs/[id]/inspections` (the legacy `Inspection` table, which no
screen wrote). `?tab=field&sub=inspections` lands on the Permits tab. The
table itself is left in the schema.

## Stage 3, the part that needed no ruling (2026-10-03)

- Calendar: `CalendarKind` `permit_date` — "Permit expires" (`px:<id>`, any
  permit not Final / Denied) and "Permit approval expected" (`pa:<id>`, only
  while Applied / In progress). Read-only, all-day, opens the job's Permits
  tab. `overlays.ts` `PermitDateRow`, loaded in `overlays-load.ts`.
- `POST /api/cron/permit-aging` also moves an Issued / In-progress permit
  whose expiration day has passed (office zone) to EXPIRED, audited. Returns
  `expired`.

## Stage 3, after Richard's rulings (2026-10-03)

Rulings: staff follow-ups are **tasks + digests**, not the rule engine;
**no customer email** on any permit or inspection event; the permit fee is
**shown, never created** as a cost.

- **Follow-ups as tasks** — pure `lib/permits/alerts.ts` (`alertsForPermit`,
  `alertForInspection`, `liveAlertKeys`, `liveInspectionKey`) and
  `lib/permits/alert-run.ts` (`raisePermitAlerts`, `raiseInspectionAlerts`,
  `settlePermitAlerts`, `settleInspectionAlerts`).
  - In review 7–13 days after submission: MEDIUM task for the permit's
    coordinator (→ Permit coordinator role → PM). Key
    `permit:<id>:waiting-7@<submitted day>`.
  - 14 days or more: HIGH task for the PM (→ coordinator); the open 7-day
    task is cancelled. Key `…:waiting-14@<submitted day>`.
  - Issued / in progress and expiring within 30 days: HIGH task for the PM,
    due 14 days before expiry (or today). Key `…:expiring@<expiry day>`.
  - Booked inspection on a day up to the next working day: HIGH "Be ready"
    task for the superintendent (→ PM → coordinator), due that day. Key
    `permit-inspection:<id>:ready@<day>`.
  - With nobody to give it to, the oldest active ADMIN gets it. The owner is
    also the task's creator (actor = system), so nobody else is mailed.
  - Raised **once per key** whatever became of the task; the date in the key
    makes a re-submission, a new expiry or a re-booked inspection a new alert.
  - Closed by the record: every permit write, the cron's EXPIRED move and a
    passed final call `settlePermitAlerts`; a result, a cancel, a new date or
    a delete calls `settleInspectionAlerts` (timeline says why).
  - Permits on jobs in a closed stage are skipped.
- **Crons**: `POST /api/cron/permit-aging` → `{expired, waiting7, waiting14,
  expiring}`; `POST /api/cron/inspection-reminders` → `{scanned, raised}`
  (daily now, not hourly). Droplet wrappers `crm-cron/permit-aging.sh` and
  `inspection-reminders.sh`, weekdays 11:40 / 11:45 UTC.
- **Rule engine retired for permits**: no code emits a permit or inspection
  event (`lib/follow-ups/permit-events.ts` keeps only the trigger names).
  `scripts/retire-permit-follow-up-rules-2026-10.ts` (dry run; `--yes`)
  switches the 18 rules off and cancels their pending executions. The rule
  processor (`/api/cron/follow-ups`) was never scheduled on prod.
- **Permit fee**: `GET /api/jobs/[id]/permits` returns `feeCharges` — the
  job's APPROVED `PERMIT_FEE` expenses. The Permits tab shows "Permit fees
  paid $X of $Y quoted" with the charges and a link to the job's costs. The
  field on the permit is "Permit fee quoted": information only.
- **Search**: a permit number finds its job (job list search and ⌘K).

## Not yet

- Expiring permits on the dashboard (initiative 5).
- A denied permit raises no task of its own (the job's health shows it).

## QA recipe

Dev server with `CAREYOS_SSO_DEV_BYPASS=1` and cookie `careyos_session=dev`.
`pg_dump` first, restore after. On a workflow job: add a permit, set
`activated_at` on an inspection step by SQL, then PATCH
`/api/inspections/<id>` `{result:"FAIL",notes}` → step BLOCKED + correction;
complete the correction → step PENDING; POST an inspection with
`result:"PASS"` → step COMPLETED; ROOFING_FINAL pass → permit FINAL and the
final step COMPLETED. POST `/api/tasks/<step>/inspection` → the booked permit
inspection carries the result. Headless: `scratchpad/qa-permits-ui.js`.
