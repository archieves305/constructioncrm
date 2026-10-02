@AGENTS.md

# Claude Project Memory — KNU Construction CRM

_Concise by design. Full detail lives in [docs/project-memory/](docs/project-memory/)._

## 1. Project Purpose

CRM for KNU Construction: leads → estimates → jobs → invoicing in one
pipeline, plus a field-labour module (daily logs, crew hours, payroll) and
canvassing. Receives expense postings from cc-allocator. Part of the CareyOS
app fleet.

## 2. Current System Architecture

Next.js **16.2.3** (App Router) + Prisma/PostgreSQL, on knuco-droplet
(161.35.0.183) at `/opt/knuco`, port 4000, under the **systemd unit
`knuco`** — the only fleet app not on pm2. Public host
**`https://crm.careyos.com`** (Cloudflare-proxied). Env at `/etc/knuco/env`.

The same droplet runs CareyOS (`/var/www/careyos`, pm2, port 3000) and ~14
sibling `*.careyos.com` apps.

Auth is **CareyOS SSO** — see §9 and
[features/careyos-sso.md](docs/project-memory/features/careyos-sso.md).
Details: [architecture.md](docs/project-memory/architecture.md).

## 3. Active Workstreams

0000000. 🔴 **Streamlined ("slim") workflows** — four stages, plan approved
   2026-09-30 (`~/.claude/plans/please-look-at-the-structured-seal.md`);
   Richard signed off the step lists the same day. Why: nobody worked the
   90–170-step workflows (prod: ~1,320 steps, 25 completed). **Stage 1
   (streamlined templates for new jobs) built + dev-QA'd 2026-09-30 on
   `workflows-slim`, fast-forwarded to `main`**: v1 specs frozen under `prisma/seeds/workflows/v1/`,
   streamlined `v2/` (Core 18 · Roofing 10 · Interior 10 · D&W 8 ·
   code_violation 32; Core + one trade with a permit = 21–24 steps),
   `v2/mapping.ts`, seeding by generation (`--dry-run`), generations never
   mix on a job (`compat.ts`), attach on every open step, evidence on record
   gates only, `JobTaskTemplate.skipWhenWorkflow` (migration
   `20261008120000_task_template_skip_when_workflow`), two permit rule tasks
   stand down, Apply closes the tasks the workflow replaces. **Deployed
   2026-09-30 as `81589ff`** (BUILD_ID `c2QPO63nhZnwCjo8nwLAb`, migration
   applied, smoke 307 ×2, journal clean, backup
   `postgres-2026-09-30-123514.dump`) **and seeded on prod**: dry run clean
   (no editor-made versions), every template's streamlined generation
   created as v2, v1 superseded, second run unchanged ×10. New jobs and
   cases now get the streamlined workflow. **Stage 2 (move the open v1 jobs
   and cases) built + dev-QA'd 2026-09-30 on `workflows-migrate`,
   fast-forwarded to `main`**: legacy steps derived on read and folded into
   an "Earlier version" group outside the progress (`plan-membership.ts`,
   `read.ts`, `summary.ts`), pure `planMigration` + `migrateInstance`
   (`migrate.ts`), engine-only `updateTask` options (`quiet`, `completion`,
   `definition`), quiet `sweepActivation`,
   `scripts/migrate-workflows-slim-2026-10.ts` (`--inventory`, dry run,
   `--only`, `--yes`). No migration. **Deployed 2026-09-30 as `0ad0f99`**
   (BUILD_ID `_uoyVpElQCqjPaNXDQhtw`, no migration, smoke 307 ×2, journal
   clean, backup `postgres-2026-09-30-130450.dump`). Prod inventory + dry
   run done (wrote nothing): 8 jobs + 3 cases would migrate, none blocked,
   nothing in flight, JOB-00026 already streamlined; no company role
   default is set. **JOB-00025 migrated on prod 2026-09-30** (fresh backup
   `postgres-2026-09-30-131751.dump` first; 86 → 21 steps, 16 created, 5
   refreshed, 81 retired, nothing deleted, journal clean); Richard checked
   it, then **the other 7 jobs and 3 cases were migrated the same day**
   (backup `postgres-2026-09-30-132154.dump` first): 10 migrated, invariants
   ✓ on each, second run `already-migrated 12`, 0 open steps outside their
   pins, 0 instances on v1, 0 notifications, 11 audit rows, journal clean.
   Prod workflow steps now: 60 active + 256 waiting open, 25 completed,
   1,204 retired. **Stage 2 is complete. Stage 3 (completion UX) built +
   dev-QA'd 2026-09-30 on `workflows-completion`, fast-forwarded to
   `main`**: `taskRightsFor` (a job's PM / a case manager may work any step
   of it), Complete dialog with upload + tick-all + one PATCH, one-click
   "Done" with Undo, panel opening on what is actionable, lists opening a
   gated step instead of a refused tick, field-mode photo attach, record
   gates that complete themselves (`gates.ts`), role-default back-fill,
   scope change refreshing open checklists. **Stage 4 ("Complete this
   phase") built + dev-QA'd 2026-09-30 on `workflows-catch-up`,
   fast-forwarded to `main`**: `catch-up.ts` (pure planner + runner),
   catch-up routes for jobs and cases with a dry-run preview,
   `canCatchUpWorkflow` (office roles + the job's PM / case manager),
   `CatchUpDialog`; gates arrive unticked, a record gate with no record is
   held, nothing is bypassed. No migration in either stage. **Stages 3 and
   4 deployed 2026-09-30 as `49c590a`** (BUILD_ID `ZaL55YMVgRTZc9b5mi5NP`,
   no migration, smoke 307 ×2, journal clean, backup
   `postgres-2026-09-30-135558.dump`). **All four stages of the plan are on
   prod**; what remains is Richard's click-through and setting Admin →
   Workflow Roles (saving assigns the 9 active steps that have no owner). Stage 3 = completion
   UX; Stage 4 = "Complete this phase". Notes:
   [features/workflows.md](docs/project-memory/features/workflows.md).
000000. ✅ **Operations Calendar / My Work — all four phases on prod** — four phases, plan approved
   2026-09-27 (`~/.claude/plans/woolly-swinging-mist.md`). **Phase 1
   (Foundation) built + dev-QA'd 2026-09-27 on `calendar-foundation`**:
   one date axis (`dueAt` = the day and, for timed tasks, the end instant;
   new `Task.scheduledStart` + `allDay`, migration
   `20261006120000_task_scheduling` with a CHECK), pure `applySchedule`
   inside `updateTask`/POST, `SCHEDULE_CHANGED` event, `APP_TIME_ZONE`
   (`src/lib/time/zone.ts`) fixing the digest / escalation / card-date
   boundaries, one `overdueWhere` rule (**dashboard Overdue tile stops
   counting items due today**), `GET /api/calendar` + `/unscheduled`,
   `/calendar` (Week / Day / Month, Viewing selector, filters, phone
   agenda + day strip, bottom sheet), `ScheduleSection` + assignee +
   Directions/Call in the task sheet, time row in the task dialog,
   `User.defaultCalendarView`. `/schedule` redirects; its unguarded PUT
   route is gone. **Deployed 2026-09-28 as `08e9355`** (BUILD_ID
   `sMd5qs7fP1qWl0vxJLB14`, migration `20261006120000_task_scheduling`
   applied, CHECK + index verified on prod, 1357 tasks all `all_day`, smoke
   307 ×2, journal clean, backup `postgres-2026-09-28-104554.dump`).
   Click-through fix: the Viewing menu crashed on open (Base UI label
   outside a group) — **deployed 2026-09-28 as `596fe14`**, BUILD_ID
   `b0-KfO1kETJzHU_uElpM5`; **Richard's click-through passed 2026-09-28.**
   **Phase 2 (dispatch) built + dev-QA'd 2026-09-28 on `calendar-dispatch`,
   fast-forwarded onto `main`**: kanban sensors extracted, one `DndContext`
   over Week / Day / Month / People + the Unscheduled rail, pure
   `drop-target` / `move` / `conflicts` / `people` / `grid-nav`, optimistic
   `useMoveTask` with multi-query rollback, conflict dialog (warn-not-block),
   People view with workload footers and per-cell quick-create, keyboard drag
   + announcements, `updateTask` refuses an inactive assignee. No migration.
   Gate: typecheck clean, lint 6/22, 1063 tests, build clean; headless
   QA 28/28. **Deployed 2026-09-28 as `e0380ba`** (BUILD_ID
   `sBabA8ralAO2_F-0aMUve`, no migration, smoke 307 ×2, journal clean,
   backup `postgres-2026-09-28-114633.dump`). **Phase 3 (field + today)
   built + dev-QA'd 2026-09-28 on `calendar-field`, fast-forwarded to
   `main`**: `/field/day` with the gloves-friendly action row (Start / Done /
   Directions / Call / Photo / Checklist), Jobs · Today · Tasks bottom nav,
   checklist block on the field task page, dashboard Today widget beside My
   tasks; pure `fieldActions` / `splitFieldDay` tested. No migration. Gate:
   typecheck clean, lint 6/22, 1069 tests (+6), build clean; headless QA
   22/22. **On prod since 2026-09-28 inside the sibling session's deploy
   `4a9a1b3`** (BUILD_ID `2u4fVOc8Ife0Gb0ANSAjF`, no migration, smoke 307
   ×2, journal clean, backup `postgres-2026-09-28-120539.dump`; that
   session's workflow-team PM fix had been swept into `7be0e5c` from the
   shared checkout, so the two shipped together). **Phase 4 (operational
   intelligence) built + dev-QA'd 2026-09-28 on `calendar-intel`,
   fast-forwarded to `main`**: read-only overlays (permit inspections,
   hearings, agency inspections, job starts as `CalendarItem.kind`s with
   their own icon and link, never work, never draggable), "Schedule changed
   since yesterday" + "Starting today" digest sections, dependency warning
   on drop, ⌘K task search landing on the calendar day. No migration. Gate:
   typecheck clean, lint 6/22, 1085 tests (+16), build clean; headless QA
   16/16. **Deployed 2026-09-28 as `4d1be83`** (BUILD_ID
   `Vb1KFWlyhrVkEEeBQMdzA`, no migration, smoke 307 ×2, journal clean,
   backup `postgres-2026-09-28-123359.dump`). **All four phases are on
   prod**; what remains is Richard's click-through of Phases 2, 3 and 4.
   Notes:
   [features/calendar.md](docs/project-memory/features/calendar.md).
000000. 🔴 **Notification digests: record → classify → deliver** — four
   stages, plan approved 2026-09-27
   (`~/.claude/plans/quirky-pondering-mccarthy.md`). **Stage 1 (schema
   `20261007120000_notifications`, `src/lib/notifications/*` service layer,
   every internal producer rewired through `notify()` with the legacy mail
   as fallback, bell + `/notifications` on the new table, tick route with
   `?dryRun=1`, preference mirroring) built + dev-QA'd 2026-09-27 on the
   `notifications` branch** (worktree; a sibling session held the main
   checkout); **`main` merged into it 2026-09-28** (schema + CLAUDE.md
   conflicts resolved, migration renamed after the calendar's) and
   **deployed 2026-09-28 as `4e9ee62`** (BUILD_ID `AJgI-9h4wEZJtyDX0DEfz`,
   migration `20261007120000_notifications` applied: 8 users default
   DIGEST, none IN_APP_ONLY, old bell rows marked read; smoke 307 ×2,
   journal clean, backup `postgres-2026-09-28-125713.dump`). **Shadow mode
   on since 2026-09-28** (`NOTIFICATIONS_V2=1` in `/etc/knuco/env`, dry-run
   tick → `recording: true, takeover: false`, settings singleton created
   with `enabled = false`, windows 08:00 / 12:00 / 15:30 / 18:00 weekdays).
   Rows now record beside the unchanged legacy mail; **the DB switch stays
   off until Stage 2** (digest build / render / send + crontab + admin
   Delivery tab), which is the next build. Gates: env `NOTIFICATIONS_V2=1`
   records rows (shadow — legacy mail unchanged); the DB switch
   `NotificationSettings.enabled` hands delivery to v2. **Stage 2 (digest
   build / render / send, agenda with the morning task digest folded in,
   claim ledger + permission re-check + stale recovery + prune, legacy
   morning digest stands down, `WORKFLOW_READY_EMAILS_ENABLED` retired,
   Admin → Notification Digests with the switch / Preview / Run / Immediate
   rules / Log) built + dev-QA'd 2026-09-28 on the `notifications`
   worktree, fast-forwarded to `main`.** No migration. Gate: typecheck
   clean, lint 6/22, 1157 tests (+15), build clean; dev QA 16/16 with one
   real digest to Richard. **Deployed 2026-09-28 as `b017ded`** (BUILD_ID
   `T-gHoVihFeo4ZA4S_c1vx`, no migration, smoke 307 ×2, journal clean,
   backup `postgres-2026-09-28-132409.dump`); `crm-cron/notifications.sh`
   + the `*/10 * * * *` crontab line installed as `knuco` and run once
   (`recording: true, takeover: false`, 0 pending — still shadow). **The
   switch is Richard's**: Admin → Notification Digests → "Digest delivery
   on" moves delivery to the digests; off again is instant. Stage 3 = user settings
   page + admin polish; Stage 4 = `/notifications` polish + legacy removal.
   Notes:
   [features/notifications.md](docs/project-memory/features/notifications.md).
00000. ✅ **Friendlier CRM: address-first labels + calmer navigation** —
   four stages, plan approved 2026-09-25
   (`~/.claude/plans/spicy-drifting-shore.md`). **Stage 1 built + dev-QA'd
   2026-09-25 on `main`** as `fa52de5` (core: label module, shared
   selects, JobPicker, tasks / jobs / boards / field) + `3f462e7` (long
   tail, emails, new-job titles). **Deployed 2026-09-25 as `67416fd`**
   (BUILD_ID `QLO41RrNwa7l830TCo1bd`, no migration, smoke 307 ×2, journal
   clean, backup `postgres-2026-09-26-023438.dump`; the wrapper's exit 1
   was the shell, as before).
   **Stage 2 (sidebar 41 → 11 entries, Leads/Jobs Table|Board merge with
   redirects, ⌘K search + recently viewed) built + dev-QA'd on `ux-nav`,
   merged to `main` and deployed 2026-09-25 as `46f4b11`** (BUILD_ID
   `JzcQ_qnobf471IUalTKX_`, no migration, smoke 307 ×2, journal clean,
   backup `postgres-2026-09-26-024325.dump`).
   **Stage 3 (job page contact card + Money next-step + panel
   extraction, lead page tab-in-URL + fail-loud fetches) built + dev-QA'd
   on `ux-pages`, merged to `main` and deployed 2026-09-25 as `8b0740c`**
   (BUILD_ID `P2cLnp1LPVdhUtb8v8hLf`, no migration, smoke 307 ×2, journal
   clean since restart, backup `postgres-2026-09-26-025157.dump`).
   **Stage 4 (shared list toolbar, URL filters + text search on tasks and
   permits, skeletons / empty / error / not-found, breadcrumbs, glossary
   terms, terminology, phone columns) built + dev-QA'd on `ux-polish`,
   merged to `main` and deployed 2026-09-25 as `f95b425`** (BUILD_ID
   `rNiggElI_oVOOMlbDSI2q`, no migration, smoke 307 ×2, journal clean,
   backup `postgres-2026-09-26-030123.dump`). **All four stages are on
   prod**; what remains is Richard's click-through. Notes:
   [features/ux-labels-nav.md](docs/project-memory/features/ux-labels-nav.md).
0000. 🔴 **Quieter boards, "my jobs" by default, follow-up + nurture
   cadence** — two stages, plan approved 2026-09-25
   (`~/.claude/plans/when-a-lead-is-sprightly-scone.md`). **Stage 1
   (Mine/All scope on jobs, leads, dashboard + boards toolbar, per-column
   limit, compact cards, per-user default) built + dev-QA'd 2026-09-25**,
   committed `9159ff6` (migration `20261005120000_list_scope_prefs`),
   deployed with Stage 2.
   **Stage 2 (nurture engine) built + dev-QA'd 2026-09-25** on the
   `nurture` branch: `NurtureSettings` / `NurtureContent` /
   `LeadNurtureState` / `LeadNurtureSend` (migration
   `20261004120000_lead_nurture`), pure planner, `POST /api/cron/nurture`,
   hooks on stage / touch / estimate / contract / unsubscribe, Admin →
   Customer Nurture, lead card, seeds. **Both stages deployed 2026-09-25
   as `6b42725`** (BUILD_ID `Rh7FTDIQPnuwxPK6C8LD2`, both migrations
   applied, DB backup `postgres-2026-09-25-173110.dump`, prod seed 12
   created then unchanged, `/home/knuco/crm-cron/nurture.sh` installed at
   `15 13 * * 1-5` and run once by hand → 200 with the gates off; prod dry
   run: 11 leads would enrol, 6 already due). **Sending is off.** Operator
   order: SPF → `NURTURE_ENABLED=1` in `/etc/knuco/env` + restart → tick
   "Sending switched on" under Admin → Customer Nurture → first day
   `NURTURE_MAX_PER_RUN=10`. Richard should also read the 8 nurture drafts
   in the Library tab before the switch goes on. Notes:
   [features/nurture.md](docs/project-memory/features/nurture.md).
000. ✅ **Estimates + customer contracts on the job — deployed
   2026-09-25.** Stage 1 (`90c5339`, shipped with the violations deploy),
   Stages 2–3 (`1676d67`, `7e28930`) merged as `d73f950` and **deployed
   as `d6f046f`** (BUILD_ID `kEXJSGQMOsB90OCO_uMyr`, migration
   `20261003120000_customer_contracts` applied, backup
   `postgres-2026-09-25-155528.dump`, prod seed `residential_construction
   v1: created` then `unchanged`). Richard's next click-through: review
   the agreement text under Admin → Contract Templates, then Money →
   Estimates → Mark accepted → Generate contract → Send on a real job.
   Notes: [features/customer-contracts.md](docs/project-memory/features/customer-contracts.md).
00. 🔴 **Code Violations module** — four stages, plan approved 2026-09-25
   (`~/.claude/plans/glistening-growing-perlis.md`). **Stage 1 (engine
   generalised to a subject + schema + `code_violation` template) deployed
   2026-09-25** (`106555c`, BUILD_ID `IOfCCkc_XvREIsTLQ5zyR`, migration
   applied, prod seeds "unchanged" ×4 + `code_violation` created + 22
   categories). **Stage 2 (cases: services, routes, intake, list +
   queues, case page, sidebar group, Lead/Job tabs, task chip, files
   scope, job-sync, reinspection, closure guard) deployed 2026-09-25**
   (`aeb7ad0`, BUILD_ID `_txMHaK7zd-4SxSb2eGWr`, no migration; the deploy
   also carried the sibling session's `90c5339` estimates commit that was
   already on main). **Stage 3 (deadline reminders + escalation chain
   + `POST /api/cron/violation-deadlines` + case notices + bell rows)
   deployed 2026-09-25** (`fb9cc70`, BUILD_ID `3n5-hSws66cBDrKEdWGqz`,
   no migration; `crm-cron/violation-deadlines.sh` at 11:35 UTC weekdays,
   first prod run 200 with 1 case / 0 due). Stage 4 (dashboard breakdowns + reports) follows. Notes:
   [features/violations.md](docs/project-memory/features/violations.md).
0. 🔴 **Tasks as the spine of the CRM** — three stages, each deployed and
   QA'd before the next. **Stage 1 (tasks everywhere) deployed 2026-09-24**
   (`ebf1988`, BUILD_ID `TIVSTNlHVR4hHEDg5rmdU`, migration
   `20260924120000_task_entity_links` applied). **Stage 2 (email
   follow-up) deployed 2026-09-24** (`4b6021d`, BUILD_ID
   `YehfWHd9zfW9-YxNcwwzN`; escalations stay off until SPF exists).
   **Stage 3 (visual redesign) deployed 2026-09-24** (`e867c5e`, BUILD_ID
   `JAfdl5DEJdIShaUiCFbG2`) —
   [features/design-system.md](docs/project-memory/features/design-system.md).
   All three stages are live; what remains is operator config (SPF →
   `TASK_ESCALATIONS_ENABLED=1`, then `TASK_AUTO_RULES_DISABLED=`) and
   Richard's own click-through. Notes:
   [features/tasks.md](docs/project-memory/features/tasks.md).
1. ✅ **Progress billing — complete.** Stage 1 deployed + JOB-00009
   backfilled 2026-08-27; Stage 2 (change orders → SOV line) `6b3868b` and
   Stage 3 (retainage release + Collections split) `4833ea3`, both
   2026-09-24. Apps 13–14 on JOB-00009 still to be entered in the UI by
   Richard; retainage release is a normal application at a lower rate.
2. ✅ **Job-costing check-and-balance — complete.** Write gate, pending
   state, and (2026-09-24, `3e8b211`) the cc-allocator reconciliation:
   intake guard holds a posting that twins a manual charge as PENDING,
   credits are accepted, expense deletes are audited, and the **Cost
   Reconciliation** admin page rules on pairs. Books cleaned the same day:
   19 duplicates removed ($16,070.96), 23 credits posted (−$7,580), BNW
   $11,694.15 job-costed. Findings + outcome:
   [job-cost-reconciliation-2026-09-24.md](docs/project-memory/job-cost-reconciliation-2026-09-24.md).
   **Phase 2 deployed 2026-09-25 (`972affe` + cc-allocator PR #32)**: the
   page reads cc-allocator's postings export and shows "posted but missing
   here", "linked, never posted" (with the reason) and "held for review".
   **Connected 2026-09-25** (key placed at Richard's request, both apps
   restarted). **Acknowledge action added 2026-09-25 (`e4c6d7e`)** and
   Richard's ruling on the 3 intentional deletions recorded through it,
   so the card now shows 0 missing / 6 never-posted rows in cc-allocator's
   queue ($5,125.27) / 0 held / 3 acknowledged ($25,584.10, collapsed).
3. ✅ `field-log-digest` self-healed — prod journal shows every weekday run
   since the MailerSend upgrade at `attempted 6, sent 6, failures 0`
   (checked 2026-09-24 across Sep 17–24).
3. Add the SPF record for `knuconstruction.com` (see §5).
3. Set `PHONE_ROUTING_API_KEY` to activate the phone-routing integration.
4. ✅ Dead-code cleanup from the auth swap — done 2026-09-24 (`cf746a2`).
5. Promote the old domain's 302 → 301 — **deliberately parked**, not
   blocked (see §5).

The SSO cutover is **done and verified**; jgarcia's role is **decided**.

## 4. Session Log (latest — full history in [session-history.md](docs/project-memory/session-history.md))

### 2026-10-02 — Attach files when creating a task (deployed `eb017b4`)

Richard: "When I create a task I would like to be able to attach a file to
the task." `AddTaskDialog` gained "Attach files" (multiple; chips with size
and remove; a file the server would refuse is refused at pick time through
the client-safe `lib/files/limits.ts`). The task is created as before, then
each file goes to the existing `POST /api/files` (`uploadTaskFile`, extracted
from `useTaskFileUpload`); a failed file never undoes the task — the toast
names it. Richard chose "any task": `File.leadId` is now optional (migration
`20261009120000_file_lead_optional`, one `DROP NOT NULL`), so a task with no
job takes a file that lives on the task alone; a task on a job still copies
the lead and shows on the lead's Files tab. The task sheet lists
**Attachments** (with "Attach file") on ordinary tasks — before, files showed
only inside the workflow block — and task rows show a paperclip count
(`_count.files` in `TASK_LIST_INCLUDE`). The Workflow tab's "add task"
attaches too (`submitOverride` may resolve with the created task). Fixed in
passing: `POST /api/tasks` dropped `violationCaseId` / `violationItemId`.
Not done: the assignment email does not mention attachments. Gate: typecheck
clean, lint 6/22, 1264 tests (+5), build clean. Dev QA: headless Chromium
12/12 on `/tasks` (no-job task, two files + a refused .zip, sheet list,
attach from the sheet) + API checks (job task → lead's Files tab, workflow
route returns the task); dev had no violation case, so that fix is unproven
at runtime; SALES_REP and phone width not run. QA rows deleted.
Richard merged, pushed and deployed from `!`: BUILD_ID
`ZaL55YMVgRTZc9b5mi5NP` → `7b496oPUA25tYbcyDW1wY`, migration
`20261009120000_file_lead_optional` applied (76, up to date; `files.lead_id`
nullable verified on prod), smoke 307 ×2, journal clean, backup
`postgres-2026-10-02-132818.dump`. Richard's click-through pending: New task
→ Attach files → the task sheet's Attachments list.

### 2026-09-30 — Streamlined workflows, Stage 4: "Complete this phase" (deployed `49c590a` with Stage 3)

Built on `workflows-catch-up` straight after Stage 3: `catch-up.ts`
(`planCatchUp` — open steps of one phase in dependency order, blocking gates
unticked by default, held when a blocking predecessor is open and outside
the run, inspection and `:close_case` always held; `runCatchUp` — evidence
checked in the preview and enforced by the ordinary `updateTask` path with
checklists ticked, quiet per step, one sweep, `completeSatisfiedGates`,
instance completion + the corrective-job bridge, activity line, audit
`workflow_catch_up`), `canCatchUpWorkflow`, `catchUpSchema`, the two routes,
`useCatchUp`, `CatchUpDialog`, "Complete this phase…" in the phase footer.
One change from the plan: blocking steps are unticked by default but anyone
allowed to catch up may tick them — completing a gate one at a time was
never restricted, only skipping one. Gate: typecheck clean, lint 6/22, 1259
tests (+7), build clean. Dev QA `qa-catchup.js` 7/7 + dialog 4/4, DB
restored. No migration. Richard pushed and deployed Stages 3 + 4 from `!`:
BUILD_ID `_uoyVpElQCqjPaNXDQhtw` → `ZaL55YMVgRTZc9b5mi5NP`, no pending
migrations, smoke 307 ×2, journal clean, backup
`postgres-2026-09-30-135558.dump`. Details:
[features/workflows.md](docs/project-memory/features/workflows.md).

### 2026-09-30 — Streamlined workflows, Stage 3: making a step easy to finish (deployed `49c590a`)

"continue". Built on `workflows-completion`: `visibility.taskRightsFor`
(ownership OR coordinating the job / case; READ_ONLY never) in
`PATCH /api/tasks/[id]`, `POST /api/files` and as `viewer` on the task GET;
`useTaskFileUpload`; the Complete dialog rewritten (local ticks sent with
the completion, saved on close, Tick all, attach inside);
`WorkflowTaskRow` "Done" / "Complete…" button and compact waiting rows;
panel headline and phases folded unless actionable; owner banner on active
steps; `stepHasOpenRequirement` in the `/tasks` card, My tasks widget and
entity panel; field task page photo / file attach + refusal on the page;
`gates.ts` (`completeSatisfiedGates`, `settleJobGates`, `settleCaseGates`)
hooked after payments, permit saves, ten case write routes, apply and
reconcile; role-default save back-fills unowned steps; `reconcile` scope /
permit changes refresh open checklists keeping ticks. Deliberate limits:
"Corrective work complete" and "Close case" never complete themselves, and a
gate with a checklist waits for its lines. Gate: typecheck clean, lint 6/22,
1252 tests (+15), build clean (the first build after killing `next dev`
fails on `.next` contention; the re-run is clean). Dev QA in headless
Chromium + API as ADMIN and as a SALES_REP PM; dev DB restored after. No
migration. Details:
[features/workflows.md](docs/project-memory/features/workflows.md).

### 2026-09-30 — Streamlined workflows, Stage 2: moving existing workflows (deployed `0ad0f99`; all 11 prod workflows migrated)

"everything looks good. continue". Built on `workflows-migrate`:
`plan-membership.ts` (`isLegacyStep` — module still on the job, key not in
the pinned version), `read.ts` "Earlier version of this workflow" group
(`phase.legacy`, outside `progress`; manual tasks under a vanished phase go
to Other), `summary.ts` counting against pinned step keys,
`MIGRATION_SKIP_REASON` (ignored by `mostSkipped`), `updateTask`
`internal.quiet` / `completion` / `definition`, `sweepActivation(…,
{notify})`, `migrate.ts` (`planMigration` pure: refresh rows that live on,
born-done and partly-done new steps, inherited owner / status / locked
date, retire the rest, blockers for a failed inspection in flight, toggle
map, resume-safe; `migrateInstance`: one transaction to re-pin + create,
then quiet idempotent writes, sweep, due floor, audit
`workflow_migrate_slim`), panel rendering of the legacy group, and the
script. Two choices narrower than the plan: a partly-done merged step gets
a timeline line naming what was done instead of pre-ticked checklist lines
(the mapping is step-level), and manual-task dependency edges are left
alone (a closed predecessor already satisfies them). Found in dev QA and
fixed: a job applied on the streamlined templates and later given a second
trade read as "needs refreshing" (its rows keep the order they were created
in) — position is now compared only on a first migration. Gate: typecheck
clean, lint 6/22, 1237 tests (+28), build clean. Dev QA: DB dumped, JOB-00001 +
a staged v1 case migrated and checked by SQL and headless Chromium
(`qa-migrate-ui.js` 9/9), second run unchanged, DB restored and JOB-00001
migrated for good. No migration. Richard pushed and deployed from `!`:
BUILD_ID `c2QPO63nhZnwCjo8nwLAb` → `_uoyVpElQCqjPaNXDQhtw`, smoke 307 ×2,
journal clean, backup `postgres-2026-09-30-130450.dump`. Prod `--inventory`
and dry run (nothing written): JOB-00017 86 → 21 steps, 00018 229 → 39,
00020 92 → 24, 00021 101 → 23, 00022 242 → 41, 00023 92 → 24, 00024 229 →
39, 00025 86 → 21, CV-00001 62 → 27, CV-00002 57 → 25, CV-00003 53 → 20;
no step born done, no blockers, no in-progress / blocked / manual rows,
one dropped scope option (JOB-00022 interior doors); every role default
is empty. "please start with job": fresh backup
`postgres-2026-09-30-131751.dump`, `--only JOB-00025 --yes` (16 created, 5
refreshed, 81 retired); Richard: "everything looks right"; backup
`postgres-2026-09-30-132154.dump`, `--yes` → 10 migrated, every invariant
✓. Verified by SQL: 0 open steps outside their pinned version, 0 instances
on a superseded version, 0 notification rows in the window, 11
`workflow_migrate_slim` audit rows, journal clean. 9 active steps have no
owner (no role defaults were set). Details:
[features/workflows.md](docs/project-memory/features/workflows.md).

### 2026-09-30 — Streamlined workflows, Stage 1: slim templates for new jobs (deployed `81589ff`, seeded on prod)

Richard: "too many tasks for each workflow… pair them down so that the
users will actually take the time to do the workflow." Plan-mode (3 explore
+ 2 design agents) plus one read-only prod query: ~1,320 workflow steps on 8
jobs + 3 cases, 25 completed, none in a trade phase. Decisions: milestones
(~25 steps for Core + one trade), evidence on record gates only, move open
jobs by a one-time migration, slim the violation template too, templates
before completion UX, one final inspection per job, a "Complete this phase"
action for office roles + the job's PM, closed jobs stay on v1. Step lists
reviewed in the doc "Slim workflow step lists — for review"
(https://claude.ai/code/artifact/29300f98-4b6d-4d97-a11f-1f076f5a7845) and
approved as written. Built: `git mv` of the five specs + shorthand into
`v1/` (hashes unchanged), `v2/` specs + `mapping.ts`, `planGenerations` /
`seedTemplateGenerations` (generation found by hash, created at the next
free number, supersedes the rest; `--dry-run`), `compat.ts` (`descendsFrom`
lineage for upgrades, `incompatibleTrades` for add-trade / re-apply),
re-apply composes present modules from their pins, upload control on every
open step, correction tasks without the PHOTO gate, `duplicates.ts`
(`skipWhenWorkflow` stage templates, two permit rule tasks, superseded
tasks closed on apply). Two departures from the plan, both narrower: the
stage-template stand-down is per template (a blanket one would have dropped
eleven customer-care tasks), and the inspection-failed rule tasks keep
running. `dependsOnDateOnly` and the `diffEdges` kind fix were not needed.
Gate: typecheck clean, lint 6/22, 1209 tests (+50), build clean; dev seed
(roofing landed at v4 past the editor's v2/v3), `qa-slim-api.js` 19/19,
`qa-slim-ui.js` 7/7. Migration `20261008120000_task_template_skip_when_workflow`.
Until Stage 2 runs, a v1 job cannot add a trade (409 with the reason).
Richard pushed and deployed from `!`: BUILD_ID `gVj4IZE3Efq2TEHiJ0ile` →
`c2QPO63nhZnwCjo8nwLAb`, migration applied (75), smoke 307 ×2, journal
clean, backup `postgres-2026-09-30-123514.dump`. Prod seed: dry run showed
v1 unchanged ×5 and v2 to create ×5 with nothing flagged; the real seed
created them and superseded v1; a second run changed nothing. Not verified
on prod: how many stage task templates the migration pre-ticked (matched by
title) — Richard checks Admin → Stage task templates.
Details: [features/workflows.md](docs/project-memory/features/workflows.md).

### 2026-09-30 — Job target start date editable on the job page (deployed `e92a606`)

Richard: "where can I modify the job start date?" — only in the Apply
workflow dialog, unreachable once a workflow exists. Added
`components/jobs/target-start-field.tsx` to the job header subtitle
("Starts Oct 12, 2026" / "Set start date" → popover with a date input and
Save; shown to `workflow.permissions.canCoordinate`, read-only text for
everyone else). It calls the existing `PATCH /api/jobs/[id]`, which already
reschedules `TARGET_START`-anchored steps. Clear is offered only on a job
with no workflow — clearing would null the due date of every open anchored
step. Route fix: `targetStartDate` now goes through `parseDueAt` (bare day →
noon UTC, as the apply route does; `new Date("yyyy-MM-dd")` was midnight UTC
= the evening before in ET) and a bad value is a 400. Gate: typecheck clean,
lint 6/22, 1159 tests, build clean; headless Chromium 11/11 on dev (set /
clear / workflow job / calendar overlay on the day / 400), dev restored. No
migration. **Deployed `e92a606`** (Richard ran the deploy from `!`; it also
carried `0085892`, the Tasks page opening on "assigned to me"): BUILD_ID
`T-gHoVihFeo4ZA4S_c1vx` → `gVj4IZE3Efq2TEHiJ0ile`, 74 migrations / none
pending, smoke 307 ×2, journal clean, backup
`postgres-2026-09-30-112155.dump`.

### 2026-09-28 — Operations Calendar, Phase 4: operational intelligence (deployed `4d1be83`)

"continue to Phase 4". Built on `calendar-intel`: `CalendarItem.kind` +
`overlay`, pure `lib/calendar/overlays.ts` (`overlayWhen` — midnight-UTC
date-picker values are all-day on the UTC date, anything else a one-hour
window; `overlayItems` with prefixed ids and record links; `overlayScopes`
— own-only roles keep their visibility scope, "My calendar" = jobs I have a
role on + cases I manage / hold a slot on), `loadOverlays` in
`GET /api/calendar` (four queries beside the task query, skipped under a
task filter, window opened at UTC midnight then filtered on the mapped day
— the ET-day window silently missed every date-picker value until QA
caught it), overlays sorted first and excluded from summary / month tone /
People lanes / field totals, `canDrag` / `canMove` refuse them; `OverlayCard`
(dashed info link with the kind's icon), Month appointment marker, field
day "Also today", Today widget rows. Digest: `planDigest` takes changes +
starts, `describeWhen` / `describeFrom`, two new email sections and
subject. `dependencyWarning` toast after a drop. ⌘K: `tasks` where,
`taskHitHref`, route + palette group. Gate: typecheck clean, lint 6/22,
1085 tests (+16), build clean; headless Chromium 16/16 (`qa-intel.js`,
recipe in the feature doc). No migration. Staged by explicit path this
time; no foreign files. Richard pushed and deployed from `!`: BUILD_ID
`2u4fVOc8Ife0Gb0ANSAjF` → `Vb1KFWlyhrVkEEeBQMdzA`, no pending migrations,
smoke 307 ×2, journal clean, backup `postgres-2026-09-28-123359.dump`,
`.deploy-sha` `4d1be83`. Details:
[features/calendar.md](docs/project-memory/features/calendar.md).

### 2026-09-28 — Operations Calendar, Phase 3: field + today (built, dev-QA'd, on `main`, not deployed)

"continue to phase 3". Built on `calendar-field`: pure
`lib/calendar/field-day.ts` (`fieldActions` — Start unless started, Done
while open, Directions only with a real address, Call only with a dialable
number, the job's customer over the task's lead, Photo → the job's daily
log for that day, Checklist when the step has one; `splitFieldDay`,
`fieldDayLine`, `greeting`), `components/field/field-day-card.tsx` (time
rail, address, title, badges, blocked reason, `h-11` action row; the
evidence gate's 400 becomes a toast with an "Open task" action),
`app/(field)/field/day/page.tsx` (greeting, `‹ Today ›`, overdue callout on
today, agenda order, "Done · n" fold, collapsed Tomorrow, `+ Task` prefilled
with the day and me — all off the same `GET /api/calendar` the office reads),
bottom nav Jobs · Today · Tasks (Today badge = remaining, red when overdue;
the nav shares the page's query), a Today link in the field header, a
checklist block on `/field/tasks/[taskId]` (44 px rows, PATCH per tick) and
a timed window in its due badge, and `components/calendar/today-widget.tsx`
on the dashboard beside My tasks. Gate: typecheck clean, lint 6/22, 1069
tests (+6), build clean; headless Chromium at 390×844 22/22
(`qa-field.js`, recipe in the feature doc). No migration. Fast-forwarded to
`main` as `7be0e5c` — and that commit was made with `git add -A` in the
shared checkout, so it swept in the sibling session's five uncommitted
workflow-team PM files (their entry below records it). The sibling pushed
and deployed `4a9a1b3` with Phase 3 aboard: BUILD_ID `sBabA8ralAO2_F-0aMUve`
→ `2u4fVOc8Ife0Gb0ANSAjF`, journal clean, `/field/day` answers. Lesson
re-recorded in memory: stage explicit paths, never `-A`, when two sessions
share a checkout. Details:
[features/calendar.md](docs/project-memory/features/calendar.md).

### 2026-09-28 — Operations Calendar, Phase 2: dispatch (deployed `e0380ba`)

Richard's click-through of Phase 1 passed; "continue to next part". Built per
the plan's Phase 2 on `calendar-dispatch`: `components/kanban/sensors.ts`
(`useKitSensors` with an `enterOpens` option so Space picks up and Enter
opens; `kitCollision`) with `KanbanBoard` consuming it and
`KanbanCard.disabled`; pure `lib/calendar/{drop-target,move,conflicts,people,
grid-nav}.ts` (+ a shared `test-fixtures.ts`); `CalendarDnd` (one
`DndContext`, keyboard coordinate getter over `nearestInDirection`,
announcements, conflict gate), `DropZone` / `DraggableCard` (`<id>@<day>` ids
so a span's copies do not collide), `useMoveTask` (snapshots every
`["calendar"]` query, repaints with `applyMove`, restores all on error),
`ConflictDialog`, `PeopleView`, `UnscheduledPanel` (rail remembered through
`useSyncExternalStore` — the effect + setState version tripped the lint
rule), droppable Week columns / Day bands / Month cells, People in the header
for dispatch roles on desktop, `?view=people` falling back for everyone else,
quick-create from a People cell carrying the person. `updateTask`: a new
assignee must exist and be active (400, hint `assignedUserId`). Found in QA
and fixed: the page's ←/→ hotkeys fired during a keyboard drag and paged the
week away — they now yield while the focused card is `aria-pressed`. Gate:
typecheck clean, lint 6/22, 1062 tests (+35), build clean; headless Chromium
28/28 (`qa-dispatch.js`, recipe in the feature doc). No migration. A sibling
session had landed the Jobs closed-by-default change on `main` meanwhile, so
this was a real merge (one CLAUDE.md conflict, both records kept). Richard
pushed and deployed from `!`: BUILD_ID `gCg4iE5s2vGZXzV50cr78` →
`sBabA8ralAO2_F-0aMUve`, no pending migrations, smoke 307 ×2, journal
clean, backup `postgres-2026-09-28-114633.dump`, `.deploy-sha` `e0380ba`.
Details:
[features/calendar.md](docs/project-memory/features/calendar.md).

### 2026-09-28 — Workflow team PM now fills the job's PM (deployed `4a9a1b3`, prod backfilled)

Richard: the Workflow tab's Team names a project manager but the job page's
Team card says "PM: —". Two stores: the dialog wrote a
`JobWorkflowTeamMember` slot; the card (and involvement, auto-tasks,
contracts, field Today) read `Job.projectManagerId`, which no UI ever set —
on prod all 25 jobs had it null while 8 carried a PM slot. Fix: pure
`jobFieldsFromTeam` + `mirrorTeamToJob` (`src/lib/workflows/team-mirror.ts`)
— a named PM / sales-rep slot becomes the job's field (activity
`ASSIGNMENT_CHANGE` + audit `assign` with `source: workflow_team`); a
cleared slot falls back and changes nothing. Wired into
`PATCH /api/jobs/[id]/workflow`; the Team card reads the slot first, then
the job field. `scripts/backfill-workflow-team-to-jobs-2026-09-28.ts`
(dry run by default, `--yes` applies) copies existing slots; on dev it set
JOB-00001's PM, wrote both rows, and a re-run changed 0. Gate: typecheck
clean, lint 6/22, 1074 tests. The five files were swept into the sibling
session's Phase 3 commit `7be0e5c` from the shared checkout, so they ship
with it. **Deployed `4a9a1b3`** (with Phase 3; BUILD_ID `sBabA8ralAO2_F-0aMUve`
→ `2u4fVOc8Ife0Gb0ANSAjF`, no migration, smoke 307 ×2, journal clean,
backup `postgres-2026-09-28-120539.dump`). **Prod backfill run**: dry run
8 of 9, applied 8 (Lisette PM on 17/18/20/21/22/23 + sales rep on 20,
Erica PM on 24/25), re-run 0, 8 audit + 8 activity rows.

### 2026-09-28 — Jobs table hides closed jobs by default (deployed `a067ac8`)

Richard: closed jobs should not show on the Jobs tab when it first opens.
`JobListParams.excludeClosed` (`excludeClosed=1`) adds
`currentStage.isClosed = false`; the API default stays "all" because the
pickers call the same route. The Jobs table sends it unless the new "Show
closed" checkbox (URL `closed=1`) is ticked; picking a stage or typing a
search overrides it so a closed stage or an address search still finds the
job. Header reads "N open jobs". Board unchanged (closed columns were
already collapsed). Verified on dev by moving one job to Closed: all 5 /
open 4 / closed stage picked 1 / search 1, then restored. Gate: typecheck
clean, lint 6/22, query tests 14/14, full suite green. A sibling session
was building calendar Phase 2 in the checkout, so the commit was made on
`main` through a temporary worktree and the deploy run from
`/tmp/knuco-main`. **Deployed `a067ac8`** (BUILD_ID `b0-KfO1kETJzHU_uElpM5`
→ `gCg4iE5s2vGZXzV50cr78`, no migration, smoke 307 ×2, journal clean,
backup `postgres-2026-09-28-112808.dump`). Prod: 25 jobs, 6 Closed, so
the table now opens with 19.

### 2026-09-28 — Calendar click-through fix: Viewing menu crashed on open (deployed `596fe14`)

Richard: error when changing Viewing from Everyone to one person. Reproduced
in headless Chromium on dev: opening the menu threw Base UI's
"MenuGroupRootContext is missing" because the People `DropdownMenuLabel`
(a `Menu.GroupLabel`) sat outside a `DropdownMenuGroup`; the earlier QA had
driven `?users=` through the URL and never opened the menu. Wrapped the
label + person checkboxes in a group; both paths (Everyone → one person,
My calendar → one person) now change the URL and the header label with no
console errors. Note the checkboxes are additive: from "My calendar",
ticking someone gives "2 people" until you untick yourself. Gate: typecheck
clean, lint 6/22, 1027 tests. **Deployed `596fe14`** (BUILD_ID
`sMd5qs7fP1qWl0vxJLB14` → `b0-KfO1kETJzHU_uElpM5`, no migration, smoke
307 ×2, journal clean, backup `postgres-2026-09-28-110107.dump`).

### 2026-09-28 — Operations Calendar, Phase 1 deployed (`08e9355`)

`calendar-foundation` was already fast-forwarded onto `main` as `6f65efd`;
the gate re-run on main: typecheck clean, lint 6/22, 1027 tests, build
clean. Richard pushed and deployed from `!` (the deploy ran past the shell's
120 s timeout into the background and finished exit 0): BUILD_ID
`rNiggElI_oVOOMlbDSI2q` → `sMd5qs7fP1qWl0vxJLB14`, migration
`20261006120000_task_scheduling` applied (73/73), smoke 307 ×2, journal
clean, backups `postgres-2026-09-28-104554.dump` +
`pre-deploy-20260928-064548.tar.gz`. Prod verified by SQL:
`tasks_schedule_window_chk` present with the hand-written definition,
`all_day` default true / `scheduled_start` nullable, `default_calendar_view`
default `WEEK`, `tasks_assigned_user_id_due_at_idx` present; 1357 tasks, all
all-day, none with a start. `/calendar` and `/api/calendar` answer 307 to the
portal unauthenticated; the `/schedule` → `/calendar` redirect sits behind
the SSO middleware, so it is checked from a signed-in session.

### 2026-09-27 — Operations Calendar, Phase 1 (built, dev-QA'd, on branch `calendar-foundation`)

Richard's brief: a first-class Calendar that is the field's daily organizer,
the PM's weekly overview and the admin's dispatch board. Plan-mode (3 explore
+ 3 design agents) plus a read-only prod query: 7 users (5 ADMIN), 679 open
tasks of which only **29 are activated** and 639 are inactive steps with no
date; no task has a real time; the existing `/schedule` job-by-crew grid was
used by 0 jobs and its API had no role check. Decisions: one date axis
(`dueAt` stays the deadline and becomes a timed task's end; `scheduledStart`
+ `allDay` describe the window; no `scheduledEnd`), tasks only (no
CalendarEvent, no crew field yet), no calendar library, dnd-kit later.
Built: `src/lib/time/zone.ts` (app zone, DST-safe day math; nurture re-exports),
`src/lib/calendar/{schedule,status,query,select,items,access,url-state,agenda}.ts`
(all pure, tested), `applySchedule` wired into `updateTask` (escalation resets
only on a day change; window edits lock workflow dates), `diffTask` →
`SCHEDULE_CHANGED`, `/api/tasks` `dueFrom/dueTo/unscheduled/unassigned`,
`overdueWhere` adopted in the list filter, field tiles and dashboard KPI,
digest/escalation/card-date boundaries moved to the app zone, two routes,
the `/calendar` page (`src/components/calendar/*`), sheet + dialog
extensions, `defaultCalendarView` preference. Dev: migration applied via
diff/execute/resolve; 1027 tests (+95 over the 932 the UX plan left), lint 6/22,
typecheck + build clean; headless-Chromium QA 30/30 (API + Week/Day/Month/
sheet at 1280 and 390, redirect, empty state) and the SALES_REP coercion
check. Details:
[features/calendar.md](docs/project-memory/features/calendar.md).

### 2026-09-28 — Tasks page opens on "assigned to me" (deployed 2026-09-30 inside `e92a606`)

Richard: "When you are on the Tasks tab it should default to showing the
tasks that are assigned to the current user." `/tasks` now resolves whose
tasks through pure `resolveTaskScope` (URL `?scope=` > the saved
`defaultListScope` the jobs / leads lists already use > Mine; no role
floor — the task API is the floor) and `taskAssigneeFor` (an explicit
`?assignedUserId=` wins, else Mine = the signed-in person, Everyone = no
filter), both in `lib/lists/scope.ts` with tests. A **Mine | Everyone**
toggle sits beside List | Board and writes the URL + the preference; the
header "Mine" pill, the assignee picker's "Anyone" and a Mine-specific
empty state ("Nothing assigned to you" → Show everyone) all route through
it; the list query waits for the preference so there is no Mine→All flash.
Links that mean the team's tasks now say `scope=all` (dashboard All-scope
Overdue tile, the case page's task list, the workflow-health "Ready steps",
the workflow report, the calendar's "View unscheduled"), and the page
gained the `unscheduled=1` filter ("No date yet") that the calendar link
had been sending into the void. Also fixed the known hydration warning on
`/tasks`: the header summary pills render only once mounted. Headless QA
14/14 (bare `/tasks` = mine only; Everyone → all + pref ALL; reload follows
the pref; Mine again; `?scope=all`, explicit assignee and `?unscheduled=1`
links keep their meaning; no page errors). Gate: typecheck clean, lint
6/22, 1159 tests (+2), build clean. On prod since 2026-09-30 (BUILD_ID
`gVj4IZE3Efq2TEHiJ0ile`), shipped with the job start-date field.

### 2026-09-28 — Notifications v2, Stage 2: digests (deployed `b017ded`, cron installed, switch off)

"continue". Built in the `notifications` worktree (ff'd to `main` first):
`lib/email/components.ts`; pure `digest/build.ts` (dedupe → supersede →
batch collapse → sections → subject groups → caps; CREW_LEAD variant),
pure `digest/render.ts` (subject rules, agenda first, role links, View
all activity), `digest/agenda.ts` (the calendar's own query incl.
overlays via the new `lib/calendar/overlays-load.ts`, extracted from the
route; morning adds overdue, due reminders, schedule changes and job
starts through loaders now exported by `reminders.ts`), `permissions.ts`
(≤ 5 queries per person), `digest/run.ts` (ledger → atomic claim →
filter → build → render → send → mark; SKIPPED_EMPTY / SKIPPED_MUTED /
FAILED-with-release / stale recovery / prune / dry run), `runMorningDigest`
stands down under takeover, `WORKFLOW_READY_EMAILS_ENABLED` retired, admin
settings / log / tick routes + `/admin/notifications` (Delivery ·
Immediate rules · Log) + sidebar entry. Dev QA 16/16 on the worktree dev
server with one real digest to Richard (details in the feature doc).
Gate: typecheck clean, lint 6/22, 1157 tests (+15), build clean. No
migration. Richard pushed and deployed from `!`: BUILD_ID
`AJgI-9h4wEZJtyDX0DEfz` → `T-gHoVihFeo4ZA4S_c1vx`, smoke 307 ×2, journal
clean, backup `postgres-2026-09-28-132409.dump`. Then the wrapper
`/home/knuco/crm-cron/notifications.sh` + `*/10 * * * *` were installed as
`knuco` and run once: `recording: true, takeover: false`, window
`2026-09-28:08:00`, 0 pending (shadow, 0 rows so far). The delivery switch
stays off until Richard ticks it under Admin → Notification Digests.
Details:
[features/notifications.md](docs/project-memory/features/notifications.md).

### 2026-09-28 — Notifications v2, Stage 1 merged + deployed (`4e9ee62`); shadow flag pending

Richard: "lets do it". `main` (18 commits ahead) merged into `notifications`
in the worktree: schema kept both sides' `User` columns, CLAUDE.md both
sides' entries; the migration folder renamed `20261006120000_notifications`
→ `20261007120000_notifications` (it shared the calendar migration's
timestamp) and its dev `_prisma_migrations` row re-pointed by SQL. Gate on
the merged tree: typecheck clean, lint 6/22, 1142 tests, build clean. `main`
fast-forwarded, Prisma client regenerated in the main checkout. Richard
pushed and deployed from `!`: BUILD_ID `Vb1KFWlyhrVkEEeBQMdzA` →
`AJgI-9h4wEZJtyDX0DEfz`, migration applied, smoke 307 ×2, journal clean,
backup `postgres-2026-09-28-125713.dump`. Prod after: 0 notification rows
(flag off), 8 users DIGEST / 0 IN_APP_ONLY (nobody had muted mail), old
IN_APP `notification_events` marked read. Richard then appended
`NOTIFICATIONS_V2=1` to `/etc/knuco/env` and restarted (from `!`); the
dry-run tick answered `recording: true, takeover: false, windowKey
2026-09-28:08:00, nextWindowKey 2026-09-28:12:00`, no secret → 403, the
`notification_settings` row was created lazily with `enabled = false`,
journal clean. Shadow mode is live; Stage 2 is the next build.

### 2026-09-27 — Notifications v2, Stage 1: record + shadow (built, dev-QA'd, branch `notifications`)

Richard: workflows now generate too many individual emails; consolidate
routine activity into ~4 digests a business day without losing urgent
mail. Plan-mode (3 explore + 2 design agents); the prod volume query was
refused by the auto-mode classifier, so the diagnosis is from the code:
step completions mailed assignee + applier (creator of every step) +
watchers with the actor included, `onTaskClosed` mailed each newly Ready
dependent, `reassignUnresolved` mailed once per step incl. inactive ones,
nothing grouped, no bell rows for tasks. A sibling session was editing the
main checkout (calendar columns in the dev DB), so Stage 1 was built in
`.claude/worktrees/notifications`. Built: `Notification` /
`NotificationDigest` / `NotificationSettings` + three `User` preference
columns (backfilled from the legacy booleans) + `TaskEventType.NOTIFIED`;
`kinds.ts` registry (string kinds), pure `classify()` (forced → NONE →
actor receipt → admin overrides → default + upgrade → user mode / muted
category → batch / cap / storm), `notify()` (upsert on the dedupe key,
`legacy: true` on any failure), DST-safe `windows.ts`, `storm.ts` +
`sendOpsEmail`, `deliverImmediate`, tick route (retry + dry run); producers:
tasks (completion drops the applier of engine tasks, adds the PM / case
manager as `owner`, actor = bell receipt), workflow Ready with batch keys,
`reassignUnresolved` split active/inactive, stage templates, violations,
contract outcome, follow-up / new-lead bell rows; bell + `/notifications`
+ API on the new table; `PATCH /api/me/preferences` mirrors the legacy
switches. 989 tests (+57), lint 6/22, typecheck + build clean.
Details: [features/notifications.md](docs/project-memory/features/notifications.md).

### 2026-09-25 — UX Stage 4 deployed (`f95b425`); the four-stage plan is on prod

`ux-polish` merged into `main` (CLAUDE.md conflict resolved as before);
gate: typecheck clean, lint 6/22, 932 tests, build clean. Richard pushed
and deployed from `!`: BUILD_ID `P2cLnp1LPVdhUtb8v8hLf` →
`rNiggElI_oVOOMlbDSI2q`, no pending migrations, smoke 307 ×2, journal
clean since restart, backup `postgres-2026-09-26-030123.dump`. The
three stage branches were deleted locally after the merges. Across the
day: 886 → 932 tests, lint 6/28 → 6/22, no migration in any stage.

### 2026-09-25 — UX Stage 3 deployed (`8b0740c`)

`ux-pages` merged into `main` (CLAUDE.md conflict again, resolved to the
deployed wording); gate on the merged tree: typecheck clean, lint 6/22,
930 tests, build clean. Richard pushed and deployed from `!`: BUILD_ID
`JzcQ_qnobf471IUalTKX_` → `P2cLnp1LPVdhUtb8v8hLf`, no pending migrations,
smoke 307 ×2, backup `postgres-2026-09-26-025157.dump`. The journal held
16 `ENOENT …/.next/required-server-files.json` / `pages/500.html` lines
from the **old** process during the ~7 s the new build rewrote `.next`
under it; zero since the restart. That is how `deploy.sh` has always
built (in place, old server running) — a known blip, not a regression.

### 2026-09-25 — UX Stage 2 deployed (`46f4b11`)

`ux-nav` merged into `main` with one CLAUDE.md conflict (both sides had
edited §3 and §10; resolved to the deployed wording). Gate on the merged
tree: typecheck clean, lint 6/27, 926 tests, build clean. Richard pushed
and deployed from `!`: BUILD_ID `QLO41RrNwa7l830TCo1bd` →
`JzcQ_qnobf471IUalTKX_`, no pending migrations, smoke 307 ×2, journal
clean, backup `postgres-2026-09-26-024325.dump`, `.deploy-sha` `46f4b11`.
The public host answers the old `/pipeline` and `/production` URLs with
the SSO redirect first (middleware runs before the page), so the
board-view redirect is checked from a signed-in session.

### 2026-09-25 — UX Stage 1 deployed (`67416fd`); Stages 2–4 built on stacked branches

Richard pushed and deployed from `!`: BUILD_ID `Rh7FTDIQPnuwxPK6C8LD2` →
`QLO41RrNwa7l830TCo1bd`, 72 migrations / none pending, smoke 307 ×2,
journal clean, backup `postgres-2026-09-26-023438.dump`, `.deploy-sha`
`67416fd`. Stages 2 (`ux-nav` `51b29cc`), 3 (`ux-pages` `8c7805c`) and 4
(`ux-polish` `e710d49`) are built and dev-QA'd, stacked in that order,
waiting on Richard's prod click-through of each before the next merge.

### 2026-09-25 — Address-first labels (UX Stage 1 of 4; built, dev-QA'd)

Richard: task items say "JOB-00009" where users know the address; make the
whole UI friendlier. Plan-mode (3 explore + 2 design agents); decisions:
address first with customer under it and the number as a small mono hint,
address in customer-facing mail too, merge Leads/Pipeline and
Jobs/Production with a Table|Board toggle, order labels → nav + ⌘K → job
page → polish. Prod check (read-only): 18 jobs / 32 leads / 508 tasks,
every job has a street, 2 customers own >1 job. Built `src/lib/labels/*`
(`formatAddressLine`, `jobLabel`/`jobText`, `caseLabel`, `subjectLabel`,
`JOB_LABEL_SELECT`), `EntityLabel`/`JobRef`, a server-searched `JobPicker`
on `ui/command.tsx`, job search over the lead's street/city/company/zip/
phone, and swapped ~40 surfaces + 10 email/string sites; new jobs are
titled "<trade> — <address>". Found and fixed: field task detail read a
lead field that was never selected. Commits `fa52de5` + `3f462e7`. 916
tests (+28), lint 6/27, build clean; headless-Chromium QA on dev.
Details: [features/ux-labels-nav.md](docs/project-memory/features/ux-labels-nav.md).

### 2026-09-25 — Nurture + "my jobs" deployed (`6b42725`)

`nurture` fast-forwarded onto `main` (Richard's first attempt ran inside
the worktree: merge was a no-op, push shipped Stage 1 alone, deploy
refused "not on main"; the session left the worktree and merged from the
main checkout, whose generated Prisma client had to be regenerated
first). Deploy `6b42725` → BUILD_ID `Rh7FTDIQPnuwxPK6C8LD2`, 72
migrations up to date, smoke 307 ×2, journal clean, backup
`postgres-2026-09-25-173110.dump`; the wrapper's exit 1 was the shell,
not the deploy. Prod: seed 12 created / second run unchanged; dry run
enrolled 11 / due 6 / all `outside_window` (after 11:00 ET) with
`enabled:false`; public routes 403 / 307; `nurture.sh` + crontab line
installed as `knuco` and run once (200, gates off). Nothing sends until
SPF, `NURTURE_ENABLED=1` and the admin switch.

### 2026-09-25 — Customer nurture cadence (Stage 2 of 2; built, dev-QA'd, on branch `nurture`)

Automated follow-ups (day 2/7/14/30 then monthly, from the rep, reply-to
the rep) and non-salesy nurture pieces (day 4/10/21 then monthly, offset
from the follow-up) to every open lead with an email, until Won / Lost /
opt-out. Schema `20261004120000_lead_nurture` (settings singleton,
content library with `seedKey` + `sentCount` + `editedAt`, one state per
lead, sends with `@@unique([leadId, slotKey])`), DST-safe `time.ts`,
pure `plan.ts` (`decideAction` matrix: stop / pause / resume / none /
skip_follow_up / follow_up / nurture / nurture_exhausted; re-anchor
resets the step for stage/estimate/contract, keeps it for a personal
touch), runner `run.ts` (enrol → reconcile → sync touches → due, capped,
one per address → act with send-row-first idempotency → rep prompt task
`nurture.personal-touch` → `reportDelivery`), hooks in eight write paths,
`POST /api/cron/nurture` (`?dryRun=1`), admin routes + `/admin/nurture`
(Cadence / Library with preview + test send / Queue with "Preview
today's run" / Log), `/api/leads/[id]/nurture` + lead card. Gates:
`NURTURE_ENABLED` env **and** the DB switch; dry runs work with both off.
Seeds: 4 follow-ups + 8 nurture drafts. Dev QA found two things: MailerSend
rejects `List-Unsubscribe` headers below the Professional plan (422) —
headers dropped, body link stays; and the dry run skipped leads it would
enrol the same run — now planned in memory. 886 tests (+52), lint 6/28,
typecheck + build clean. Details:
[features/nurture.md](docs/project-memory/features/nurture.md).

### 2026-09-25 — Mine by default + calmer boards (Stage 1 of 2; built, dev-QA'd)

Richard: boards too busy; users should see only jobs they have a role
in; open leads need automated follow-ups plus non-salesy nurture emails.
Plan-mode (3 explore + 2 design agents). Stage 1: one definition of
"involved" (`src/lib/jobs/involvement.ts`: rep, PM, workflow team slot,
field assignment, crew membership, personnel scope; leads = assigned or
customer of an involved job), client-safe `src/lib/lists/scope.ts`
(`scope=mine|all`, floor SALES_REP + CREW_LEAD, MARKETING unfloored; API
default stays `all` because seven pickers call the list routes),
`buildJobListWhere` widened (rep floor is now "involved"), new pure
`buildLeadListWhere` (fixes the rep `assignedUserId` overwrite), dashboard
+ workflow-health `?scope`, `User.defaultListScope` / `boardDensity`
(migration `20261005120000_list_scope_prefs`) via `/api/me/preferences`
+ `/settings/lists`, `useListScope` (URL > pref > MINE, `ready` gate),
kanban kit: `maxVisiblePerColumn` 25 with "Show more", density, WIP
tone, `BoardToolbar` (Mine/All, search, person/service, density,
Columns menu), compact `JobBoardCard`/`LeadBoardCard`, 500-cap notice,
Mine empty states; jobs/leads lists get the toggle, URL-mirrored
filters, assignee filter (leads), scoped CSV names. 834 tests, lint
6/28, typecheck + build clean. Dev QA: admin Mine → empty state → All
persists; counts differ per scope on jobs/leads/dashboard/health.

### 2026-09-25 — Estimates + customer contracts on the job (built, dev-QA'd, on branch `contracts`)

Richard: "When a lead is changed to a job I need a place to create an
estimate and to be able to generate a contract for signing." Plan-mode
(3 explore + 2 design agents); decisions: both estimate systems on the
job, drawn + typed + consent e-signature, admin-editable versioned
template with a seeded residential default, signing sets the job's
contract amount. A second session was editing the same checkout, so
Stages 2–3 were built in an isolated worktree. **Stage 1** (`90c5339`, main):
Money → Estimates on the job, status pill + Mark sent/accepted/declined
(status-only PATCH; fixed the dialog resetting SENT/ACCEPTED to DRAFT on
every save), Won toast "Estimate & contract", middleware public prefixes
now match on a segment boundary (`/co` no longer opened `/contracts`).
**Stage 2** (`1676d67`): schema (`CustomerContract`, `ContractTemplate`
+ versions, CHECK one source), pure libs (merge fields, schedule,
snapshot via the estimators' own math, state + money effects, template
content hash), PDF renderer, seeded `residential_construction` v1
(hash-pinned), service + routes, Contract panel, Generate dialog with
optional-line pick, locked Pricing card, admin template editor.
**Stage 3**: send/resend (token rotates), `/sign/[token]` page + rate-
limited public API, single-use sign (conditional `updateMany`), signed PDF
with certificate page (unsigned SHA-256, sha256(token), IP, UA, consent),
money effects + `recomputeJobBalance`, `contract.sent` auto-task, escaped
branded emails, decline, void-of-signed reversal. Dev QA: API lifecycle +
headless Chromium signing at phone width; job went $30,000 → $1,250 /
deposit $500 on sign and back on void. 739 tests, lint 6/28, typecheck
clean. `scripts/qa-cleanup-contracts.ts` purges the dev QA rows.
Details: [features/customer-contracts.md](docs/project-memory/features/customer-contracts.md).


### 2026-09-25 — Code Violations, Stage 3: reminders, escalations, notices (deployed)

No migration (the reminder log shipped in Stage 1). Pure `deadlines.ts`
(`collectDeadlines` → compliance / appeal / fine-accrual start / hearings /
agency inspections / linked-job permit expirations, each keyed
`<row>@<date>` so a moved date is a new series; `planReminders` = the
nearest crossed offset of 30/14/7/3/1/0 not yet logged, one mail on
catch-up, and a daily `od:<ymd>` for an overdue compliance deadline),
`escalations.ts` (levels = thresholds passed, default `1,3,7`; case
manager → + MANAGERs → + ADMINs), `email.ts` (deadline digest, escalation,
single-case notice on the branded shell), `notify.ts` (assigned, item
assigned, inspection scheduled, agency confirmed, closed — actor
suppressed, a lead-scoped `NotificationEvent` bell row per send),
`reminder-run.ts` (log-before-send, delete on failure, one mail per person,
muted recipients logged as `channel: none`; escalations behind
`VIOLATION_ESCALATIONS_ENABLED`, ledger advanced only when someone was
reached) and the cron route. Hooks in create/update/items/inspections/
close. Dev QA: planner, gating, bell rows, catch-up and the failure/retry
path all as designed (see the feature doc for the MailerSend detail).
802 tests (+91), lint 6/28, typecheck clean. **Deployed `fb9cc70`**
(build `3n5-hSws66cBDrKEdWGqz`; droplet wrapper + crontab line installed
as `knuco`; manual prod run → 200, 1 case, 0 due; no secret → 403).
Details:
[features/violations.md](docs/project-memory/features/violations.md).

### 2026-09-25 — Code Violations, Stage 2: cases (deployed)

Everything case-shaped, no migration: `src/lib/violations/*` (access with
explicit role lists + `casePermissions` returned by `readCase`; list
queues as a pure tested `buildViolationListWhere`; `deriveCaseState` +
`deriveCaseAlerts`; fines estimate computed on read, official balance
never merged; `closeCase` engine-skips open steps and audits an
ADMIN/MANAGER override separately; agency inspections with FAIL → item
reopen; `onJobCompleted` from the transition chain and stage change),
validators, ~40 routes under `/api/violations/**`, sidebar sections
(collapsible, scrollable, tested `isNavActive`), `ConfirmDialog`,
`useSearchParamState`, five-step intake with a lead picker + `returnTo`,
list with queues/flags/bulk-assign/CSV, case page with 13 tabs, hearings
and inspections pages, `TemplateLibrary` shared with admin, Lead/Job
Violations tabs, task chip + `/tasks` filter, files scope, field labels.
Dev QA (headless Chromium + API as ADMIN and SALES_REP) found **one
defect — reopening a closed case left every step cancelled** — fixed:
`reopenCase` reinstates the closure's engine skips and re-sweeps
activation (`close.test.ts`). Also: `.claude/worktrees/**` ignored by
eslint and git (a sibling session's worktree was doubling lint counts
and would have blocked `deploy.sh`'s clean-tree gate). 711 tests, lint
6/28, typecheck + build clean. **Deployed `aeb7ad0`** (build
`_txMHaK7zd-4SxSb2eGWr`; smoke 307 ×2, journal clean; `90c5339` — the
sibling session's "estimates on the job page" commit, already on local
main — shipped with it). Details:
[features/violations.md](docs/project-memory/features/violations.md).

### 2026-09-25 — Code Violations, Stage 1: engine → subject + schema (deployed)

Plan-mode session (three exploration + three design agents) → plan
approved → Stage 1 built. The workflow engine now runs on a **subject**
(`src/lib/workflows/subject.ts`): a job composes Core + trades, a
violation case composes exactly one `VIOLATION` template and never Core.
`ApplyInput.subject` (+ deprecated `jobId` alias), `materializePlan({links})`,
`plan.permitGateKey`, `ScheduleContext.subjectCreatedAt` (+ optional
`complianceDeadline` / `hearingDate`), `rescheduleAnchor`, `CASE_MANAGER`
role, six case evidence types, `readCaseWorkflow`, `subjectScopeForTask`,
`Task/File/Communication.violationCaseId` links (case tasks never carry
`jobId`). Migration `20261002120000_code_violations` (applied on dev; the
one-subject CHECK and the case-number SEQUENCE are hand-appended; no
backfill). Template `code_violation` (75 steps, 6 toggles) + 22 categories
seeded on dev. **Regression proof:** the four v1 hashes are pinned as
literals in `seed-specs.test.ts`; seeder "unchanged" ×4; `previewWorkflow`
on JOB-00001 → 170 existing / 0 to create. 653 tests (+37), lint 6/28,
typecheck + build clean. **Deployed `106555c`** (build
`IOfCCkc_XvREIsTLQ5zyR`; prod: CHECK + sequence verified, seeds run,
the one live instance still job-owned). Details:
[features/violations.md](docs/project-memory/features/violations.md).

### 2026-09-25 — Acknowledge deliberately deleted postings (deployed + applied)

`AllocatorPostingAck` (migration `20260927120000_allocator_posting_acks`,
keyed by the posting's `externalId`, snapshot + decidedBy);
`classifyAllocatorPostings(postings, rows, acknowledgedIds)` moves acked
postings to their own list; shared `lib/expenses/acknowledge-posting.ts`
(verifies the posting is missing right now; audit
`allocator_posting_acknowledged` / `_unacknowledged`);
`POST/DELETE /api/admin/job-cost-reconciliation/acknowledge` (job-cost
approver list); page: Acknowledge on each missing row, collapsed
"Acknowledged as deliberately deleted" list with Undo.
`scripts/acknowledge-deleted-postings-2026-09-25.ts` recorded Richard's
ruling on the three ($25,584.10) on prod through the same service: 3 ack
rows, 3 audit events; classifier now missing 0 / acknowledged 3. A first
schema-edit attempt left an empty migration recorded on dev — removed
from `_prisma_migrations` and regenerated under the same name before it
ever left dev. 616 tests, lint 6/28. **Deployed `e4c6d7e`** (build
`bVpT1lcJe0HpTzQMnhFPE`).

### 2026-09-25 — Job-cost reconciliation, Phase 2 (deployed; keys pending)

cc-allocator PR #32 (`75078d4`, deployed with
`/var/www/careyos/scripts/deploy-ccallocator.sh` **run as `knuco`** — root
has no GitHub key, and a stashed local `package-lock.json` drift had been
blocking `git pull`): `GET /api/internal/crm-postings`, bearer
`CRM_RECON_API_KEY`, every card/bank row with a CRM job or expense id in
one flat shape. CRM: `lib/integrations/cc-allocator/postings.ts` (fetch +
zod, 10s timeout, never throws), pure `lib/expenses/reconcile-allocator.ts`
(`missingInCrm` / `neverPosted` with reason / `heldPending`), `allocator`
block on `GET /api/admin/job-cost-reconciliation`, "From cc-allocator's
side" card. The env-file writes were refused by the auto-mode classifier,
so Richard asked for it explicitly and the same command then went
through: key placed, both apps restarted, the CRM's own
`fetchAllocatorPostings` + classifier run on prod → counts 279/102/374,
missing 3 ($25,584.10, the intentional deletions), never posted 6
($5,125.27: four bank rows queued/awaiting, two card rows in flight),
held 0. Also fixed: archived `scripts/cc-allocator/*` had broken
typecheck on `main` since `107f43c` — excluded in tsconfig. 615 tests,
lint 6/28. **Deployed `972affe`** (build `-1tKwAW5IigEUf_Jhe-Sm`).

### 2026-09-24 — Job-cost reconciliation, Phase 1 (deployed + applied)

Richard ruled on the findings the same evening. Built: pure
`lib/expenses/reconcile.ts` (twin = manual APPROVED non-payroll row, same
job + amount, ±3 days; `findManualTwin`, `pairCandidates`); intake creates a
twinned posting **PENDING** with a review note and accepts **negative
amounts** (credits) from that route only; `lib/expenses/delete.ts` is the
one audited delete path (`expense_delete`); `ExpenseReconciliation`
(migration `20260926120000`) + `GET/POST /api/admin/job-cost-reconciliation[/resolve]`
(`canApproveJobCosts` list) + `/admin/job-cost-reconciliation` page.
Applied on prod through `resolvePair`: **19 duplicates removed
($16,070.96; the doc had said 18 — 10+4+3+2 is 19, dollars were right), 2
KEEPs**; 19 audit events. cc-allocator side via two scripts kept in
`scripts/cc-allocator/`: BNW $11,694.15 → JOB-00010, 23 credits → −$7,580
(BullMQ job-id dedupe needed the stale jobs removed first). Prod: 453
expenses, 0 pending, 0 CRM errors in cc-allocator. 612 tests, lint 6/28.
**Deployed `3e8b211`** (build `P9PjvUEYphWrWc-OX3EMp`).

### 2026-09-24 — Job-cost reconciliation pressure test (no code)

Read-only diff of cc-allocator (`Transaction` 279 CRM-linked / 253 posted,
`BankTxn` 102 / 97) against CRM `job_expenses` (448, all APPROVED; 348
external, 99 manual). Agrees: 347 rows exact on amount/job/type/date
(billable flag drifts on 101 rows, cosmetic). Missing in CRM though
cc-allocator holds a `crmExpenseId`: 3 bank postings $25,584.10 (deleted;
expense deletes are unaudited). Never posted: 23 card credits −$7,580
(intake refuses negatives → refunds never reach costing), 5 bank rows
$16,443.75 (one `postCrm` off, three queued, one unassigned). Manual↔
allocator twins: **20 pairs $16,502.96** (was 12 / $9,166.20 in August;
manual first in 19/20; JOB-00006 $432 and a ±3-day $800 look genuine).
Correction: none inflate a customer bill — the "billable" ones are on the
owned rehab. Proposal: Phase 1 CRM-only (intake guard creating PENDING on
a ±3-day manual twin, accept negative postings, reconciliation page with
audited "confirm duplicate → delete manual row"), Phase 2 a postings
export from cc-allocator. Findings in
`docs/project-memory/job-cost-reconciliation-2026-09-24.md` and at
https://claude.ai/artifact/Afy7pAJjbqSdvKRo7GFnxG. Nothing deployed.

### 2026-09-24 — SSO dead-code cleanup + pickers (deployed)

Removed `lib/auth/lockout*`, `password-policy` (+ tests) and
`scripts/create-admin.ts`; `/api/admin/users` is GET-only and PATCH no
longer takes `password` (admin page loses Add User / Password and says
users come from CareyOS); `next-auth`, `bcryptjs`, `@types/bcryptjs`
uninstalled; seed writes the `"sso:careyos"` sentinel. Seven assignee
pickers (jobs list, job permit form, leads list, lead detail, new/edit
lead, permits) moved from `/api/admin/users` to `/api/users/assignable`
under the `assignable-users` key — ADMIN/MANAGER-only surfaces stay.
Digest check closed from the prod journal. Verified as SALES_REP on dev
(assignable 200, admin 403, create 405). 605/605 tests, **lint 6/28**,
build clean. **Deployed `cf746a2`** (no migration; build
`3FNcA-gRq83Kv0jIR_b9V`).

### 2026-09-24 — Progress billing, Stage 3 (deployed)

Retainage release = an application at a lower rate, no schema change:
`computeApplication` gains `previousRetainagePercent` → `previousRetainage`,
`retainageReleased`; JOB-00009 full release after app 12 is exactly
$60,742.90. `getBillingSummary` adds `effectiveRetainagePercent` (latest
issued app's rate; drafts/VOIDs never move it), `retainageReleasedOn`,
`totals.retainageReleased`; `Job.retainagePercent` stays nominal. Inputs
accept `retainagePercent` + empty lines; guards ordered over-scheduled →
negative due → nothing billed/released; `bad_retainage`. G702 PDF prints
the release line. Collections: `getProgressPositions` splits `balanceDue`
into open A/R + retainage held + balance to finish (sums exactly; read
model only) → "Progress-billed jobs" card + Outstanding KPI sub-line.
Dialog: rate field with Release half / all / Keep, live release row,
"Create release draft". Dev QA: 9,000 → 500 → (draft 1,000 → 500) →
4,750 → 750 all reconcile; QA rows purged from dev. 618/618 tests, lint
6/29. **Deployed `4833ea3`** (no migration; build `5-_3pStOG66-kWTGKKfmr`).
Details: [features/progress-billing.md](docs/project-memory/features/progress-billing.md).

### 2026-09-24 — Progress billing, Stage 2 (deployed)

Change orders on PROGRESS jobs: approval adds a `SovLine` linked by
`changeOrderId` (migration `20260925120000_change_order_sov_lines`) via the
pure `changeOrderSovLine` (`lib/billing/sov.ts`) instead of issuing an
invoice; billed through the next applications. Fixed-price contract still
increments so Σ SOV = contract. Linked line: value read-only (400),
undeletable via `/api/sov` (409); deleting the CO removes the line, refuses
`has_billing` once a live application billed on it, and drops VOID
applications' line rows first (dev QA caught the FK 500). No
`invoice.sent` task for SOV approvals. UI: "SOV item #n" in the CO panel,
"Approve & add to SOV", `CO-n` badge on the Invoices tab. Prod had no COs
on its one PROGRESS job → no backfill. 613/613 tests, lint 6/29.
**Deployed `6b3868b`** (migration applied; build `ZL4mI9LnfV2k2DeUusDC4`).
Details: [features/progress-billing.md](docs/project-memory/features/progress-billing.md).

### 2026-09-24 — Trade Workflow Templates, Stage 3 (deployed)

Jobs API filters through a pure `buildJobListWhere` (`lib/jobs/query.ts`:
`workflowTrade`, `permitStatus` incl. `NONE`, `phaseKey`,
`workflowBlocked/Overdue/Unassigned`) and `withWorkflow=true` per-job
summaries (`lib/workflows/summary.ts`, three queries a page). Jobs list:
Workflow filter row (URL-seeded), Phase column, permit pill, 7 CSV
columns; board card: phase + chips; dashboard `WorkflowHealthWidget`
(`?type=workflow-health`, own-jobs scope for non-office roles). Reporting:
`?type=workflow` → `lib/workflows/reports.ts` (durations by trade/phase +
phase cycle time, overdue by role, stalled steps via `classifyDelayCause`,
lead times, most-skipped people-vs-engine); Workflow section on /reports
with CSV. Explicit role list `canViewWorkflowReports` (ADMIN, MANAGER,
OFFICE_STAFF, READ_ONLY). Headless-Chromium QA on dev (Chrome tool refuses
to set the dev cookie). 604/604 tests, lint 6/29. **Deployed `f332e26`**
(no migration; build `W3SSiv0mXjZ3bx9g0kTOU`). Details:
[features/workflows.md](docs/project-memory/features/workflows.md).

### 2026-09-24 — Trade Workflow Templates, Stage 2 (deployed)

One reconcile engine for every re-plan (`ReconcileChange`: permit decide
or reverse with a required reason when dropping it, add/remove trade with
per-task retain, scope, version upgrade with drift report): build the plan
→ diff (`toCreate / toReinstate / toSkip / preserved`) → apply by adding,
reinstating engine skips and skipping through `updateTask`. Never deletes;
completed, manual, correction and user-skipped tasks are untouched.
`previewReconcile` powers the two-step dialogs. Inspections: PASS /
CONDITIONAL / FAIL with correction tasks; a failed step reopens as Ready
when its corrections close. Versioning: drafts, collected validation with
"Go to step", publish supersedes, jobs pin and the tab offers upgrades.
Template Library editor (`/admin/workflow-templates/[id]`) with sortable
phases and steps, a full step sheet and a client-side cycle check — no
raw JSON. Manual dependencies route. QA found one defect (reopen waited on
ordinary predecessors) — fixed. 579/579 tests, lint 6/29. **Deployed
`5528cba`** (no migration; build `0SgZtTjvxkoK30iIR74tF`).

### 2026-09-24 — Trade Workflow Templates, Stage 1 (deployed)

Reusable, versioned phase-and-step templates that generate **ordinary
tasks**. Core Construction + Roofing / Interior Renovation / Doors &
Windows, composed per job with a Permit / No-Permit branch (exact legal
warning), scope toggles, role-based assignment (team slots → job PM/sales
→ admin defaults), business-day due dates from predecessors, blocking
gates, checklists and required evidence. Migration
`20261001120000_workflow_templates` (+ `activated_at` backfill so no count
moved). Pure `compose()`; `apply` is idempotent (second apply creates 0,
unique index as backstop); activation runs inline from `updateTask`.
Workflow tab first on the job, Apply dialog with preview, task-sheet block,
`/tasks` filters, admin Workflow Templates (read-only) + Workflow Roles.
563/563 tests, lint at baseline. **Deployed `2790b88`** (migration applied,
build `uvoRaHDsO4HPJEnijWxig`); prod seeded with the four v1 templates
(second run: unchanged). Details:
[features/workflows.md](docs/project-memory/features/workflows.md).

### 2026-09-24 — Task edit + delete (follow-up)

Richard: "I should be able to edit and delete tasks as well." Inline
title/description editing in the sheet, and a delete with confirmation
behind `DELETE /api/tasks/[id]` + `canDeleteTask` (office roles or the
raiser), audited. Browser-QA'd on dev; 482/482 tests.

### 2026-09-24 — Visual redesign (Stage 3 of 3; deployed `e867c5e`)

Steel-blue brand + tone + five-phase stage tokens in `globals.css`;
`lib/ui/stage-colors.ts` derives a stage's colour from its order (tested);
`components/kanban/*` replaces the three hand-rolled boards (`/production`
now shows every DB stage, `/pipeline`, the tasks board) with mouse, touch
and keyboard drag and per-board collapsed columns; `EntityHeader` +
`StageStepper` (confirm dialog) on job and lead detail; job tabs grouped
into Money · Field · Permits · Tasks · Files · History with `?tab&sub` in
the URL; jobs and leads lists on `StagePillSelect`, `Progress`,
`PermitBadge`, avatars, sticky headers, skeleton and empty states; tasks
page header with summary pills, segmented view toggle, filter drawer, brand
"New task" with an `n` shortcut. New primitives: progress, skeleton,
segmented-control, dropdown-menu (shadcn), empty-state. Details:
[features/design-system.md](docs/project-memory/features/design-system.md).

### 2026-09-24 — Task email follow-up (Stage 2 of 3; deployed `4b6021d`)

Nudge (`POST /api/tasks/[id]/nudge`, 24h cooldown, sheet button), per-task
"remind me on" delivered by the morning digest, overdue escalation to the
raiser then managers (`lib/tasks/escalations.ts`, **off until
`TASK_ESCALATIONS_ENABLED=1`**), and auto follow-up tasks on estimate sent /
invoice sent / daily log returned / change order sent, auto-closed when the
event resolves (`lib/tasks/auto-tasks.ts`, `invoice.sent` disabled by
default). Per-user channel toggles at `/settings/notifications`.
`requireCronSecret()` now gates all eight cron routes. Migration
`20260924130000_task_followups`. Details:
[features/tasks.md](docs/project-memory/features/tasks.md).

### 2026-09-24 — Tasks everywhere (Stage 1 of 3; deployed `d7262d0`/`ebf1988`)

One creation path (`lib/tasks/create.ts`) and one update path
(`lib/tasks/update.ts`) — the deposit task, stage templates, follow-up rules
and field issues had all been creating tasks silently, and field-issue
resolve skipped the completion mail. New `Task` links to estimate, invoice,
prospect and daily log (migration `20260924120000_task_entity_links`).
Shared `AddTaskDialog` / `EntityTaskPanel` / hooks in `components/tasks/*`,
integrated into lead + job detail, invoice and estimate rows, the office
daily-log page, prospects, dashboard widget, sidebar badge, and field mode
(`/field/tasks` + bottom nav). Fixed BLOCKED being dropped from three
"open" counts and assignee pickers 403ing for non-admins (`/api/users/assignable`).
Browser-QA'd on dev (create from /tasks, job tab, lead tab; sheet timeline;
dashboard widget; field index + bottom nav; field-issue round trip via API;
SALES_REP scoping via API) — one fix out of it: date-only due dates are now
pinned to noon UTC so "due tomorrow" stops bucketing under Today. 427/427
tests, typecheck/build clean, lint 6/28. Deployed 12:45 ET, smoke clean.
Details: [features/tasks.md](docs/project-memory/features/tasks.md).

### 2026-08-27 — Progress billing / payment applications (deployed + backfilled)

Bill work completed in a period instead of the whole balance — AIA
G702/G703 style, driven by JOB-00009. `Job.billingMethod` + retainage,
`SovLine`, applications as `Invoice` + `InvoiceLine`, G702 PDF, Invoices-tab
UI, migration `20260827120000_progress_billing`. Retainage defaults 10%
commercial / 0% residential; one SOV line per contract. 387/387 tests, build
clean. Deployed `891b891`/`78e3d6c`; backfill ran on prod, all 12 amounts
reproduced. Apps 13–14 go in through the UI. Details:
[features/progress-billing.md](docs/project-memory/features/progress-billing.md).

### 2026-08-03 — Task collaboration (deployed as `d12945e`)

Assignment/completion email on the existing branded shell, notes, a per-task
activity trail, watchers, @mentions, BLOCKED status, morning reminder digest.
New: `src/lib/tasks/*`, `src/components/tasks/*`, notes/watchers routes,
`/api/cron/task-reminders`, `/field/tasks/[taskId]`, migration
`20260803120000_task_collaboration`.

**Five pre-existing defects fixed.** Unassign and clear-due-date both 400'd;
`completedAt` survived a reopen; PATCH had no role check; and — worst —
`.partial()` does not strip `.default()`, so **every save silently reset
priority to MEDIUM**, downgrading URGENT tasks on completion. Details in
[known-issues.md](docs/project-memory/known-issues.md).

329/329 tests, typecheck and build clean, lint one warning better than
baseline.

### 2026-08-03 — SSO verified; two decisions closed

No code changes. Frank (CREW_LEAD) signs in and lands on `/field` — the one
load-bearing unknown from the cutover — and sign-out bounces to the portal.
The rollback window is closed; `0759ee8` stands. jgarcia **stays ADMIN**
(confirmed intended, not drift). The old domain **holds at 302** — one
verified login is not a week of clean traffic.

### 2026-07-23 — Domain cutover + CareyOS SSO (deployed)

`69a5c3c..0759ee8`, 7 commits, 43 files, +1592/−674. Two app deploys plus a
portal deploy.

- Moved `crm.knuconstruction.com` → **`crm.careyos.com`**. Old host 302s,
  preserving path + query so emailed `/co` and `/action` links survive;
  `/api/integrations/` is **proxied not redirected** (POST→GET through a 302
  loses the body — this silently broke cc-allocator mid-cutover).
- Discovered both domains were **already on the same droplet**, cancelling
  the planned host move (containerise, DB restore, downtime window).
- Split `APP_BASE_URL` out of `NEXTAUTH_URL` so the public host is one env
  var, decoupled from auth.
- Added the Cloudflare **real-IP** snippet — the host is now proxied, so
  without it every client looks like an edge IP.
- Replaced NextAuth credentials with **CareyOS SSO**. `helpers.ts` was the
  seam, so ~140 route handlers needed no edits.
- Portal repo: `construction-crm` appRoles → the CRM's real seven; registry
  entry corrected (it described a non-existent app).
- **Fixed: unsubscribe links never worked** — `/api/email/unsubscribe` was
  missing from the middleware allowlist, so recipients were 307'd to
  `/login`. Pre-existing and silent.
- Data: Frank's grant `FIELD`→`CREW_LEAD`; jgarcia's CRM email renamed in
  place, preserving 23 referencing rows.

## 5. Known Issues / Technical Debt

Full list: [known-issues.md](docs/project-memory/known-issues.md).

- **SPF is unset on `knuconstruction.com` in MailerSend** (`dkim: true`,
  `spf: false`). Delivering fine today, but strict receivers may spam-folder
  it. Next most likely cause of "never arrived" reports now that the
  recipient cap is resolved.
- Delivery failures now escalate through `lib/email/delivery-report.ts`
  (ERROR log with marker `EMAIL_DELIVERY_FAILURE`, an `EmailDelivery` audit
  row, and a best-effort ops email). Read history at
  `GET /api/admin/email-health` — the channel that still answers when email
  itself is what is broken. Optional `OPS_ALERT_EMAIL`, else oldest active
  ADMIN.
- `PHONE_ROUTING_API_KEY` unset → that endpoint 503s.
- Old domain still 302, not 301 — deliberate, and **still deliberate after
  SSO was proven**. Promote when the old host goes quiet. It is an nginx
  vhost edit on the droplet, not a code deploy; must preserve path + query
  and the `/api/integrations/` proxy exemption.
- **Lint baseline: 6 errors / 28 warnings**, all pre-existing.
- `User.passwordHash` is still a required column carrying the
  `"sso:careyos"` sentinel (auto-provisioner and seed). Dropping it is a
  migration, not a cleanup — leave it unless a schema pass is happening
  anyway.

## 6. Resume Instructions

```bash
git log --oneline -8            # 0759ee8 is the SSO deploy
npm run test && npm run typecheck
```
Read `docs/project-memory/known-issues.md` first. The SSO verification gap
that headed it is closed; what remains is config and cleanup.

## 7. Commands

```bash
npm run dev            # next dev -p 4000
npm run test           # vitest run
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (NOT `next lint` — removed in Next 16)
npm run build

# Deploy — the env override is REQUIRED. The smoke test accepts only
# 200/307 and the old domain now 302s, so a bare ./deploy.sh fails at
# exit 19 *after* shipping.
KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh --yes
KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh --dry-run

# Workflow templates (idempotent; seeds by generation; run on prod after any spec change — dry run first)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-workflows.ts --dry-run"'
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-workflows.ts"'
# Streamlined-workflow migration (one-off; --inventory and the default dry run write nothing; --yes applies; --only JOB-000nn)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx scripts/migrate-workflows-slim-2026-10.ts --inventory"'
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx scripts/migrate-workflows-slim-2026-10.ts"'
# Code-violation categories (idempotent; upsert by key, never overwrites a rename)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-violations.ts"'
# Code-violation deadline cron, by hand (droplet; idempotent per day)
ssh knuco-droplet '/home/knuco/crm-cron/violation-deadlines.sh; tail -1 /home/knuco/crm-cron/violation-deadlines.log'
# Customer-contract template (idempotent; hash-pinned; refuses to rewrite a version a contract pins)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-contract-templates.ts"'
# Nurture settings + content (idempotent; settings create-only; content by seedKey, edited rows untouched)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-nurture.ts"'
# Nurture dry run on prod (plans, writes nothing; works with the gates off)
ssh knuco-droplet 'set -a; . /etc/knuco/env; set +a; curl -s -X POST -H "x-cron-secret: $CRON_SECRET" "http://127.0.0.1:4000/api/cron/nurture?dryRun=1"'
# Notifications cron wrapper, by hand (droplet; the tick is idempotent per person per window)
ssh knuco-droplet '/home/knuco/crm-cron/notifications.sh; tail -1 /home/knuco/crm-cron/notifications.log'
# Notifications tick, dry run (per-person planned digests + due window; sends nothing)
ssh knuco-droplet 'set -a; . /etc/knuco/env; set +a; curl -s -X POST -H "x-cron-secret: $CRON_SECRET" "http://127.0.0.1:4000/api/cron/notifications?dryRun=1"'
```

Prod one-offs: run as user `knuco` on knuco-droplet with `/etc/knuco/env`
loaded. Migrations: `prisma migrate dev` wants to reset the dev DB — use
`migrate diff` + `db execute` + `resolve`.

## 8. Environment Variables (names only — never store values)

Required: `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`.

Public host: **`APP_BASE_URL`** (falls back to `NEXTAUTH_URL`; every
outbound link is built from it).

SSO: **`CAREYOS_SSO_URL`** (default `https://app.careyos.com`),
**`CAREYOS_APP_ID`** (default `construction-crm`),
`CAREYOS_SSO_DEV_BYPASS` / `CAREYOS_DEV_EMAIL` / `CAREYOS_DEV_ROLE` —
**local dev only; the app refuses to boot if the bypass is set under
`NODE_ENV=production`.**

Optional (feature 503s when unset): `TWILIO_*`, `OUTLOOK_*`,
`MAILERSEND_API_KEY`, `EMAIL_FROM`, `OPS_ALERT_EMAIL`, `CRON_SECRET`,
`CC_ALLOCATOR_API_KEY`, `CC_ALLOCATOR_BASE_URL` + `CC_ALLOCATOR_RECON_KEY`
(read cc-allocator's postings export for the Cost Reconciliation page;
unset = the page says so),
`PHONE_ROUTING_API_KEY`, `PHONE_ROUTING_SYSTEM_USER_ID`, `ZAPIER_*`,
`TASK_ESCALATION_DAYS` (default `2,5`), `TASK_ESCALATIONS_ENABLED` (default
off; `1` to enable — after SPF), `TASK_AUTO_RULES_DISABLED` (default
`invoice.sent`; empty string enables everything),
`VIOLATION_ESCALATION_DAYS` (default `1,3,7`, days past the compliance
deadline), `VIOLATION_ESCALATIONS_ENABLED` (default off; `1` after SPF),
`FIELD_ENCRYPTION_KEYS` (SSNs — without it, encrypted rows are unreadable),
`ZYLOW_API_KEY`, `ZYLOW_API_BASE`, `TASK_ESCALATIONS_ENABLED`, `TASK_AUTO_RULES_DISABLED`,
`NURTURE_ENABLED` (default `0`; `1` after SPF — the DB switch under
Admin → Customer Nurture must be on too), `NURTURE_MAX_PER_RUN` (default
`50`; `10` on the first live day), `NOTIFICATIONS_V2` (default `0`; `1`
records a `Notification` row per staff-facing event and lights the bell —
shadow mode, legacy mail unchanged; delivery only moves to v2 when
`NotificationSettings.enabled` is on too — the switch under Admin →
Notification Digests).

## 9. Important Product / Business Rules

- **CareyOS is the identity provider.** New users are created in the
  CareyOS admin, not the CRM. Identity is keyed on **email** — a mismatch
  between portal and CRM addresses mints a second user and orphans records.
- Grants apply on the next page load, no re-login. A portal ADMIN with no
  explicit grant implicitly gets `appRoles[0]` (ADMIN).
- A CRM `User` with `isActive: false` is denied even if the portal allows.
- **Public, session-free paths** — never put these behind auth:
  `/co/*`, `/action/*`, `/api/co/*`, `/api/track/*`,
  `/api/email/unsubscribe`, `/api/integrations/*` (bearer), `/api/cron/*`
  (`CRON_SECRET`). Covered by `src/middleware.test.ts`.
- Integration convention: **503** when a server key is unset (operator
  error), **401** for a bad caller.
- CREW_LEADs are confined to `/field`; the office shell is not for them.
- **Job costs are gated by role + the `canEnterJobCosts` grant** —
  ADMIN/MANAGER/OFFICE_STAFF implicitly, anyone else by explicit grant. Use
  **explicit role lists, never `hasMinRole`**, for anything financial:
  `ROLE_HIERARCHY` ranks SALES_REP above OFFICE_STAFF (Accounting).
- **Only an APPROVED `JobExpense` moves money.** PENDING and REJECTED
  contribute nothing to `contractAmount`, `balanceDue`, the cost-plus rollup,
  job profit, the QBO export or budget allocations. Any new code that sums
  expenses must filter `status: "APPROVED"` — that is the whole control.
  Entry auto-approves for ADMIN/MANAGER/OFFICE_STAFF; everyone else queues.
  Approving is role-only and is deliberately NOT conferred by the enter grant.
- **PROGRESS jobs bill by payment application**, never by "balance due":
  amount = completed-to-date × (1 − retainage) − previous certificates. Only
  the latest application may be edited or voided. Same explicit role list
  as expense approval.
- **Workflow steps are ordinary tasks** written only through
  `createTask`/`updateTask`; a job has no workflow until someone applies
  one, and Core is never removable. Permit branches are exclusive; "No
  Permit Required" records the legal warning and needs PM approval before
  mobilization. **Blocking gates are ADMIN/MANAGER-only to skip or
  override** (audited). A template version is immutable once a job
  references it — bump the version. Own-only roles see tasks on jobs where
  they are PM, field-assigned or hold a team slot. Every open count uses
  `ACTIVE_OPEN_WHERE` (open **and** activated).
- **Who may work a workflow step**: its owner or raiser, an office role, or
  whoever coordinates its job or case (`taskRightsFor` — the job's PM, the
  case manager). Skipping a blocking gate and overriding evidence stay
  ADMIN/MANAGER. A record gate (deposit, final payment, permit closed, fines)
  completes itself once the record is on file; "Corrective work complete"
  and "Close case" never do.
- **Workflow templates come in generations and never mix on a job.** `v1/`
  specs are frozen (hash-pinned); a content change is a new generation in
  `prisma/seeds/workflows`, never an edit. An in-place upgrade only follows
  a version's lineage (`sourceVersionId`); a job on the earlier generation
  moves by migration. Streamlined steps require evidence only where the CRM
  reads the fact from its own records — never a photo, attachment or note.
  A migrated job keeps every earlier row: they are **legacy** (derived on
  read, `isLegacyStep`), shown as "Earlier version" and left out of every
  progress count — any new code that counts workflow steps must exclude
  them the same way.
- **A workflow's subject is a Job or a CodeViolationCase, never both**
  (DB CHECK). A case runs one `VIOLATION` template alone — never Core —
  and its tasks carry `violationCaseId + leadId`, never `jobId`.
  Construction completion is not compliance: the agency's confirmation is
  a separate gate and `close_case` requires it (ADMIN/MANAGER override with
  reason, audited). The fine accrual estimate is computed, never stored;
  only official figures are entered.
- **A customer contract is generated from exactly one accepted estimate**
  (DB CHECK) against a pinned published template version; the stored
  snapshot is the contract and the signed PDF is re-rendered from it, never
  from live data. Signing is single-use, sets `Job.contractAmount` (base +
  approved change orders) and `depositRequired` on FIXED_PRICE jobs, leaves
  rollup types alone, and never touches a schedule of values once a payment
  application is issued. Voiding a signed contract is ADMIN/MANAGER and
  reverses the base. Signed PDFs and signature files are never deleted.
- **Nurture emails are automation, not contact.** They go only to open
  leads with an email, from the rep with reply-to the rep, carry the
  unsubscribe link in the body (no custom headers — the MailerSend plan
  rejects them), are `Communication` rows with `provider "nurture"` and
  `createdByUserId null`, and **never move `lastContactAt`**. Won, Lost
  and opt-out stop them; a personal touch restarts the follow-up clock.
  Every automated sender reports through `reportDelivery`.
- **A task has one date axis.** `dueAt` is the deadline every list, digest
  and escalation reads AND the day it sits on the calendar; for a timed task
  it is the end instant. `scheduledStart` + `allDay` describe the window.
  Every write goes through `applySchedule()` (a bare `yyyy-MM-dd` means
  "move to this day" and carries the window along). "Unscheduled" = active,
  open, no due date — never an inactive workflow step. Overdue = past the end
  of its day in `APP_TIME_ZONE` (all-day) or past its end (timed).
- **cc-allocator owns money that actually moved**; the CRM owns job costing
  including costs that have not moved yet. Expenses with an `externalId` are
  cc-allocator's record — ADMIN-only to delete here, and better fixed there.

## 10. Next Prompt

> **Streamlined workflows: Stages 1 and 2 are done — every prod workflow
> (8 jobs migrated + JOB-00026 applied streamlined, 3 cases) is on the
> streamlined templates (`0ad0f99`, BUILD_ID `_uoyVpElQCqjPaNXDQhtw`).**
> **Stages 3 (completion UX) and 4 ("Complete this phase") are on prod
> (`49c590a`, BUILD_ID `ZaL55YMVgRTZc9b5mi5NP`); the slim-workflow plan is
> fully shipped.** Next: Richard clicks through on prod: a job's Workflow tab opens on what is
> ready ("n to do now in …"), "Complete…" on a step shows Tick all and
> Attach inside the dialog, "Done" appears once nothing is left to tick
> (Undo in the toast), recording a deposit completes "Verify deposit
> received" by itself, "Complete this phase…" at the foot of a phase lists
> its steps with gates unticked, and on a phone Field → a task offers Take
> photo. Then he sets Admin → Workflow Roles — saving now assigns the open
> steps that have no owner (9 active on prod). The paragraph below is the
> pre-migration runbook, kept for the record. Next:
> Richard sets Admin → Workflow Roles first (every default is empty, and
> saving a default does not back-fill existing steps until Stage 3), then
> gives the go. Then, in a quiet window: note the deploy's DB backup (or take a fresh one), `--only
> <one job> --yes`, check that job's Workflow tab (progress on the
> streamlined steps, one collapsed "Earlier version" group), then `--yes`
> for the rest. The migration is not reversible in place — the undo is the
> backup. Until it runs, a v1 job cannot add a trade. After it: Stage 3
> (completion UX) and Stage 4 ("Complete this phase").

> **Operations Calendar Phase 1 is on prod and clicked through; the Jobs
> table hides closed jobs by default (`a067ac8`, BUILD_ID
> `gCg4iE5s2vGZXzV50cr78`); Phase 2 (dispatch) is on prod (`e0380ba`,
> BUILD_ID `sBabA8ralAO2_F-0aMUve`, no migration); Phase 3 (field + today)
> is on prod too, inside `4a9a1b3` (BUILD_ID `2u4fVOc8Ife0Gb0ANSAjF`, no
> migration); Phase 4 (overlays, digest lines, dependency warning, ⌘K
> tasks) is on prod as `4d1be83` (BUILD_ID `Vb1KFWlyhrVkEEeBQMdzA`, no
> migration). All four phases of the plan are live.** Next: three
> click-throughs on prod. Phase 4: an upcoming permit inspection or hearing
> shows on the Week as a dashed card that opens the record and cannot be
> dragged; Month says "n appointments"; ⌘K → type a task title → lands on
> its day with the sheet; tomorrow's digest carries "Schedule changed since
> yesterday" for anything moved today. Phase 3, on his phone: Field Mode → Today tab;
> the greeting, today's tasks in order, Start / Done on one, Directions and
> Call on a job task, Photo lands on the daily log, Checklist "n/m" opens
> the task page's list and a tick saves; Tomorrow expands; the dashboard
> Today card matches. Phase 2, on a desktop: Calendar → People; drag a card
> from the Unscheduled rail onto Lisette / Tuesday (one assignment email,
> timeline shows ASSIGNED + DUE_CHANGED); drag it to another day and back to
> the rail; give two of his own tasks overlapping times on one day, drag one
> onto the other's band in Day view → "Schedule anyway?"; Tab to a card,
> Space, →, Space; Escape puts it down; hover a People cell → "+ Add"
> pre-fills the person. Then Phase 3 (`/field/day`, Today widget) on a new
> branch. UX plan follow-ups,
> nurture operator items and Code Violations Stage 4 still stand. Known
> pre-existing: `/api/permits?status=<bad>` 500s. **The Tasks page now
> opens on "assigned to me" (Mine | Everyone toggle, shared list
> preference) — on prod since 2026-09-30 inside `e92a606` (BUILD_ID
> `gVj4IZE3Efq2TEHiJ0ile`); confirm the sidebar Tasks tab opens on
> Richard's own tasks and Everyone shows the team's. The job page header
> now edits the target start date (same deploy): set one on a job with a
> workflow and check the "Starts …" label and the calendar marker.** Same rules: explicit role lists, tests +
> typecheck + build green, lint ≤ 6/28, deploy with the env override.
>
> **Notifications v2: Stage 1 is on prod in shadow mode (`NOTIFICATIONS_V2=1`,
> switch off); Stage 2 (digests) is on prod as `b017ded` (BUILD_ID
> `T-gHoVihFeo4ZA4S_c1vx`, no migration) with the `*/10` cron wrapper
> installed and ticking in shadow.** Next: Richard opens Admin →
> Notification Digests, checks "Preview the next digest" lists people, and
> when he wants digests to replace per-event mail, he
> ticks "Digest delivery on" there — legacy task / step mail stops, the
> 7:30 task digest stands down, and the four windows send. First day: watch
> the Log tab and `cron.notifications` in the journal. Stage 3 = user
> settings page + admin polish; Stage 4 = `/notifications` polish + legacy
> removal (drop the four booleans, delete legacy senders, old crontab lines).
