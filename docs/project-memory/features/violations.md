# Code Violations module

Tracks municipal / county code violations on properties, generates the
work through the existing task + workflow engine, watches deadlines and
fine exposure, ties corrective work to a construction Job, and requires
**formal agency confirmation** before a case closes. Plan approved
2026-09-25 (`~/.claude/plans/glistening-growing-perlis.md`); four stages,
each deployed and QA'd before the next.

| Stage | Ships | Status |
|---|---|---|
| 1 | Engine generalised to a *subject* (job \| case), schema + migration, `code_violation` template seeded, 22 categories seeded | **Deployed 2026-09-25 (`106555c`)** |
| 2 | `src/lib/violations/*` services, routes, intake page, list + queues, case page + tabs, sidebar group, Lead/Job tabs, task chip, files scope, job-sync hook, reinspection + item reopen, closure guard | **Deployed 2026-09-25 (`aeb7ad0`, build `_txMHaK7zd-4SxSb2eGWr`)** |
| 3 | Reminders, escalations, cron, email/bell (deadline change + preview, extensions, hearing-order deadlines already ship in Stage 2) | next |
| 4 | Dashboard, reports, widget, template library page, optional matching rules | |

## Decisions (approved)

- A case is anchored to a **Lead** (the property + owner/customer record;
  there is no Property model) and optionally to a **Job** (the corrective
  construction). Parcel/folio lives on the case.
- The **workflow engine is generalised**, not forked: `src/lib/workflows/subject.ts`
  is the seam. A job composes Core + trades; a case composes exactly one
  `VIOLATION` template and never Core.
- `status` is a short lifecycle (`NEW ACTIVE ON_HOLD APPEALED COMPLIED
  CLOSED CANCELLED`); "where the case is" is derived from the workflow
  phase, flags, dates and the ledger.
- **Case tasks carry `violationCaseId + leadId`, never `jobId`** — even
  with a linked job — so they never pollute the construction job's queue.
- Corrective-work gate: the linked job completing stamps
  `correctiveWorkCompletedAt`; a person completes the step. No cross-
  instance dependency edges. Construction completion ≠ compliance.
- Fines: the accrual **estimate is computed on read, never stored**;
  official figures are entered via the ledger. Override = ADMIN/MANAGER
  with reason.
- No new User grant column; no new field pages in v1.

## Stage 1 — what changed (engine + schema)

