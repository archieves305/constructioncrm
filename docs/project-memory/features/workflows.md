# Trade Workflow Templates

_Stage 1 shipped 2026-09-24. Stages 2 (reconciliation, inspections,
versioning, template editor) and 3 (jobs-list filters, dashboard, reporting)
are planned — see the "Not yet" section._

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
- `reconcile.ts` (Stage 1 subset): `determinePermit` (UNDETERMINED →
  decided: creates the branch, re-points edges, completes the gate with
  `internal: { bypassEvidence, tickChecklist }`, sweeps), `reconcileScope`
  (toggles: add, skip out-of-scope open steps with `SCOPE_SKIP_REASON`,
  reinstate).
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

## Permissions (`access.ts`, explicit lists)

Apply / add trade / reconcile: ADMIN, MANAGER. Permit status: + job PM.
Team, manual task, skip non-blocking: + OFFICE_STAFF + job PM. Skip or
override a **blocking** gate / evidence: ADMIN, MANAGER only. Templates:
view office roles, manage ADMIN. Own-only roles (SALES_REP, CREW_LEAD,
MARKETING) now also see tasks on jobs where they are PM, hold a team slot
or are field-assigned (`visibilityScopeFor`).

Audit actions: `workflow_apply`, `permit_status_change`,
`workflow_team_changed`, `workflow_scope_change`; every step transition is
on the task timeline (`ACTIVATED`, `SKIPPED`, `CHECKLIST_UPDATED`,
`EVIDENCE_ATTACHED`, …).

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

## Not yet (Stage 2 / 3)

Changing a decided permit status, adding/removing a trade after apply
(the dialog's "Add a trade…" re-applies and only adds), version upgrades,
inspection results + correction tasks, the template editor, jobs-list
workflow filters, dashboard widget, workflow reporting.
