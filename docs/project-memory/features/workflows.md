# Trade Workflow Templates

_Stage 1 (model, engine, seeds, Apply, Workflow tab) and Stage 2
(reconciliation, inspections, versioning, template editor) shipped
2026-09-24. Stage 3 (jobs-list filters, dashboard, reporting) is planned —
see "Not yet"._

## Why

A job's work is the same list of steps every time for a given trade, and
before this the office rebuilt it by hand (or forgot pieces). A **workflow
template** is that list once: phases → steps with a role, a relative due
offset in business days, dependencies, a checklist, required evidence and
scope conditions. Applying templates to a job composes **Core Construction
+ the selected trades + a permit / no-permit branch** into ordinary CRM
tasks. There is no parallel checklist system: a workflow step *is* a task,
with a few extra columns.

## Shape

**Template side** (`prisma/schema.prisma`, `workflow_*` tables)
`WorkflowTemplate` (key, kind CORE|TRADE, trade, service-category
suggestions) → `WorkflowTemplateVersion` (DRAFT/PUBLISHED/SUPERSEDED/
ARCHIVED, `contentHash`, `scopeToggles`) → `WorkflowPhase` (band, note,
permit condition) + `WorkflowTaskTemplate` + `WorkflowTaskDependency`
(string refs, `core:key` for cross-module). `WorkflowRoleDefault` is the
company-wide fallback assignee per functional role.

**Job side** `JobWorkflowInstance` (one per job: permit status +
determination, scope toggles, applied by/at) → `JobWorkflowModule` (one per
applied template, pinned to a version, soft-removable) +
`JobWorkflowTeamMember` (role → user slots). `TaskDependency` links task
ids (BLOCKING or DATE_ONLY, source workflow|manual).

**On `Task`**: `workflowInstanceId`, `workflowTaskKey` ("roofing:mobilize";
null = manual task, even inside a phase), `workflowPhaseKey`,
`workflowModuleKey`, `workflowRole`, `workflowSortOrder`, `workflowAnchor`,
`dueOffsetBusinessDays`, `blocking`, `activatedAt`, `dueLocked`,
`skipReason`, `requiredEvidence(+Param)`, `checklist` (Json),
`inspectionResult`. Unique on `(workflowInstanceId, workflowTaskKey)` — the
database-level idempotency guarantee. `File.taskId` attaches evidence.
`Job.jurisdiction` is new.

**States are metadata on the existing `TaskStatus`** (`lib/workflows/state.ts`):
Not active = PENDING + `activatedAt` null · Ready = PENDING + activated ·
Skipped = CANCELLED + `skipReason` · Failed inspection = BLOCKED +
`inspectionResult` FAIL. `ACTIVE_OPEN_WHERE` (open **and** activated) is
what every count, badge, digest and escalation uses; the migration
backfilled `activated_at = created_at` on every pre-existing task so no
count moved.

## The DSL (`src/lib/workflows/templates/`)