**Schema** (migration `20261002120000_code_violations`, applied on dev):
- Enums extended (append-only; anchor/role values are inside every seeded
  template's `contentHash`): `WorkflowTemplateKind + VIOLATION`,
  `WorkflowRole + CASE_MANAGER`, `WorkflowAnchor + COMPLIANCE_DEADLINE,
  HEARING_DATE`, `WorkflowEvidenceType + AGENCY_CONFIRMATION, HEARING_RESULT,
  FINE_STATUS, VIOLATION_ITEMS, LINKED_JOB, LINKED_JOB_PERMIT`.
- `JobWorkflowInstance.jobId` nullable + `violationCaseId @unique` +
  hand-written `CHECK ((job_id IS NULL) <> (violation_case_id IS NULL))`.
  Model name kept (35 call sites, every engine test mock).
- New: `CodeViolationCategory`, `CodeViolationCase`, `CodeViolationItem`,
  `CodeViolationHearing`, `CodeViolationInspection` (agency), `CodeViolationExtension`,
  `CodeViolationFineEntry` (ledger), `CodeViolationEvent` (timeline),
  `CodeViolationReminderLog` (cron dedupe); 12 `CodeViolation*` enums;
  `SEQUENCE code_violation_case_number_seq` (hand-written) for `CV-00001`.
- Link columns: `Task.violationCaseId/violationItemId`,
  `File.violationCaseId/violationItemId`, `Communication.violationCaseId`.
- **Backfill: none.** The CHECK and SEQUENCE are not modelled by Prisma —
  re-append them if the SQL is ever regenerated (header comment says so).

**Engine** (`src/lib/workflows/`):
- `subject.ts` (new): `WorkflowSubjectRef`, `loadSubject`,
  `loadSubjectForInstance`, `requiresCore`, `allowedTemplateKinds`,
  `instanceWhere`, `taskLinksFor`, `scheduleContextFor`, `writeSubjectFields`.
- `apply.ts`: `ApplyInput.subject` (`jobId` kept as a deprecated alias);
  `loadModules(kind)` prepends Core only for jobs, requires exactly one
  VIOLATION template on a case and refuses the wrong kind;
  `materializePlan({links})`.
- `keys.ts` `isBaseKind`, `permitGateKeyFor`; `compose` sorts the base
  module first and exposes `plan.permitGateKey` (jobs still get
  `core:determine_permit_requirement`); `reconcile` refuses add/remove
  module on a case and auto-completes the gate by `permitGateKey`.
- `schedule.ts`: `ScheduleContext {subjectCreatedAt, appliedAt,
  targetStartDate, complianceDeadline?, hearingDate?}`, `DATE_ANCHORS`,
  `anchorDate`, `recomputeAfterAnchorChange`; `reschedule.ts`
  `rescheduleAnchor(instanceId, anchor, actor)`.
- `roles.ts`: `caseManagerId`; `CASE_MANAGER` → case manager → default;
  `loadRoleContext({subject | instanceId | jobId})`.
- `evidence.ts`: six new types (see enum comments); `PERMIT_NUMBER` falls
  through to the case's linked job.
- `inspections.ts`: `violationInspectionId` mirror; correction tasks
  inherit case/item links; role context by instance.
- `read.ts`: `readInstanceWorkflow` shared by `readJobWorkflow` and the new
  `readCaseWorkflow`. `visibility.ts`: `violationCaseIds` scope,
  `caseScopeFor`, `subjectScopeForTask` (the two task routes use it).
- `activation.maybeCompleteInstance` returns `{completed}` (hook point for
  Stage 2's job-sync).
- Task plumbing: `createTask` resolves item → case → lead;
  `TASK_LIST_INCLUDE` adds `violationCase` / `violationItem`;
  `LINK_PARAMS`, validator, `VisibilityScope.violationCaseIds?`.
- `define`/`validate`: VIOLATION needs no trade, rejects `core:` refs,
  must carry `determine_permit_requirement`; negative offsets from any
  date anchor; case anchors only on VIOLATION; `PAYMENT_STATUS` on a
  VIOLATION warns. `versioning.createTemplate` honours the kind.
- `GET /api/workflow-templates?kind=`; admin version route loads Core keys
  for TRADE only.

**Template** `prisma/seeds/workflows/code-violation.ts` (`code_violation`,
kind VIOLATION, 8 phases + the no-permit branch, 75 steps, 6 toggles
`construction_required hearing_required fines_accruing lien_recorded
emergency appeal`). Composed: 43 undetermined / 53 required / 47 not
required / 71 everything on / 41 everything off, no warnings. Corrective
construction is four link-out steps ending in the blocking
`corrective_work_complete` (`LINKED_JOB:COMPLETE`); `close_case` needs
`AGENCY_CONFIRMATION`. Shares only permit keys with the trades (pinned by
test).

**Regression proof**: `seed-specs.test.ts` pins the four v1 hashes as
literals (captured 2026-09-25 before the change); the seeder logs
"unchanged" ×4 on dev; `previewWorkflow` on JOB-00001 (core + doors_windows
+ roofing, REQUIRED) → 170 existing, 0 to create, through both the
`subject` and legacy `jobId` forms. 653 tests, lint 6/28, build clean.

## Stage 2 — what changed (cases)

**Server** (`src/lib/violations/`, every pure part tested): `access.ts`
(explicit role lists; `casePermissions` is what `readCase` returns so the
client shows/hides from one source), `scope.ts` (`caseScopeFor` → the
existing `JobScope` shape with the case manager in the PM slot),
`query.ts` (`parseViolationListParams` / `buildViolationListWhere`: views
`all mine new due-soon overdue fines awaiting-agency closed`, flags,
`__unassigned`, always ANDed with `violationVisibilityFilter`),
`read.ts` (`readCase` → row + permissions/fines/state/alerts/closure
blockers/next action/workflow summary; `listCases`), `state.ts`
(`deriveCaseState`: phase + flags + the 21 labels, never stored),
`alerts.ts`, `fines.ts` (`estimateAccruedFine`, `computeExposure`,
`overrideIsStale`; official balance never merged), `rules.ts`
(`allowedTransitions`, `closureBlockers`, `itemsToReopen`), `intake.ts`
(`toggleDefaultsFromIntake`), `create.ts` (one tx for case + items +
first hearing + opening ledger rows, then `applyCaseWorkflow`; a failed
apply leaves a NEW case with a Workflow-tab callout), `update.ts`,
`close.ts` (`closeCase` engine-skips open steps as `Workflow: case CV-n
closed`, ADMIN/MANAGER override audited as `violation_closure_override`;
`reopenCase` **reinstates exactly those skips** and re-sweeps activation —
found by dev QA, a reopened case had zero live steps; `confirmAgency`
auto-moves ACTIVE → COMPLIED), `deadline.ts` (preview → apply through
`updateTask` + `rescheduleAnchor`; extensions granted take the same
path), `items.ts`, `hearings.ts` (recomputes `nextHearingAt`, order
deadlines can move the case deadline), `inspections.ts` (agency
inspections; FAIL reopens the re-cited items and, when an open
reinspection step is passed, records the engine inspection result on
it; PASS may double as the agency confirmation for ADMIN/MANAGER),
`fine-ledger.ts` (`recordFineEntry` is the one write path; mirrors the
snapshot columns), `job-sync.ts` (`onJobCompleted` from the task
transition chain and `changeJobStage`; `syncCorrectiveWorkFromJob` on a
late link), `notes/communications/activity/categories/summary.ts`.
Validators in `src/lib/validators/violation.ts`.

**Routes** `src/app/api/violations/**` (list/create, preview, summary,
categories, hearings, inspections, bulk-assign; per case: status, close
(GET blockers / POST), reopen, agency-confirm, extension(+decide),
link-job (POST/DELETE), notes, communications, activity, files, lien,
deadline(+preview), items, hearings, inspections(+result), fines
(entries/terms/override), workflow (+preview/apply/reconcile/tasks —
copies of the job routes on the subject engine)) and
`/api/admin/violation-categories`. `POST /api/files` accepts
`violationCaseId`/`violationItemId`, takes `leadId` from the case, checks
`canEditCase`, writes a `FILE_ATTACHED` event.

**Client**: sidebar `navSections` (collapsible groups, `overflow-y-auto`,
active item scrolled into view, pure `isNavActive` with query-key
matching, `ViolationsNavBadge`), `useSearchParamState`, `ConfirmDialog`
(reason + acknowledgement), `components/violations/*` (hooks with a
`Jsonify<CaseDetail>` type so the client never re-declares the row,
status/tone maps, widgets, alerts, `CaseListMini` for Lead/Job tabs,
`ScheduleList` for hearings/inspections, items/inspections/hearings/
fines/permits/photos/communications/notes/activity panels, case dialogs,
five-step intake with a lead picker and `returnTo` round trip through
`/leads/new`), pages `/violations` (queue tiles), `/violations/list`,
`/violations/new`, `/violations/[id]` (13 tabs, `?tab&item`),
`/violations/{hearings,inspections,templates}`. Shared `TemplateLibrary`
(`kind` filter) now backs both `/admin/workflow-templates` and
`/violations/templates`. `WorkflowPanel subject={{kind:"violation"}}`,
`EntityTaskPanel context={{violationCaseId}}`, the task chip renders
"CV-00012 · Item 3", `/tasks?violationCaseId=`, field task pages show the
case number, `FilesPanel scope`, `JobPhotoGallery readOnly`.

**Dev QA 2026-09-25** (headless Chromium + API, then purged): create with
3 items / permit REQUIRED / fines / hearing → CV-00001, 67 tasks;
re-apply → created 0 / existing 67; link JOB-00005; close without
confirmation → 400 with three blockers; FAIL reinspection re-citing item
1 → item 1 OPEN, item 2 stays CORRECTED; close with ADMIN override →
CLOSED, 67 engine skips, `violation_closed` + `violation_closure_override`
audit rows; reopen → 67 reinstated, 2 Ready (after the fix); agency
confirmation → COMPLIED; PNG upload lands on lead + case; SALES_REP not on
the case → 403 / list 0 / create 403, as case manager → 200 / mine 1 /
close 403 / fines 403. Not exercised: the FAIL → blocked step →
correction → reopen cycle on an *active* reinspection step (engine tests
cover it).

**Known gaps for Stage 3**: no reminder/escalation mail yet (deadline
changes and extensions work, silently); the Photos tab lists case files
of category PHOTOS only; `/violations/reports` and the dashboard
breakdowns are Stage 4.

## Runbook

```bash
# prod, after deploy (both idempotent; run as knuco with /etc/knuco/env)
npx tsx prisma/seed-workflows.ts     # expect unchanged ×4, code_violation created
npx tsx prisma/seed-violations.ts    # 22 categories
```

Migration on prod goes through `prisma migrate deploy` inside `deploy.sh`
(the SQL file is applied as-is, CHECK and SEQUENCE included).