Seed files are `defineTemplate({...})` specs in `prisma/seeds/workflows/`
(`core`, `roofing`, `interior-renovation`, `doors-windows`; 34/74/85/81
steps — every task from Richard's spec, in order). Conveniences:
`^` = previous task in the phase; `startsAfter` on a phase adds a blocking
dep to every task without an in-phase dep; `permit: "NOT_REQUIRED"` on a
phase must carry the legal warning as `note`; `condition: {permit, anyOf,
allOf}`; checklist items may be `{text, condition}`; `overridesCoreKey`
lets a trade's closeout replace Core's generic step. Bands
(`PHASE_BANDS`): Job Setup 100 · Preconstruction 200 · Scope Review 300 ·
Permitting 400 · Procurement 500 · Production Readiness 600 · Core
Production 700 · Installation 800 · Trade Closeout 900 · Core Closeout
1000. `defineTemplate` throws with a path on bad keys, unresolved refs,
unknown toggles, cycles, negative offsets off `TARGET_START`, a missing
legal note.

## Engine (`src/lib/workflows/`)

- `compose.ts` (pure): versions + permit status + toggles → plan. Permit-
  conditioned tasks are excluded while UNDETERMINED and their dependents
  wait on `core:determine_permit_requirement`; any other excluded task
  (wrong branch, toggle off) is **bypassed transitively** so chains never
  break and "Mobilize" follows whichever gate exists. Overrides suppress the
  Core task and take its incoming edges. Phases sort by band, Core first.
- `apply.ts`: `previewWorkflow` (counts, roles, unassigned, initially
  waiting, critical-path days, duplicate titles) and `applyWorkflow` — one
  transaction, `materializePlan` creates only missing steps via
  `createTask` and syncs workflow-sourced edges; a P2002 race retries once
  then 409s. Re-applying the same configuration creates 0. A different
  permit status on an existing instance → 409 (use the tab).
- `activation.ts`: `onTaskClosed` activates dependents whose blocking
  predecessors are all done/skipped, sets due from the predecessor in
  business days (17:00), refreshes DATE_ONLY dependents, marks the instance
  COMPLETED when nothing is open. `sweepActivation` after a re-plan.
  Runs inline from `updateTask` through `lib/tasks/transitions.ts`; never
  throws into the response.
- `schedule.ts` (pure, injectable business-day predicate): JOB_CREATED
  counts from max(job created, applied) so late applies never start
  overdue; TARGET_START null → no date; predecessor anchors date at
  activation. Hand-edited dates set `dueLocked`; `dueLocked: false`
  recomputes.
- `roles.ts`: team slot → job PM / sales rep → `WorkflowRoleDefault` →
  unassigned + warning. `reassignUnresolved` after a team or PM change.
  Pure labels live in `role-labels.ts` (client-safe).
- `evidence.ts`: checklist first, then ATTACHMENT/PHOTO (a `File` on the
  task), PERMIT_NUMBER (a `JobPermit` with a number), PERMIT_DETERMINATION,
  INSPECTION_RESULT (PASS/CONDITIONAL), PAYMENT_STATUS (DEPOSIT/FINAL from
  the job), NOTE. 400s say what to do and carry a `hint`.
- `reconcile.ts`: one engine for every re-plan — `ReconcileChange` is
  `permit` (decide or reverse; a reason is required when dropping the
  requirement), `add-module`, `remove-module` (Core refused; per-task
  `retainTaskIds`), `scope`, `upgrade-module` (re-pins the version and
  reports title/description drift without rewriting existing tasks).
  `build` composes the plan the job should have, `diff` turns it into
  `toCreate / toReinstate / toSkip / preserved` plus an edge diff, and
  `reconcile` applies it: `materializePlan` adds steps and syncs
  workflow-sourced edges, skips go through `updateTask` with
  `${ENGINE_SKIP_PREFIX}<label>` (so a later re-plan can tell an engine
  skip from a person's — only engine skips are ever reinstated), then
  `sweepActivation`. `previewReconcile` is the same diff without writing.
  Completed, manual, correction and user-skipped tasks are never touched;
  nothing is deleted. Deciding a permit still completes the gate step with
  `internal: { bypassEvidence, tickChecklist }`.
- `inspections.ts`: `recordInspectionResult` on a step whose evidence is
  INSPECTION_RESULT. PASS completes; CONDITIONAL completes and raises a
  correction task; FAIL blocks the step ("Failed inspection — notes"),
  raises a correction task (`<key>:correction:<n>`, superintendent slot or
  the inspector, PHOTO evidence, +2 business days) that the inspection now
  waits on. When the correction closes, `activation.onTaskClosed` reopens
  the inspection as Ready with a fresh date — gated on its correction
  tasks only, not its ordinary predecessors, because it was already active
  when it failed. History stays on one row. Mirrors to
  `JobPermitInspection` when an id is passed.
- `versioning.ts` + `validate.ts`: `createDraft` (copies the published
  tree; 409 if a draft exists), draft-only guard on every phase/step/
  dependency mutation, `validateTree` collects every problem with a
  location (duplicate keys, unresolved refs, cycle path, unknown toggle or
  Core override, empty phase, missing legal note, Core without the
  determination step), `publishVersion` (validates, supersedes the previous
  published version; jobs keep their pinned version and the Workflow tab
  reports `upgrades`), `archiveVersion`, `createTemplate`,
  `duplicateTemplate`, `updateTemplateMeta`, reorder helpers. Renaming a
  step key rewrites every reference to it.
- `updateTask` gates: COMPLETED needs checklist + evidence (ADMIN/MANAGER
  may pass `evidenceOverrideReason`, logged as a NOTE); CANCELLED on a step
  needs `skipReason` and a **blocking** gate only by ADMIN/MANAGER;
  starting a Not-active step activates it "out of order"; `DELETE` refuses
  workflow steps.

## Seeds and commands

```bash
npx tsx prisma/seed-workflows.ts        # dev; also part of prisma/seed.ts and scripts/seed-prod.ts
# prod (after deploy):
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-workflows.ts"'
```
Idempotent on `(templateKey, version)` + content hash: unchanged → no-op;
changed + unreferenced → rebuilt; changed + referenced by a job → **throws**
(bump `WORKFLOW_TEMPLATE_VERSION` / the spec instead).

## API

| Route | Who |
|---|---|
| `GET /api/workflow-templates?suggestForJobId=` · `GET /api/workflow-templates/[key]` | any · ADMIN/MANAGER/OFFICE_STAFF |
| `GET /api/jobs/[id]/workflow` | anyone who may view the job (tasks visibility-scoped) |
| `POST …/workflow/preview`, `…/apply` | ADMIN, MANAGER |
| `PATCH …/workflow` `{team}` / `{permit}` / `{scopeToggles}` | coordinate / permit / apply rights |
| `POST …/workflow/tasks` (manual task in a phase) | ADMIN, MANAGER, OFFICE_STAFF, job PM |
| `GET /api/tasks` + `source, workflowInstanceId, phaseKey, moduleKey, ready, waiting, blocked, includeInactive` | existing |
| `GET/PUT /api/admin/workflow-role-defaults` | ADMIN/MANAGER view, ADMIN write |
| `POST /api/files` with `taskId` | `canEditTask` |
| `POST …/workflow/reconcile`, `…/reconcile/preview` (`ReconcileChange`) | permit: + job PM; others: ADMIN, MANAGER |
| `POST /api/tasks/[id]/inspection` | ADMIN, MANAGER, OFFICE_STAFF, job PM, the assignee, a CREW_LEAD on the job |
| `POST/DELETE /api/tasks/[id]/dependencies` (cycle → 400 with the path) | ADMIN, MANAGER, OFFICE_STAFF, job PM |
| `GET/POST /api/admin/workflow-templates`, `GET/PATCH …/[id]`, `POST …/[id]/duplicate`, `POST …/[id]/versions` | view office roles, write ADMIN |
| `GET/PATCH /api/admin/workflow-versions/[vid]`, `POST …/validate`, `/publish`, `/archive`, `/phases`, `/phases/[pid]`, `/phases/reorder`, `/tasks`, `/tasks/[tid]`, `/tasks/reorder` | same |

## Permissions (`access.ts`, explicit lists)

Apply / add trade / reconcile: ADMIN, MANAGER. Permit status: + job PM.
Team, manual task, skip non-blocking: + OFFICE_STAFF + job PM. Skip or
override a **blocking** gate / evidence: ADMIN, MANAGER only. Templates:
view office roles, manage ADMIN. Own-only roles (SALES_REP, CREW_LEAD,
MARKETING) now also see tasks on jobs where they are PM, hold a team slot
or are field-assigned (`visibilityScopeFor`).

Audit actions: `workflow_apply`, `permit_status_change`,
`workflow_team_changed`, `workflow_scope_change`, `workflow_module_remove`,
`template_version_reconcile`, `inspection_result`, `dependency_override`,
`template_publish`; every step transition is on the task timeline
(`ACTIVATED`, `SKIPPED`, `CHECKLIST_UPDATED`, `EVIDENCE_ATTACHED`,
`INSPECTION_RESULT`, `DEPENDENCY_ADDED/REMOVED`, `RECONCILED`).

## UI

Workflow tab (first) on job detail: summary strip (modules, permit pill,
progress, count chips that filter, team, callouts), phases as collapsibles
in band order, rows with state / role / due (lock) / after: / checklist /
evidence / menu (View, Start, Complete, Skip). Apply dialog (trades
suggested from the lead's services, scope toggles, permit radio with the
legal warning, team, target start) → preview → confirm. "Set permit
status" reuses the permit section. Task sheet gets the workflow block
(deps, checklist, evidence + upload, Skip). `/tasks` and the job Tasks tab
filter by source / ready / blocked / not-active. Admin: Workflow
Templates (read-only library + outline) and Workflow Roles. Marking a lead
Won toasts "Set up its workflow". `WORKFLOW_READY_EMAILS_ENABLED=1` mails
assignees when a step becomes Ready (default off; the digest covers it).

## Stage 2 UI

On the Workflow tab the permit pill (once decided) opens **Change permit
status**; each trade pill has a menu with **Upgrade to vN…** (when a newer
version is published; also a banner) and **Remove …**; "Add a trade…" and
"Scope" open the same `ReconcileDialog`. Every mode is two steps: the
change, then `ReconcilePreviewPanel` (To add / To reinstate / To skip /
Kept, drift, warnings; remove-trade lets you keep individual open steps)
before "Confirm — re-plan workflow". The task sheet's workflow block gains
`InspectionResultForm` (Pass / Conditional / Fail, date, notes; a failed
step shows the correction it waits on) and `DependencyEditor` (remove an
edge, or wait on another step of the same workflow, cycle-checked).

The library (`/admin/workflow-templates`) links to the editor
(`/admin/workflow-templates/[id]?v=`): version bar (draft / published /
superseded / archived, jobs pinned), Details, Duplicate, Create draft,
Validate (issues with "Go to step"), Preview (outline), Publish (with
change notes), Archive. Left column: scope toggles, phases as a
`SortableList` (drag, keyboard, Move up/down); right: the selected phase's
steps, each opening `TaskEditorSheet` — title, key, instructions, role,
priority, anchor + offset, blocking, auto-activate, waits-on picker with a
client-side cycle check, evidence, checklist lines with an optional toggle
condition, permit / any-of / all-of conditions, "replaces a Core step". No
raw JSON anywhere. Only ADMIN edits; a published version is read-only.

## Stage 3 — lists, board, dashboard, reporting (deployed `f332e26`)

**Jobs API.** `GET /api/jobs` builds its `where` through the pure, tested
`buildJobListWhere` (`src/lib/jobs/query.ts`): the classic `stageId /
salesRepId / search` plus `workflowTrade` (template key, module not
removed), `permitStatus` (`UNDETERMINED | REQUIRED | NOT_REQUIRED | NONE`
— NONE = no workflow), `phaseKey` (full key; jobs with active open work in
that phase), `workflowBlocked` (a BLOCKED step), `workflowOverdue` and
`workflowUnassigned` (active open steps). SALES_REP scoping is applied
inside the same function. `withWorkflow=true` — implied by any workflow
filter — attaches `job.workflow` (or `null`) from
`lib/workflows/summary.ts`: `trades`, `permitStatus`, `currentPhase`
(lowest band with active work, else lowest waiting band), `total / done /
skipped / open / ready / blocked / failedInspections / overdue /
unassigned / percentComplete`. Three queries per page whatever the size
(instances + modules, open step rows, a status groupBy for closed
tallies). `/api/workflow-templates` now returns each published version's
`phases` so the Phase filter has options.

**UI.** Jobs list: a Workflow filter row (trade, permit, phase, Blocked /
Overdue / Unassigned toggles, seeded from the URL so
`/jobs?workflowBlocked=1` works as a deep link), a Phase column (phase ·
% · issue chips, linking to the Workflow tab), the workflow permit pill
next to the JobPermit badge, and seven CSV columns. Production-board
card: phase, %, issue chips. Dashboard: `WorkflowHealthWidget`
(`components/dashboard/`) from `GET /api/reports?type=workflow-health` —
six tiles that each link to the filtered jobs list, plus the five jobs
with the highest `blocked×3 + overdue×2 + unassigned`. Shared pieces in
`components/workflows/job-workflow-summary.tsx`.

**Reporting.** `GET /api/reports?type=workflow` (`dateFrom/dateTo` filter
workflows by `appliedAt`) delegates to `lib/workflows/reports.ts`, pure
functions over a flat task projection:
`durationsByTrade` / `durationsByPhase` (per-step active time
`completedAt − activatedAt` in calendar days, avg / median / p90; phases
also get whole-phase cycle time once every step has closed),
`overdueByRole`, `stalledSteps` (BLOCKED + overdue active steps,
classified by `classifyDelayCause` in priority order: FAILED_INSPECTION →
PERMIT_UNDETERMINED (open determine step while UNDETERMINED) → PERMIT
(permit evidence, Permitting band or "permit" in the key) → INSPECTION →
PAYMENT → PROCUREMENT → UNASSIGNED → OTHER), `leadTimes` (job created →
applied; applied → `core:confirm_production_start`, also by trade; permit
decided → first PERMIT_NUMBER / `confirm_permit_issued` step) and
`mostSkipped` (people's skips ranked ahead of `ENGINE_SKIP_PREFIX` ones).
The reports page gets a Workflow section (single-hue horizontal bars, a
table under every chart, stat tiles for lead times, the stalled list) and
the export gains nine CSV sections.

**Permissions** (`access.ts`, explicit): `canViewWorkflowReports` = ADMIN,
MANAGER, OFFICE_STAFF, READ_ONLY (403 otherwise; the section hides
itself). `workflowHealthScope`: the same roles see the company, everyone
else sees the jobs they sell or manage.

## Not yet

Nothing scheduled. Candidates if asked: business-day durations in the
report, a per-user "my steps" view of the health widget, phase gantt on
the job.
