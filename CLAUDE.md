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

00000000000. 🔴 **AI Permit Intelligence** — plan approved 2026-10-18
   (`~/.claude/plans/reactive-tickling-pony.md`); full design in
   `CAREYOS_PERMIT_INTELLIGENCE_DESIGN.md` (repo root). Stages: 0 shared AI
   layer · 1 permit record (jurisdictions, parties, cycles, frozen submissions,
   `/permits/[id]`) · 2 corrections (AI extraction → confirmed items → tasks,
   drafts, response letter) · 3 AcroForm filling (pdf-lib) · 4 product
   approvals (FL PA / NOA) · 5 preflight · 6 lessons + metrics. Prod had 3
   permits, so history is captured as structured records first; no vector
   search. **`ANTHROPIC_API_KEY` placed on prod 2026-10-18** (`/etc/knuco/env`,
   200 from the droplet). **Stage 0 built + dev-QA'd 2026-10-18 on
   `permit-ai-foundation`, deployed 2026-10-18 as `c82f906`** (BUILD_ID
   `GzGAthoH8VxKu08PW3y4b`, migration applied, the process carries the key,
   zero journal errors, backup `postgres-2026-10-18-213941.dump`): `src/lib/ai`
   (`runAiCall`, caps per subject + per month, untrusted-document framing,
   pricing), `AiCall` (migration `20261031120000_ai_calls`), Admin → AI Usage.
   **Stage 1 (permit record, no AI) built + dev-QA'd 2026-10-18 on
   `permit-record`, deployed 2026-10-18 as `acdf728`** (BUILD_ID
   `3SyklAeo2NGYbawokTWey`, migration applied, smoke 307 ×2, journal clean,
   backup `postgres-2026-10-18-221510.dump`; seed unchanged, backfill applied:
   3 jurisdictions, 3 types, 3 cycle-1 rows, re-run 0): migration `20261101120000_permit_record`
   (jurisdictions, type catalog, requirement checklist, parties, review
   cycles, frozen submissions + locked files, `File.permitId` /
   `permitDocType`, `Task.permitId`, statuses PREPARING / CORRECTIONS),
   `/permits/[id]`, Admin → Permits, upload byte check. **Stage 2
   (corrections) built + dev-QA'd 2026-10-18 on `permit-corrections`,
   fast-forwarded to `main`, not deployed**: migration
   `20261102120000_permit_corrections` (notices, items, item files, permit
   emails, `files.extracted_text` + a generated tsvector), the AI reads a
   letter (PDF / picture / paste) into proposed items, a person confirms →
   tasks + resubmission task, AI email drafts sent only by a click, the
   response letter PDF, outcomes on the next review, "Suggest a type", the
   Permit Library (`/permits/library`, full text). **Deploy carries the
   migration**; no seed, no cron. **Stage 3 (form filling) built + dev-QA'd
   2026-10-18 on `permit-corrections`, fast-forwarded to `main`, deployed
   2026-10-18 as `da551cc`**: migration `20261103120000_permit_forms` + `pdf-lib`; the Palm
   Beach County universal application (fillable, 132 fields) mapped by the AI
   ($0.20), checked and published under Admin → Permits → Forms, filled per
   permit from the records (licences / qualifier records-only, signatures by
   hand), written as editable + flattened PDFs, finalised; parcel number +
   legal description on the lead; the lead PATCH no longer resets defaults or
   clears the email. **Stage 4 (product approvals) built + dev-QA'd
   2026-10-18, on `main`, deployed 2026-10-18 as `da551cc`**: migration
   `20261104120000_product_approvals`; FL Product Approvals / Miami-Dade NOAs
   read by the AI with a page + quote per field and checked by a person
   (`/permits/products`), linked to roofing materials and to permits (the
   engineer's required pressures typed in), advisory flags (HVHZ, pressure,
   expiry, unchecked, not in the documents), the document copied among the
   permit's files, expiry tasks from the existing permit-aging cron. **Stage 5
   (preflight) built + dev-QA'd 2026-10-18, deployed 2026-10-19 as
   `2359e54` with Stage 6**:
   migration `20261105120000_permit_preflight`; versioned rules over the
   record, an optional AI look (warnings only, not scored), readiness score,
   findings → tasks closed by the next passing run, report PDF, "Mark ready to
   submit" (zero blockers, or ADMIN / MANAGER override with a reason; cleared
   by freezing), the job's permit-documents step ticks itself. **Stage 6
   (lessons + metrics) built + dev-QA'd 2026-10-18, deployed 2026-10-19 as
   `2359e54`** (BUILD_ID `C7dZ4cfftPCjy5oiFvv9z`, both migrations applied,
   smoke 307 ×2, journal clean, backup `postgres-2026-10-19-010939.dump`): migration `20261106120000_permit_lessons`; accepted corrections
   → scrubbed, AI-worded PROPOSED lessons grouped by jurisdiction × type ×
   category × target; Admin → Permits → Knowledge decides them; approved
   lessons show at preflight; Permit Center metrics strip; attention rows
   `permit-corrections` / `permit-resubmit-due`. **All seven stages built.**
   **Document assistant built + dev-QA'd 2026-10-19, deployed 2026-10-19 as
   `64e3c4d`** (BUILD_ID `TLxVz6KDW9VoRZKRR74nA`, migration applied, smoke 307
   ×2, journal clean, backup `postgres-2026-10-19-015915.dump`; the droplet
   reaches the Town of Palm Beach site). **Fillable forms from found
   documents + printed / scanned forms filled — built + dev-QA'd 2026-10-19,
   deployed 2026-10-19 as `391efe1`** (BUILD_ID `U5IBZ_zSrPTNhnC0nmT4x`, no
   migration, smoke 307 ×2, journal clean, backup
   `postgres-2026-10-19-023754.dump`; the page worker renders on the droplet
   as `knuco`): "Make a fillable form" on an
   assistant item; flat forms' blanks found from the rendered pixels
   (`flat/detect.ts`, own worker process), named by the AI by number, filled
   by printing on the page. Assistant details: migration `20261107120000_permit_assistant`; drop many
   documents on a permit → the AI reads each, opens the links worth opening
   (one hop from a person's document; then only the department's site and the
   approval sites; 40 pages; a guarded fetcher), looks on the department's
   website, proposes a type per document against the checklist; a person
   accepts. Open rulings in the design doc §19. Notes:
   [features/permit-intelligence.md](docs/project-memory/features/permit-intelligence.md).
0000000000. 🔴 **GC Partnerships (Business Development)** — plan approved
   2026-10-13 (`~/.claude/plans/noble-forging-noodle.md`); design in
   `CAREYOS_GC_PARTNERSHIPS_IMPLEMENTATION_PLAN.md`, build-ready spec in
   `CAREYOS_GC_PARTNERSHIPS_BUILD_SPECIFICATIONS.md` (repo root). Four stages:
   1 accounts / contacts / interactions / follow-up tasks, 2 qualifications +
   the KNU document vault, 3 bid invitations as `GC_BID` leads → award →
   progress-billed job, 4 health score + scorecard + analytics. **Stage 1
   built + dev-QA'd 2026-10-13 on `partners-s1` (worktree), fast-forwarded to
   `main` and deployed 2026-10-13 as `b8af730`** (BUILD_ID
   `teFcePwxp9jUwltnPFRYK`, migration `20261023120000_partners_core` applied
   (89), smoke 307 ×2, journal clean, backup `postgres-2026-10-13-154729.dump`;
   seeded on prod, Coastal Choice backfilled, `partner-follow-ups.sh` on the
   crontab at `55 11 * * 1-5`, first run `raised 0`). **Stage 2
   (qualifications + the KNU document vault + expiry alerts + RESTRICTED
   access) built + dev-QA'd 2026-10-13 on `partners-s2`, fast-forwarded to
   `main` and deployed 2026-10-13 as `65cc01e`** (BUILD_ID
   `k_Dv0RZV2Xs5ihU2PF5fB`, migration `20261024120000_partners_qualifications`
   applied (90), smoke 307 ×2, journal clean, backup
   `postgres-2026-10-13-170744.dump`; seeded (16 document types, default
   checklist filled), `company-document-alerts.sh` on the crontab at
   `56 11 * * 1-5`, first run `raised 0`). **Stage 3 (bids: invitations on
   `GC_BID` leads, go / no-go score, submissions, outcomes, award →
   progress-billed job) built + dev-QA'd 2026-10-13 on `partners-s3`, deployed
   2026-10-13 as `d2afb6f`** (BUILD_ID `Hb0xqBxUlMkJKftTLAj88`, migration
   `20261025120000_partners_bids` applied (91), five CHECKs verified, smoke 307
   ×2, journal clean, backup `postgres-2026-10-13-182830.dump`; JOB-00009 recorded as
   BID-00001, awarded $832,500); no seed, no cron; fill Admin → Business Development → Bid scoring
   and run `scripts/backfill-partners-bid-job00009.ts`. **Stage 4 (relationship health, account scorecard,
   partner analytics, weights editor, dashboard strip) built + dev-QA'd
   2026-10-13 on `partners-s4`, deployed 2026-10-13 as `68bfb2f`** (BUILD_ID
   `kRdp4GOoGpB0OBh-SM6ol`, migration `20261026120000_partners_scorecard`
   applied (92), CHECK present, smoke 307 ×2, journal clean, backup
   `postgres-2026-10-13-185953.dump`); no seed, no cron. **The four-stage
   plan is on prod.** **Phase 5 (bid invitations by email → Bid intake
   queue) built + dev-QA'd 2026-10-13 on `partners-s5`, deployed 2026-10-13
   as `f4f39c3`** (BUILD_ID `fq9IG_D9irXnQMsxcg7XR`, migration applied (93),
   journal clean, backup `postgres-2026-10-13-222029.dump`): migration `20261027120000_partners_bid_intake`
   (`BidIntake`), pure `itb-parse.ts`, `itb-intake.ts`, paste on
   `/partners/intake`, MailerSend inbound webhook (off until
   `MAILERSEND_INBOUND_SECRET` is set and a route is created), Outlook poller
   hand-off. **Phase 8a (prequalification package: one zip of the vault
   documents a GC's checklist asks for) built + dev-QA'd 2026-10-13 on
   `partners-s8`, fast-forwarded to `main`, not deployed**; no migration, new
   direct dependency `fflate`. Stage 2 facts:
   migration `20261024120000_partners_qualifications` (`CompanyDocumentType`,
   `CompanyDocument` with own storage + encryption at rest for RESTRICTED,
   `Qualification`, `QualificationRequirement`, `PartnerSettings` vault owner +
   default checklist, `User.canViewRestrictedDocuments`), pure
   `qualification-state` / `document-alerts` / `vault-access`, services,
   routes, the vault page, the Qualification and Documents tabs,
   `/partners/qualifications`, attention rows, calendar overlays, the cron.
   **Deploy carries the migration**; seed again after it. Stage 1 facts:
   migration `20261023120000_partners_core` (`Organization`,
   `OrganizationTrade`, `Contact`, `Interaction`, `PartnerStageHistory`,
   `PartnerSettings`; `Lead.kind` / `organizationId` / `contactId`;
   `Task.organizationId`; CHECKs + one-primary partial index), pure
   `src/lib/partners/*`, the fence on six customer-only lead surfaces, the
   follow-up cron, the Business Development sidebar section, ⌘K groups,
   `/partners`, `/partners/[id]`, `/partners/contacts`, `/admin/partners`,
   seed, backfill script. Rulings taken as recommended (6-stage enum;
   SALES_REP manages; bids-as-leads) — Richard can still change them. Notes:
   [features/partners.md](docs/project-memory/features/partners.md).
000000000. 🔴 **AI plan takeoff → supplier RFQ (roofing + plumbing)** — plan
   approved 2026-10-08 (`~/.claude/plans/harmonic-churning-stearns.md`), design
   in `CAREYOS_PLAN_TAKEOFF_STAGE1_DESIGN.md`. **M0 proofs of concept done
   2026-10-08** (canvas under the service sandbox ✓, geometry fidelity ✓ with a
   chain merge, AI id-picking ✓ for pipes and roof, timing ✓ with a child
   process per tick) — notes in
   [features/plan-takeoff.md](docs/project-memory/features/plan-takeoff.md).
   **M1 (plan sets, sheet index, viewer) deployed 2026-10-08 as `d2fa4d0`**
   (BUILD_ID `jZogc4PvvnFSYj7gxiyS0`, migration `20261020120000_plan_sets`
   applied, smoke 307 ×2, journal clean, backup
   `postgres-2026-10-09-034839.dump`; nginx body size on `/api/plan-sets/` and
   the `takeoff-tick.sh` cron installed). **M2 (calibration + manual tools)
   deployed 2026-10-09 as `c18e8f5`** (BUILD_ID `JyubG__VqAsj4BvpIQTie`, migration
   `20261021120000_takeoffs_measurements` applied, smoke 307 ×2, journal
   clean, backup `postgres-2026-10-09-042406.dump`). **M3 (AI roofing) built
   2026-10-14, moved onto the shared AI layer and merged to `main`
   2026-10-19, deployed 2026-10-19 as `166a362`** (BUILD_ID
   `U90VFCrDknZ6GfCb-zWQr`, migration `20261108120000_takeoff_analyze_jobs`
   applied, smoke 307 ×2, journal clean, backup
   `postgres-2026-10-19-134400.dump`;
   `PlanAiCall` dropped; calls are `AiCall` rows with subject `takeoff`).
   Richard's click-through: a lead → Plan takeoff → upload the 3310 set
   → Start roofing takeoff → Auto calibrate A-10 → draw the roof outline → the
   count tool on the drains. Next: **M3** (AI-assisted roofing; needs the prod
   `ANTHROPIC_API_KEY`). Test set: `3310 NE 37 st/` at the repo root (git-ignored).
00000000. 🔴 **Roofing estimator → CRM** — plan approved 2026-10-03
   (https://claude.ai/code/artifact/8b95fb53-2275-421e-a4ed-842fa7919005):
   native module, engine as a pure library in `src/lib/roofing`. **P0 Stage A
   built + dev-QA'd 2026-10-03 on `roofing-p0`, fast-forwarded to `main`,
   deployed 2026-10-03 as `79e4e19`** (BUILD_ID `HfCtieXEwvKgJaManWLme`,
   migration applied, smoke 307 ×2, journal clean, backup
   `postgres-2026-10-03-230418.dump`): parser + takeoff engine ported with their tests, Roofr's
   recommended waste read from page positions, `RoofMeasurement` (migration
   `20261018120000_roof_measurements`) with upload / correct / review on the
   lead's Roofr tab and the job's Estimates tab, and a signed roofing estimate
   now feeds the job's estimated cost. **Stage B (takeoff rules + price book)
   built + dev-QA'd 2026-10-03 on `roofing-price-book`, fast-forwarded to
   `main`, deployed 2026-10-03 as `ac2a1d8`** (BUILD_ID
   `Sm73Z7jwQy_iEWRSA7K2T`, migration applied, smoke 307 ×2, journal clean,
   backup `postgres-2026-10-03-232527.dump`): `RoofRule` / `RoofMaterialItem` /
   `RoofMaterialPrice` (migration `20261019120000_roof_price_book`), pure
   `engine/resolve.ts`, `/admin/roofing` (Price book · Takeoff rules · Try a
   takeoff). **Stage C (the import script) built + dev-QA'd 2026-10-03 on
   `roofing-import`, fast-forwarded to `main`, not deployed, not run on
   prod**: pure `import-plan.ts` + `scripts/import-roof-estimator-2026-10.ts`
   (dry run by default). No migration. The estimator itself is
   untouched and now under local git (`~/roofestimator`, `e0adbff`). Notes:
   [features/roofing.md](docs/project-memory/features/roofing.md).
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
0. ✅ **Audit initiative 7: job documents and photos — all three stages on prod** — plan
   approved 2026-10-03 (`~/.claude/plans/encapsulated-frolicking-possum.md`).
   **Stage 1 (files belong to the job, preview, missing state) built +
   dev-QA'd 2026-10-03 on `job-files`, fast-forwarded to `main`, deployed
   2026-10-03 as `d18d054`** (BUILD_ID `16_91QFu9eTLm0-ZEhAiC`, migration
   applied, backfill 37 of 92 files given a job, smoke 307 ×2, journal clean,
   backup `postgres-2026-10-03-201622.dump`): `files.job_id` + backfill (migration
   `20261016120000_file_job_link`), `lib/files/scope.ts` / `list.ts`,
   job-scoped list, rename / move / "Upload again" routes, `FilePreviewDialog`,
   Files panel rebuilt, generated documents undeletable. **Stage 2 (one photo
   gallery, two sources) built + dev-QA'd 2026-10-03 on `job-gallery`,
   fast-forwarded to `main`, deployed 2026-10-03 inside `a03c698`**: pure `lib/photos/gallery.ts`,
   `GET /api/jobs/[id]/gallery`, `POST /api/photos/[id]/replace`, gallery
   rebuilt, photos downscaled on every upload path. No migration. **Stage 3
   (receipts on expenses) built + dev-QA'd 2026-10-03 on `expense-receipts`,
   fast-forwarded to `main`, deployed 2026-10-03 as `a03c698`** (BUILD_ID
   `SBnOF_n7Dfa0xpp-w6tyi`, migration applied, smoke 307 ×2, journal clean,
   backup `postgres-2026-10-03-203928.dump`): `files.expense_id` +
   `FileCategory.RECEIPT` (migration `20261017120000_expense_receipts`),
   `expenseId` on the upload route, receipts on the expense list, attach /
   count / preview in the expenses panel. **All three stages of initiative 7 —
   and the audit's whole MVP roadmap — are on prod**; what remains is
   Richard's click-through.
   Notes: [features/job-files.md](docs/project-memory/features/job-files.md).
0. 🔴 **Audit initiative 6: vendors, compliance, commitments** — three
   stages, plan approved 2026-10-03
   (`~/.claude/plans/encapsulated-frolicking-possum.md`). **Stage 1 (vendor
   record + payee matching) built + dev-QA'd 2026-10-03 on `vendors`,
   fast-forwarded to `main`, deployed 2026-10-03 as `ec88e96`** (BUILD_ID
   `5x6HE43-USWkCl1cgP0Zn`, migration applied, smoke 307 ×2, journal clean,
   backup `postgres-2026-10-03-184726.dump`): `Vendor` / `VendorAlias` +
   `vendor_id` on expenses, crews and labor contracts (migration
   `20261013120000_vendors`), `src/lib/vendors/*`, `/vendors` (Directory |
   Unmatched) and `/vendors/[id]`, matching on every expense write, ⌘K group,
   backfill script. The directory starts empty — Richard builds it from
   Vendors → Unmatched. **Stage 2 (compliance
   documents + expiry alerts) built + dev-QA'd 2026-10-03 on
   `vendor-compliance`, fast-forwarded to `main`, deployed 2026-10-03 as
   `45899b2`** (BUILD_ID `DcJXs_PTMUJdAIU9AJO2p`, migration applied, smoke
   307 ×2, journal clean, backup `postgres-2026-10-03-192156.dump`; cron
   wrapper installed at `50 11 * * 1-5`, first run 0 raised):
   `VendorDocument` / `VendorSettings` / `tasks.vendor_id` (migration
   `20261014120000_vendor_documents`), pure `compliance.ts` + `alerts.ts`,
   `alert-run.ts`, document and settings routes, `POST
   /api/cron/vendor-compliance`, Compliance card on the vendor page, warning
   on labor contracts, dashboard row, calendar overlay. **Stage 3
   (commitments) built + dev-QA'd 2026-10-03 on `commitments`, fast-forwarded
   to `main`, deployed 2026-10-03 as `78bdc4c`** (BUILD_ID
   `xqCVJVDrq3De9dtsbMCfy`, migration applied, smoke 307 ×2, journal clean,
   backup `postgres-2026-10-03-194329.dump`): `Commitment` + `job_expenses.commitment_id`
   (migration `20261015120000_commitments`), pure `commitments.ts`,
   `commitment-service.ts`, `commitmentsOpen` in the one cost calculation,
   Job → Money → Commitments, auto-link on expense write, budget line and
   vendor page. **All three stages of initiative 6 are on prod**; what
   remains is Richard building the directory under Vendors → Unmatched and
   his click-through.
   Notes: [features/vendors.md](docs/project-memory/features/vendors.md).
0. 🔴 **Audit initiative 5: attention dashboard** — built + dev-QA'd
   2026-10-03 on `attention-dashboard`, fast-forwarded to `main`, **deployed
   2026-10-03 as `9b75536`** (BUILD_ID `PmFnvrNoVx2_HApQwqCDx`, no migration,
   smoke 307 ×2, journal clean, backup `postgres-2026-10-03-151438.dump`). The dashboard opens on "Needs attention" (12 rows by role, each
   opening the list it was counted from: `/attention/[key]`); sales tiles and
   charts moved to the bottom. No migration. Digest delivery stays off — SPF
   is still deferred (§5). Notes:
   [features/attention-dashboard.md](docs/project-memory/features/attention-dashboard.md).
0. 🔴 **Audit initiative 4: permits and inspections as one record** —
   Stages 1–3 built + dev-QA'd 2026-10-03 on `permits-one-record`,
   fast-forwarded to `main`, **deployed 2026-10-03 as `9cd2aba`** (BUILD_ID
   `Jz-SkZNZkAW6myqxzsKMy`, migration
   `20261012120000_permit_inspection_task_link` applied). Stage 3 after
   Richard's rulings: permit follow-ups are tasks raised by the two crons, no
   customer mail on permit events, the permit fee is shown from the job's
   costs and never created. Cron wrappers installed (`40 11` / `45 11 * * 1-5`),
   the 18 follow-up rules switched off and 4 queued executions cancelled.
   What remains is Richard's click-through.
   Notes: [features/permits.md](docs/project-memory/features/permits.md).
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

### 2026-10-19 — Audit roadmap Stage C: owner command center (built + dev-QA'd on `command-center`, not deployed)

No migration. Four attention rows (`lib/attention/rows.ts` + `load.ts`, count and list
from one rule each): **Leads never contacted** (open customer leads > 24 h with no
contact logged; sales roles + marketing), **Estimates awaiting an answer** (sectioned
estimates SENT on open leads), **Delayed jobs** (the job page's `deriveJobHealth`
"delayed" over batched facts: failed-inspection corrections, blocked tasks, a task 7+
days overdue, an expired permit), **Jobs over budget** (the one cost calculation's
`overBudget`; office roles + READ_ONLY). Owner strip on the dashboard
(`loadOwnerSummary`, `GET /api/attention/owner`, `canViewCompanyFinancials`): new leads
today, never contacted, pipeline (Σ typed value of open customer leads), estimates
out, active jobs, expected gross profit (Σ projected profit of open billable jobs with
an expected cost; the rest counted, not guessed). Gate: typecheck clean, lint 5/22,
1919 tests, build clean. Dev QA: each new row's count = its list (1 / 1 / 4 / 1),
owner summary read back, dashboard in headless Chromium at 1440 / 400 px (no errors, no
overflow), SALES_REP: strip refused (403) and hidden, over-budget refused, the three
other rows shown. Dev DB restored. "Who is behind" (overdue by person) is Stage D.

### 2026-10-19 — Audit roadmap Stage B: the estimate drives the job (deployed `c1c6539`)

Migration `20261109120000_estimate_drives_job` (additive: `jobs.estimated_cost_snapshot`,
`source_estimate_id`, `source_roof_estimate_id`, `change_orders.material_cost`,
`budget_lines.source`). Pure `lib/estimates/job-from-estimate.ts` (price, cost and
budget lines per section at cost from either estimate kind, chosen options counted;
`preselectWonEstimate` = accepted, else latest sent; `autoWonEstimate` = exactly one
accepted) + `job-from-estimate-load.ts`. `createJobFromLead` takes `fromEstimate`
(undefined = the auto rule for the board / bulk; null = the lead's value, as before)
and `estimatedCost` (a caller's frozen cost wins): price, 50% deposit, the frozen cost
and the source on the job; budget lines from the estimate when the job has none; the
estimate marked Accepted. The stage route takes `estimate` and returns `jobError`
instead of swallowing a failed job; `GET /api/leads/[id]/won-estimates`; the Won
confirmation on the lead page carries `WonEstimatePicker`. Signing freezes the cost of
what was signed (chosen options included) and refreshes estimate-made budget lines
that carry no allocations. An award takes the latest submission's cost snapshot and
estimate. The cost summary reads the frozen cost before the live signed-estimate cost
and adds approved change orders' crew + other cost (`materialCost`, new on the CO
form). Budget lines show "from estimate". Gate: typecheck clean, lint 5/22, 1919 tests
(+6), build clean. Dev QA: API 14/14 (a 250 / 200 estimate → JOB at $250, deposit
$125, baseline $200, one "Walls" budget line, estimate Accepted and then 409 on edit,
a CO with $100 crew + $150 other cost → expected cost $450; another lead's estimate
refused and reported; no estimate → the lead's $12,000), and the Won dialog in
headless Chromium at 1280 / 400 px (sent estimate preselected, roofing estimates
offered, Move to Won → $250 / $200). Dev DB restored. Richard pushed and deployed from `!` (exit 0): BUILD_ID
`IpNJHFIDtpmxU4_QSV4JA` → `bvEDAv3KnV-JYcUXuW0Zu`, migration applied (5 columns
present), journal clean, backup `postgres-2026-10-19-154923.dump`.

### 2026-10-19 — Audit roadmap Stage A: security + money-integrity repairs (deployed `53871b5`)

Richard took the audit's first four 90-day items, each deployed after QA;
rulings: job money = office roles + READ_ONLY + the job's PM in full, sales
reps the price only, crew leads and marketing none; the Won dialog will pick
the estimate. **0.1** `web-fetch.ts`: IPv6 read group by group (`v6Groups`),
every IPv4-carrying IPv6 form refused (mapped, compatible, NAT64, 6to4,
Teredo), bare-IP links refused. **0.2** `jobMoneyView` + `guardJobMoney`
(`lib/money/access.ts`, `lib/access/records.ts`) on the job money GETs
(cost: budget, cost-summary, commitments, expenses, labor contracts + their
tasks / documents, labor CO documents; price: invoices, payments, change
orders, billing, invoice PDF, payment receipt); `redactJobMoney` on the job
GET and `redactOverview` on the overview; the job page hides cost panels /
the Money group by `moneyView`; contact lookup lead-writers + own scope;
canvassing + door-knock routes guarded (`guardCanvassing`,
`guardDoorKnockRoute`, rep list scoped the same); field-assignments, nurture
card, reviews, intake, response times, follow-up rules read guarded;
referrals / personnel / field-logs pages show the refusal instead of
crashing; the Crews tab's personnel section hides itself when refused (it
crashed for a rep). New `src/app/api/route-guards.test.ts` fails on any
session-only handler not on its reviewed list. **0.3** approved-expense
money fields → money roles only, every expense edit audited; a sent / paid
invoice's amount fixed, a paid invoice not voided, invoice edits audited;
change-order decisions claim the row in their transaction
(`claimForDecision`, a lost race → `already_decided`, nothing billed) and
record the deciding person; budget import keeps matched lines and their
allocations (`lib/budget/import-plan.ts`), audited; labor contract edit /
delete audited; an ACCEPTED estimate is refused on save (409) and offers
**Revise** (a new draft copy). Gate: typecheck clean, lint 5/22, 1913 tests
(+16), build clean. Dev QA: API 39/39 as ADMIN / SALES_REP / CREW_LEAD /
MARKETING (two misses in the first run were the script's own payload and a
job whose PM was the QA user); headless Chromium at 1440 / 400 px: admin full,
rep price-only panels, marketing no Money tab; found + fixed the Crews crash.
No migration. Dev DB restored. Richard pushed and deployed from `!` (background, exit 0):
BUILD_ID `U90VFCrDknZ6GfCb-zWQr` → `IpNJHFIDtpmxU4_QSV4JA`, no pending migrations,
smoke 307 ×2, journal clean, backup `postgres-2026-10-19-152720.dump`; the deployed
`urlProblem` run on the droplet refuses `[::ffff:169.254.169.254]` and a bare IP.

### 2026-10-19 — Rulings

(1) Confirming a correction notice and freezing a submission: office roles +
the permit's coordinator (as built — `canSubmitPermit`). (2) Logging a
contact does **not** move a lead's next follow-up date. (3) `/api/messaging`
left as it is for now. (4) Job delete stays strict. (5) Roofing: price book
and rules stay ADMIN / MANAGER; cost and margin on a job's roofing estimate
(P1) show to ADMIN, MANAGER and that job's project manager.

### 2026-10-19 — Plan takeoff M3 on the shared AI layer (deployed `166a362`)

"complete plan takeoff M3 and then do a dry run on prod. then delete
duplicate SPF record". `main` merged into `takeoff-m3` (CLAUDE.md and one
schema conflict, `main`'s side kept); M3's own call layer
(`src/lib/takeoff/ai/{client,calls,hash,pricing}.ts`, `PlanAiCall`, migration
`20261028120000_plan_ai_calls`) replaced by `runAiCall` with subject
`takeoff`; the drawings' text framed with `untrustedDocument` (prompt
versions `-2`); new migration `20261108120000_takeoff_analyze_jobs`
(`plan_jobs.takeoff_id` only); `TAKEOFF_AI_*` env gone. Gate: typecheck
clean, lint 5/22, 1897 tests, build clean. Dev QA: real run on A-10 $0.34
(same answer as 10-14), repeat cached at $0, headless 1440 / 400 px clean.
Details: [features/plan-takeoff.md](docs/project-memory/features/plan-takeoff.md).
Richard pushed and deployed from `!` (background, 316 s, exit 0): BUILD_ID
`U5IBZ_zSrPTNhnC0nmT4x` → `U90VFCrDknZ6GfCb-zWQr`, the migration applied,
`plan_jobs.takeoff_id` present, smoke 307 ×2, journal clean, backup
`postgres-2026-10-19-134400.dump`. Roofing import dry run on prod the same
day (nothing written): 40 materials + prices to create, 0 rule changes, 5
Roofr reports to import (1791 Pierce Drive twice — check before `--yes`), 1
already here, 6 held. Not applied.

### 2026-10-19 — From found documents to filled forms (deployed `391efe1`)

"what happens after docs are identified? are they filled out" → "do both".
No migration. (1) **Make a fillable form** on a document the assistant found:
a form template for the permit's jurisdiction, linked back by the file's
hash. (2) **Flat forms**: `createTemplate` accepts them; `flat/form-worker.mjs`
renders pages in its own process, pure `flat/detect.ts` finds underlines,
cell bands and tick boxes from the pixels, prompt `flat_form_map` (Opus, the
page with numbered boxes) names them and maps them with the shared
`MAPPING_RULES`; the blanks become ordinary fields `p<page>-<n>`;
`fillFlatForm` prints values on the page (page content wrapped in q/Q first
— a scan's OCR layer leaves text invisible otherwise), X in tick boxes,
never signatures, a value too long reported not cut; preview PDF with the
fields outlined. Gate: typecheck clean, lint 5/22, 1872 tests (+7), build
clean. Dev QA on the town's real NOC, 8-page application and scanned
affidavit: $0.66 once, 88 s, 203 + 21 blanks found and labelled, values on
their lines in Chrome's PDF viewer, the re-roof boxes ticked; API 21/21,
headless 12/12, SALES_REP 3/3. Details:
[features/permit-intelligence.md](docs/project-memory/features/permit-intelligence.md).
Richard pushed and deployed from `!` (background, 319 s, exit 0): BUILD_ID
`TLxVz6KDW9VoRZKRR74nA` → `U5IBZ_zSrPTNhnC0nmT4x`, no pending migrations,
smoke 307 ×2, journal clean, backup `postgres-2026-10-19-023754.dump`. The
form worker run on the droplet as `knuco` rendered the town's affidavit (2
pages, PNG + grayscale), so `@napi-rs/canvas` and pdf.js's standard fonts are
in place.

### 2026-10-19 — Permit document assistant (deployed `64e3c4d`)

"for the permits i want to be able to upload multiple documents and have the
AI go through the documents, click links and assist with putting together
the relavent documents". Plan mode: all three kinds of link; the AI
proposes, a person confirms (`~/.claude/plans/floofy-questing-lark.md`).
Migration `20261107120000_permit_assistant` (runs, items, every fetch;
jurisdiction website + allowed sites). New `web-fetch.ts` (the CRM's first
outgoing-request guard: connect-time address check, redirects re-checked,
robots.txt, size / time caps), `links.ts` (PDF annotations, printed URLs,
page links, `mayFollow`), `assist-plan.ts`, `assist-run.ts`, prompt
`assist_read` (Sonnet; picks links by number only), three routes, the
Documents tab's Document assistant, the jurisdiction form's website fields.
Gate: typecheck clean, lint 5/22, 1865 tests (+18), build clean. Dev QA on
the real Town of Palm Beach site: 111 s, $0.54, 14 pages, the town's permit
application packet / NOC form / revision form proposed, no private request,
API 30/30, SALES_REP 4/4, headless Chromium 18/18. Details:
[features/permit-intelligence.md](docs/project-memory/features/permit-intelligence.md).
Richard pushed and deployed from `!` (background, 317 s, exit 0): BUILD_ID
`C7dZ4cfftPCjy5oiFvv9z` → `TLxVz6KDW9VoRZKRR74nA`, migration
`20261107120000_permit_assistant` applied (0 runs, both jurisdiction columns
present), smoke 307 ×2, journal clean, backup
`postgres-2026-10-19-015915.dump`. Next: set each department's website.

### 2026-10-19 — Stages 5 + 6 deployed (`2359e54`)

Richard pushed and deployed from `!` (background, 314 s, exit 0): BUILD_ID
`6KAPwvK3Td9KNoioZBmQr` → `C7dZ4cfftPCjy5oiFvv9z`, migrations
`20261105120000_permit_preflight` and `20261106120000_permit_lessons` applied
(both finished; `permit_preflight_runs` empty, the lesson columns present),
smoke 307 ×2, journal clean, backup `postgres-2026-10-19-010939.dump`. No
seed, no cron. **All seven Permit Intelligence stages are on prod.**

### 2026-10-18 — AI Permit Intelligence, Stage 6: lessons + metrics (deployed `2359e54`)

"continue to stage 6". Migration `20261106120000_permit_lessons` (lesson
columns on `permit_knowledge`). Pure `lessons.ts` (scrub, group, retrieve,
preflight findings) and `metrics.ts`; `knowledge.ts` (`proposeLessonsFor` on
the department's next answer — Haiku rewrites the scrubbed comments;
`decideLesson`; `lessonsForPermit`); Admin → Permits → Knowledge; Permit
Center metrics strip with tiles that filter; attention rows
`permit-corrections`, `permit-resubmit-due`. Found in QA: the first prompt
proposed a document check for every lesson (a colour sample as a product
approval) — the check is now proposed only for a document never submitted,
and a lesson whose check passes still shows as a note. Gate: typecheck
clean, lint 5/22, 1847 tests (+8), build clean. Dev QA: API 45/45, roles 5/5
(one miss was my expectation — the rep is on the job), headless Chromium
19/19. AI: $0.0004 for three lessons. Dev DB restored. Details:
[features/permit-intelligence.md](docs/project-memory/features/permit-intelligence.md).
**Deploy carries the migration.**

### 2026-10-18 — AI Permit Intelligence, Stage 5: preflight (deployed `2359e54`)

"continue to stage 5". Migration `20261105120000_permit_preflight`
(`PermitPreflightRun`; the ready mark on `JobPermit`). Pure `preflight.ts`
(rules `pf-1`: jurisdiction, requirements, forms, signatures, licence /
qualifier, party licences, parcel, value, product flags, open corrections,
response letter, sealed documents listed; score from the rules only), prompt
`preflight_review` (a summary with refs, no contact details, the rule findings
passed as "already reported"); service `preflight-run.ts` (runs, tasks from
findings closed by the next passing run, `markReady` with an ADMIN / MANAGER
override and a reason, cleared on freeze, report PDF); `gates.ts` held facts
`permitApplicationFinal` and `permitReady`; the editable form copy left out of
the default package. UI: the permit's Preflight tab, a "Ready to submit"
chip, a note in the freeze dialog. `typecheck` given a 6 GB heap too (the Mac
ran out). Gate: typecheck clean, lint 5/22, 1839 tests (+15), build clean.
Dev QA: API 23 + 2 + 6 (two of my first checks miscounted, the code was
right), the AI look $0.03–0.04 a run, headless Chromium 18/18. Fixed in QA:
AI points restating the rules and moving the score, "cycle 0", the editable
copy in the package. Dev DB restored. Details:
[features/permit-intelligence.md](docs/project-memory/features/permit-intelligence.md).
**Deploy carries the migration.**

### 2026-10-18 — Stages 2–4 deployed (`da551cc`) after a first attempt ran out of heap

Richard's `!` deploy applied the three migrations (`20261102…`, `20261103…`,
`20261104…`) and then `next build` died in "Running TypeScript" with
`JavaScript heap out of memory` at Node's 4 GB default (exit 14). The old
Stage 1 process kept serving from memory (307 local and public); `.next` had
no `BUILD_ID`, so a restart would have failed. The schema has grown enough
that the type-check needs more than 4 GB on the droplet (the Mac has more
headroom). Fix: `"build": "NODE_OPTIONS=--max-old-space-size=6144 next build"`
in `package.json` (the droplet has ~9.7 GB free); verified locally. Richard
re-ran the deploy from `!` (background, 312 s, exit 0): BUILD_ID → `6KAPwvK3Td9KNoioZBmQr`,
`.deploy-sha` `da551cc`, the three migrations recorded, smoke 307 (local and
public, `/permits/products`, `/permits/library`, `/admin/permits`), zero
journal errors, backup `postgres-2026-10-19-002128.dump`; `files.search_vector`
generated (101 files indexed by name), `pdf-lib` installed, the permit-aging
cron run by hand → `approvalsExpiring: 0`, 200. **Lesson:
a deploy that fails at the build has already applied its migrations — keep
every migration additive so the running old code survives it.**

### 2026-10-18 — AI Permit Intelligence, Stage 4: product approvals (built + dev-QA'd, on `main`, not deployed)

"continue to stage 4". Public samples: Miami-Dade NOA 26-0504.06 and
Florida evaluation reports FL 11842.3 R9 and FL5259-R38 (a Florida report
states no expiry). Migration `20261104120000_product_approvals`
(`ProductApproval` with its own stored document and per-field evidence,
`ProductApprovalMaterial`, `PermitProduct` with the engineer's required
pressures and the document's copy on the permit). Pure `approvals-plan.ts`
(answer schema, `approvalFromExtraction`, `checkProduct` advisory flags,
`approvalAlert`); prompt `approval_extract` (Opus 5.5, never infer expiry /
pressure / HVHZ); service `approvals.ts` (read in `after()`, check, search incl.
a model name in part, products on a permit, expiry tasks raised from the
permit-aging cron and settled on change). UI: Permits → Product approvals,
the approval page (PDF beside the fields with "p. n: quote"), the permit's
Products tab. Gate: typecheck clean, lint 5/22, 1824 tests (+16), build clean.
Dev QA ($0.79 in AI): NOA read in 25 s — dates, HVHZ, and the −67.5 psf
underlayment-only uplift kept out of the design pressure; FL reports with no
invented expiry; Polyglass 18 models / 52 systems; API 39/39; SALES_REP 6/6;
headless Chromium 31/31 at 1280 / 400 px; the PDF frame checked in full
Chromium. Fixed in QA: model search matched whole names only. Dev DB
restored, QA files removed. Not built: slope / deck compatibility (no
structured roof slope in the CRM), online verification (decision 9).
**Deploy carries the migration.** Details:
[features/permit-intelligence.md](docs/project-memory/features/permit-intelligence.md).

### 2026-10-18 — AI Permit Intelligence, Stage 3: form filling (built + dev-QA'd on `permit-corrections`, on `main`, not deployed)

"continue to stage 3". No sample forms in the repo, so the public ones were
checked first: Palm Beach County cities use the *Universal County-Wide /
Municipal Building Permit Application* (Jan 2024, fillable, 132 fields, the
PCN as 17 one-character boxes); Boynton Beach's NOC is fillable, its re-roof
affidavit a flat scan; the City of Miami has no PDF application (iBuild /
ePlan). Migration `20261103120000_permit_forms` (templates per exact file —
jurisdiction or county, versioned; field maps; fills; `leads.parcel_number` +
`legal_description`), `pdf-lib` 1.17.1 (MIT). Pure `data-dictionary.ts` (49
keys, protected licence / qualifier keys from records only, owner conflict),
`field-fill.ts` (key / literal / when, transforms incl. `char:n` and `map:`,
statuses, `acceptMapping` — the AI's fixed values only as a choice field's own
option — and `nearestLabel`), `form-pdf.ts` (inventory with labels, fill,
flatten, XFA / flat refused), prompt `form_map` (no job data). Services
`forms.ts` (upload, AI mapping in `after()`, hand edits kept, publish retires
the older version, edit = new version) and `fills.ts` (values re-read from the
records on open, overrides, editable + flattened PDFs as
`completed_application`, finalise refused while records disagree). UI: Admin →
Permits → Forms + the template editor (mapping dialog, Try on a permit),
the permit's Forms tab (needs-a-person view, conflict picks, parcel number
saved on the property). Fixed on the way: `updateLeadSchema` kept the
create defaults (a partial PATCH reset state / property type / three flags)
and cleared the email when none was sent; wrapped tab lists overlapped the
content (permit, lead, partner pages). Gate: typecheck clean, lint 5/22, 1808
tests (+27), build clean. Dev QA: the real universal form mapped in 61 s for
$0.20 — 48 of 132 fields, PCN boxes in order, trade and contractor choices,
licence / qualifier keys, every signature / notary / fee / office field left
for a person, one wrong call ("Permit Type" in the office header) cleared in
the editor; API 52/52 + SALES_REP 8/8; the filled PDF read back with every
value in its box; headless Chromium 28/28 at 1280 / 400 px. Dev DB restored,
QA files removed. Details:
[features/permit-intelligence.md](docs/project-memory/features/permit-intelligence.md).
**Deploy carries the migration** and the new `pdf-lib` dependency.

### 2026-10-18 — AI Permit Intelligence, Stage 2: corrections (built + dev-QA'd on `permit-corrections`, on `main`, not deployed)

"go to stage 2", after finishing Stage 1's deploy (below). Migration
`20261102120000_permit_corrections`: `PermitCorrectionNotice`,
`PermitCorrectionItem`, `PermitCorrectionItemFile`, `PermitMessage`;
`files.extracted_text` + `files.search_vector` (generated tsvector, GIN —
hand-written; Prisma's diff then shows a `DROP DEFAULT` to leave out). Pure
`corrections-plan.ts` (answer schema, clamped mapping, party match, stated
deadline, task titles, outcomes, letter lines, stale reading); prompts
`correction_extract` (Opus 5.5, the PDF itself as a document block — scans
included), `correction_email` (Sonnet 5.5), `file_classify` (Haiku 5.5);
services `corrections.ts`, `messages.ts`, `response-letter.ts`, `library.ts`;
the reading runs in `after()` (no queue change — that stays with takeoff-m3)
and a cut-off reading restarts on the next page load. Confirming = office
roles + the coordinator (proposed); sending = office roles or anyone involved
with the job (ruled). UI: the permit's Corrections tab, emails, response
letter, "Suggest a type" on Documents, open-corrections warning in the freeze
dialog, the Permit Library. Gate: typecheck clean, lint 5/22, 1781 tests
(+21), build clean. Dev QA with real AI calls ($0.07 total): a QA Palm Beach
letter read in 12 s for $0.054 — six comments verbatim with numbers, pages,
deadline, reviewer and parties, a planted instruction ignored; API 79/79
across the loop (confirm → permit CORRECTIONS + tasks, resolve / waive /
reopen, AI draft + one real send to Richard's address "QA test (please
ignore)", letter, resubmission, repeat comment linked, outcomes, approval
settling the open items, library, suggestion); SALES_REP 9/9; headless
Chromium 1280 / 400 px 46/48 (both misses the check's selector). Fixed in QA:
task wording, the letter's header and line spacing, earlier comments' tasks
left open after the next review, the library on a phone, the tab text while a
notice waits. Dev DB restored, QA uploads removed. Details:
[features/permit-intelligence.md](docs/project-memory/features/permit-intelligence.md).
**Deploy carries the migration.**

### 2026-10-18 — AI Permit Intelligence, Stage 1: the permit record (deployed `acdf728`)

"start stage 1". No AI. Migration `20261101120000_permit_record`:
`Jurisdiction`, `PermitTypeDef`, `PermitKnowledge` (requirements now, lessons
in Stage 6), `PermitParty`, `PermitReviewCycle`, `PermitSubmission` +
`PermitSubmissionFile`; `JobPermit` + jurisdiction / type key / application
number / scope / valuation / current cycle; `File.permitId` +
`permitDocType`; `Task.permitId`; statuses PREPARING and CORRECTIONS. Pure
`lib/permit-intel/{doc-types,catalog,requirements,submission-plan,access,validation}.ts`
(tested); `service.ts`, `submissions.ts` (fflate zip + contents sheet +
sha256 per document and for the zip; the files lock — `permitLockOf` in
`lib/files/access.ts`; the download refuses a zip whose hash moved);
`recordFields` in `updatePermit`; the department's answer moves the status
through `updatePermit`; magic-byte check on every upload
(`lib/files/sniff.ts`). UI: `/permits/[id]` (Overview · Documents with the
checklist · Parties · Submissions · Tasks · Inspections · History), Admin →
Permits (Jurisdictions · Requirements), pickers on the job's Permits tab,
links from the job tab and Permit Center. Found before QA: zod `partial()`
keeps `.default()`, so PATCH schemas are built without defaults. Found in QA:
a resubmission pre-ticked the superseded NOC. Gate: typecheck clean, lint
5/22, 1760 tests (+14), build clean. Dev QA: API 45/45 on stand-ins for the
three prod permits (backfill dry run / apply / unchanged, freeze, locks,
hash-checked download, corrections → resubmission → issued), cron tasks
carry `permitId`, SALES_REP 404 off their jobs and 403 on submit / settings,
headless Chromium at 1280 / 400 px; dev DB restored. Permit Library moved to
Stage 2 (needs full-text search).
Richard pushed and deployed from `!`: backup `postgres-2026-10-18-221510.dump`,
rsync, migration `20261101120000_permit_record` applied (22:16 UTC) — then the
remote build was cut off by the `!` shell timeout (no `BUILD_ID`, old process
still serving). Finished from `!`: a detached rebuild (the first attempt
failed collecting page data because the command had not loaded
`/etc/knuco/env`; the second, with `set -a; . /etc/knuco/env; set +a` and
`ssh -n … < /dev/null`, built clean), restart, `.deploy-sha` `acdf728`.
BUILD_ID `GzGAthoH8VxKu08PW3y4b` → `3SyklAeo2NGYbawokTWey`, smoke 307 ×2
(local and public), zero journal errors since the restart. Seed: every type
and the requirement unchanged (already present). Backfill dry run → `--apply`:
City of Miami / JOB-00002 building ISSUED (cycle 1 2025-09-01 → APPROVED),
City of Boynton Beach / JOB-00021 interior_renovation ISSUED (2026-09-28 →
APPROVED), City of Palm Beach / JOB-00018 reroof APPLIED (2026-09-29 →
PENDING); re-run 0 / 0 / 0. **Lesson: a hand-run build on the droplet must
load `/etc/knuco/env` first, and `ssh -n` with stdin from `/dev/null` keeps
`!` from hanging on the detached job.**

### 2026-10-18 — AI Permit Intelligence: plan, design, prod AI key, Stage 0 (deployed `c82f906`)

Richard pasted a 12-phase brief for an AI permit module (forms, NOAs,
preflight, corrections, knowledge base, dashboard). Read-only prod check: 3
permits ever (three jurisdictions), 0 inspections, no AI key → plan to extend
`JobPermit` / tasks / files / vault / `Organization` and capture structured
history before any vector search; approved. Design written to
`CAREYOS_PERMIT_INTELLIGENCE_DESIGN.md` (schema, routes, UI, prompts, risks,
10 decisions). Richard pasted the Anthropic key; it answered 200, his own `!`
run wrote the literal placeholder `<KEY>`, and at his request the session
replaced that line with the real key (one line, file `knuco:knuco 600`, copy
`/etc/knuco/env.bak-20261018-ai`; no restart — nothing deployed reads it).
**Stage 0:** `@anthropic-ai/sdk ^0.132.1`; `src/lib/ai/*` lifted from
takeoff-m3 and generalised to a polymorphic subject; `AiCall`; caps
`AI_MAX_USD_PER_SUBJECT` / `AI_MONTHLY_MAX_USD`; `UNTRUSTED_RULE` on every
system prompt and `untrustedDocument` framing (QA caught that `</ document`
still read as a closing tag — the bracket is escaped now); server fallback
only for Opus / Sonnet / Fable; `GET /api/admin/ai-usage` + Admin → AI Usage.
The queue change was moved to Stage 2. Gate: typecheck clean, lint 5/22, 1746
tests (+16), build clean. Dev QA: real Haiku + Opus calls ($0.0044 total, a
planted instruction ignored, repeat cached), headless Chromium at 1280 / 400
px, SALES_REP 403. **Deploy carries a migration.** takeoff-m3 must switch to
`runAiCall` before it deploys (feature doc). Richard pushed and deployed from
`!` (background, 277 s, exit 0): BUILD_ID `9mpkCwcWFxbhIUhysJapH` →
`GzGAthoH8VxKu08PW3y4b`, migration `20261031120000_ai_calls` applied, the
process carries `ANTHROPIC_API_KEY`, 0 `ai_calls` rows, zero journal errors,
backup `postgres-2026-10-18-213941.dump`. Rulings the same day: the
jurisdiction is "City of Palm Beach"; statuses PREPARING and CORRECTIONS
approved; anyone involved with the job may approve sending a drafted email;
sample forms and letters to follow.

### 2026-10-16 — Completion photos on crew payments + a "Project photos" folder (built + dev-QA'd on `payment-photos`, on `main`, not deployed)

Richard (plan `~/.claude/plans/when-i-request-payments-idempotent-locket.md`):
optional completion photos when a crew payment is requested and when it is
recorded, and a Files-tab folder showing the project's photos in the order
they happened. Built: migration `20261030120000_labor_payment_photos`
(`files.labor_payment_request_id` / `labor_payment_id` FKs SET NULL +
`taken_at`); `POST /api/files` branches (a request: `guardJob` write, as
raising one; a payment: `canManageJobMoney`; images only, category PHOTOS,
job + lead from the contract; a photo added to a paid request is stamped with
the payment too); `settleRequestOnPayment` moves the request's photos onto the
payment; `uploadForm` / `photoTakenAt` read EXIF `DateTimeOriginal` with
`exifr` (MIT, new dependency) before the downscale strips it, on every upload
path; pure `parseTakenAt` drops dates before 2000 or more than a day ahead;
`completion-photos.tsx` (picker in both dialogs, the row count opening the
preview, "Add photos"); gallery `?order=oldest` by `takenAt` → log day →
upload day, origin "Crew payment · QA Crew · $4,000" / "Payment request · …";
**Project photos** folder card on a job's Files tab opening the oldest-first
timeline under month and day headings (the Photos tab is unchanged). Gate:
typecheck clean, lint 5/22, 1730 tests, build clean. Dev QA: API (request
photos 201, text file 400, future date dropped, recording moves the photos,
SALES_REP 201 on a request / 403 on a payment / 404 on another job's
request), headless Chromium 16/16 at 1280 and 400 px (count opens the
preview, the dialog picker's photo stored with its EXIF date read in the
browser, months oldest first, no page errors); QA uploads deleted, dev DB
restored. **Deploy carries a migration** (and so does the crew-payment-twins
work already on `main`).

### 2026-10-14 — Crew payments counted twice: 2188 Windtrace fixed + a guard (built + dev-QA'd on `labor-twins`, not deployed)

Richard: "on 2188 Windtrace it is showing 90,979 in labor contracts but i do
not see that anywhere". JOB-00010 ("2188 (street TBD)"): $90,979.48 is BNW's
$233,883 labor contract less $142,903.52 paid, i.e. the unpaid part, shown
only as a figure. Found while checking it: three BNW payments were in the job
twice, once as labor payments and once as cc-allocator bank postings
(7/2 $11,694.15, 8/17 $13,199.15, 9/16 $33,913.04 = $58,806.34, every
approved expense on the job). The 2026-09-24 cleanup had already deleted two
more of the same kind by hand (BNW $14,029.76 on JOB-00011, $10,524.74 on
JOB-00010). Read-only checks: both $33,913.04 wires (8/24, 9/16) are real
bank rows; the 8/17 ACH carried $1,505 for 2192 Wind Trace (the payment's
own note). Prod-wide scan: no other labor payment has a bank twin.
**Built:** migration `20261029120000_labor_payment_cover`
(`job_expenses.covered_by_labor_payment_id` FK SET NULL + `labor_cleared_at`);
pure `lib/expenses/labor-twins.ts` (same job, ±3 days, amount within
max($50, 1 %) or the payee names the crew — distinctive words of the crew /
label / vendor name; crew paid only as an expense; notes);
`lib/expenses/labor-cover.ts` (`coverWithLaborPayment` → REJECTED + linked,
reverses a billable increment / recomputes a rollup, audited;
`recordAsLaborPayment`; `clearLaborCheck` approves a held row;
`releaseCoveredExpenses` before a labor payment or contract is deleted;
`laborHoldNote` for intake; `expensesTwinningPayment`); the cc-allocator
intake holds such postings PENDING; `POST /api/labor-contracts/[id]/payments`
returns `possibleDuplicates` and the Labor panel opens
`CrewPaymentTwinDialog`; `POST /api/expenses/[id]/labor-payment`
(`same_money` / `record` / `separate`; ADMIN / MANAGER / OFFICE_STAFF); Cost
Reconciliation → **Crew payments** card; the expense row reads "Counted as a
crew payment: …". `scripts/fix-bnw-windtrace-twins-2026-10.ts` (dry run by
default) covers the three rows and records the $1,505 on JOB-00011's BNW
contract. Gate: typecheck clean, lint 5/22, 1723 tests (+10), build clean.
Dev QA: API 22/23 (the miss was the script's own sum — a $42 row it posted),
headless Chromium 16/16 at 400 and 1440 px; dev DB restored from a dump.
**Deploy carries a migration; then run the script on prod (dry run, then
`--yes`).** Richard ruled the same day: JOB-00011's 6/2 BNW bank posting
$25,760.74 "is for the initial deposit for 2188" — 2188's 5/22 labor payment
($41,189.40, "Deposit $25,987 and Draw $15,202.40") already holds it, so the
script also moves that posting to JOB-00010 and counts it through the 5/22
payment (cc-allocator's bank row still names JOB-00011). Richard is finding
the right date for the JOB-00011 payment dated year 0009. Prod changed during
the session: BNW's 2188 contract is now $259,870 and a 10/5 $14,032.99
payment was added. Richard: $259,870 is right — 2188 is built for KNU to sell,
so cost equal to the job's contract (no profit shown) is expected. Note for
the takeoff merge: its migration `20261028…` sorts before this one.

### 2026-10-13 — GC Partnerships Phase 8a: prequalification package (built + dev-QA'd on `partners-s8`, on `main`, not deployed)

"go to next recommended phase". Phases 5b (BuildingConnected: Bid Board Pro +
OAuth), 6 (discovery: the plan defers it until bid volume) and 7 (AI: no
`ANTHROPIC_API_KEY` on prod, and the shared AI-call layer is the takeoff M3
work still uncommitted in the main checkout) are each blocked, so the session
took Phase 8's first piece. Built: pure `lib/partners/package-plan.ts`
(`planPackage` — per checklist line the vault's current version, else the
attached one; out when waived, nothing filed, expired, not approved for
external, file missing, or RESTRICTED without both the right and the tick; a
version the GC rejected is not resent; `contentsSheet` lists enclosed and "to
follow" only, never internal reasons; `entryName`, `docLabel`);
`lib/partners/package.ts` (`previewPackage`, `buildPackage` — fflate zip,
documents stored, RESTRICTED decrypted, audit `qualification_package` + one
`document_view` per restricted file with IP / UA);
`GET /api/qualifications/[id]/package` (`?preview=1` writes nothing,
`?restricted=1`; partner managers; 409 when nothing can go; rate-limited);
`PackageDialog` behind a **Package** button on each qualification. Gate:
typecheck clean, lint 5/22, 1713 tests (+10), build clean. Dev QA: API 18/18
(current-version preference, every reason, restricted opt-in, zip listing and
contents sheet, W-9 decrypted, audit rows, 409 / 404), headless Chromium 6/6
at 1280 and 400 px; SALES_REP asking for restricted gets none, READ_ONLY 403;
fixed in QA: "W-9 v3 v3" (default titles already carry the version). QA vault
files and rows removed, john.rep back to SALES_REP. Not done (rest of Phase
8): estimating hours per task, `Organization.kind` work beyond GCs; logging
the package as sent is a manual interaction.

### 2026-10-13 — GC Partnerships Phase 5: bid invitations by email (deployed `f4f39c3`)

"build phase 5". Found first: the plan's "existing intake mailbox" never ran —
the four `OUTLOOK_*` lines are commented out in `/etc/knuco/env`, prod has 0
`inbound_email_events` and 0 `intake_settings` rows, and nothing calls the
poller. So the pipeline was built channel-agnostic: one `ingestItbEmail`
fed by (1) **paste** on Business Development → Bid intake (works with no
setup), (2) **MailerSend inbound routing** →
`POST /api/integrations/mailersend/inbound` (HMAC-SHA256 `Signature` of the
raw body; 503 without `MAILERSEND_INBOUND_SECRET`, 401 on a bad signature,
the published test-secret ping acknowledged and dropped), (3) the dormant
Outlook poller handing platform / contact mail over instead of reading it as
a Google Ads lead. Built: migration `20261027120000_partners_bid_intake`
(`BidIntake` beside the raw `InboundEmailEvent`); pure `itb-parse.ts`
(forward unwrapping, HTML → text, platform from sender / links, labelled
fields, dates in office time with named zones, a date without a time = 5 PM
flagged, address split, kind INVITATION / ADDENDUM / UPDATE, account match by
contact email → company domain → GC name, existing bid by platform id → same
account + project, trades by name, sender gate: KNU users, known contacts,
bid platforms); `itb-intake.ts` (ingest with idempotency, review task to the
account owner once per item `bid-intake:<id>` — none for a paste, create the
bid through `createBid` with `signalSource "email:<platform>"`, file on an
existing bid with optional addendum count / due date, dismiss, pick account;
conditional on NEW so two people cannot both decide); routes under
`/api/partners/intake`; `/partners/intake` page + sidebar entry, the bid form
prefilled from the email, a "waiting for review" link on Bids. A subject line
used as the project is shown as such and never counted as "read". Gate:
typecheck clean, lint 5/22, 1703 tests (+28), build clean. Dev QA: API 37/38
(the miss was the check's own date formatting; values right), headless
Chromium 18/18 at 1280 and 400 px, READ_ONLY 403 / SALES_REP 201, webhook 503
unset; QA rows removed, john.rep back to SALES_REP. **Not proven: real ITB
emails** (fixtures are written from the platforms' known shapes) and the
MailerSend signature scheme against a live route (taken from a third-party
guide; the route's first test ping will show it). Attachments in forwarded
mail are not stored.
Richard pushed and deployed from `!` (background, 274 s, exit 0): BUILD_ID
`kRdp4GOoGpB0OBh-SM6ol` → `fq9IG_D9irXnQMsxcg7XR`, migration
`20261027120000_partners_bid_intake` applied (93, none unfinished,
`bid_intakes` empty), zero journal errors since the restart, `/partners/intake`
307 to the portal, the inbound webhook 503 (secret not set — as designed),
backup `postgres-2026-10-13-222029.dump`.

### 2026-10-13 — GC Partnerships Stage 4: health, scorecard, analytics (deployed `68bfb2f`)

"build stage 4", on a branch from `origin/main` (`0e13694`) in the same
worktree. Migration `20261026120000_partners_scorecard` (settings columns +
one CHECK; `db execute` then `resolve`). Pure `health.ts` (plan §17 tables,
dormant cap, bands, rule-made strengths / weaknesses / next step; the worked
example scores 76), `windows.ts` (presets, period buckets), money KPIs in
`scorecard.ts`, the Preferred badge. `scorecard-load.ts` gathers rows in
batches; health now feeds the accounts list (sortable column), the account
header, the bid score's relationship slot and the new Performance tab.
Routes for the scorecard, analytics (+ CSV), the dashboard summary and the
recommended-action task; Admin → Weights edits both rule sets as JSON.
Found in QA and fixed: a back-dated submission or invitation moved an
account's last contact backwards (now forward-only); re-saving the same
weights bumped the version (Postgres reorders JSON keys — compared
canonically); a 45.0001-day average fell in the 60-day band (rounded now);
a window with no activity still showed whole-life profit (money now counts
jobs active in the window, and empty groups drop out); the account tab strip
ran off a phone screen. Gate: typecheck clean, lint 5/22, 1675 tests (+29),
build clean. Dev QA: API 31/31, headless Chromium 23/23 at 1280 and 400 px,
SALES_REP and READ_ONLY 7/7 each; seed rep reset to SALES_REP; QA rows
removed. Details:
[features/partners.md](docs/project-memory/features/partners.md).
Richard pushed and deployed from `!` (background, 281 s, exit 0): BUILD_ID
`Hb0xqBxUlMkJKftTLAj88` → `kRdp4GOoGpB0OBh-SM6ol`, migration applied (92),
`partner_settings_preferred_chk` present, zero journal errors, backup
`postgres-2026-10-13-185953.dump`. Coastal Choice read on prod through the
deployed loaders: health **15, Dormant** — engagement 0 (no interaction has
ever been logged on the account), qualification 0 (none on file), bid flow 0
(its one bid, BID-00001, was awarded in March 2025, outside 12 months),
economics 15 ($200,769 billed in 12 months, 36 % projected margin, 79 days to
pay → 0); next step "Raise payment terms before the next bid". 12-month
scorecard: billed $200,769, collected $290,035, 7 linked payments + 1
unlinked, retainage held $60,743. The numbers are real; the low score is the
empty relationship record, not a fault.

### 2026-10-13 — GC Partnerships Stage 3: bids (deployed `d2afb6f`)

"build stage 3", on a branch from `main` in the same worktree. Migration
`20261025120000_partners_bids` (applied on dev with `db execute` then
`resolve`; hand-appended sequence + five CHECKs): `BidInvitation`,
`BidSubmission`, seven enums, scoring columns on `PartnerSettings`. Pure
`bid-state.ts` (transitions, labels, lead mirror), `bid-score.ts` (zod
weights, deterministic score with gates and a snapshot; the design's worked
example scores 75), `scorecard.ts` (12-month KPIs). Services `bids.ts`
(create lead + invitation in one transaction, status, preview / decide,
close, award through `createJobFromLead` with progress billing / 10 % /
no deposit, reopen, delete, list, bid facts for badges and follow-ups) and
`submissions.ts`; `createJobFromLead` takes options and picks the subcontract
defaults for any `GC_BID` lead; the lead stage route answers 409 for a bid;
`bid-guard.ts` lead-scopes every bid route and the list. Routes under
`/api/bids`; the lead's Bid tab (`bid-panel.tsx`), `bid-form-dialog.tsx`,
`/partners/bids` (KPI strip, list | board), the account's Bids and Projects
tabs, Admin → Bid scoring, attention rows `bids-due` /
`bids-awaiting-decision`, calendar overlay `bid_date`, bid number in ⌘K and
the Leads search. Found in QA and fixed: reopen answered with the lead's old
stage; a sales rep's list showed bids whose lead 404s for them; the nurture
card showed on a bid lead; and, on every lead, the page widened past a phone
screen (grid columns lacked `min-w-0`). Gate: typecheck clean, lint 5/22,
1646 tests (+14), build clean. Dev QA: API 48/48, headless Chromium 25/25 at
1280 and 400 px, SALES_REP 15/15, READ_ONLY and CREW_LEAD read-only; the
JOB-00009 backfill run on a stand-in job (dry run, apply, re-run unchanged)
and reverted. The dev bypass had written CREW_LEAD onto the seed rep; reset
to SALES_REP. QA rows removed. Details:
[features/partners.md](docs/project-memory/features/partners.md).
Richard pushed and deployed from `!` (background, 276 s, exit 0): BUILD_ID
`k_Dv0RZV2Xs5ihU2PF5fB` → `Hb0xqBxUlMkJKftTLAj88`, migration applied (91),
the five `bid_*_chk` constraints present, 0 bids, smoke 307 ×2, zero journal
errors since the restart, backup `postgres-2026-10-13-182830.dump`. Backfill
dry run on prod: JOB-00009 (contract $832,500, created 2025-03-07, lead
GC_BID linked to Coastal Choice) would become an awarded bid; Richard ran
`--apply` from `!`: BID-00001 created (CLOSED / AWARDED $832,500, one audit
row), a re-run changed nothing.

### 2026-10-13 — GC Partnerships Stage 2: qualifications and the document vault (built + dev-QA'd on `partners-s2`, not deployed)

"build stage 2", straight after the Stage 1 deploy, on a branch from `main`
in the same worktree. Migration `20261024120000_partners_qualifications`
(applied on dev with `db execute` **before** `migrate resolve` this time;
hand-appended CHECKs). Built per the spec §2: `CompanyDocumentType` (16
seeded, admin-editable), `CompanyDocument` (versioned per type, own storage
columns; RESTRICTED bytes AES-GCM under the field keyring through new
`encryptBlob` / `decryptBlob` in `lib/crypto/field-encryption.ts`;
reclassifying re-writes the bytes), `Qualification` +
`QualificationRequirement` (default checklist from the settings; the GC's
answer per line), pure `qualification-state.ts` (EXPIRED / RENEWAL_DUE and
every requirement state derived on read, coverage), `document-alerts.ts` +
`document-alert-run.ts` (the vendor pattern; vault tasks carry no entity
link), `vault-access.ts` (SHAREABLE / INTERNAL / RESTRICTED by role + the
`canViewRestrictedDocuments` grant, read fresh per request), the audited
rate-limited bytes route (the only one; added to `FRAMED_BY_SELF`), the
follow-up planner now fed the representative qualification (rules 3–4 live),
attention rows `qualifications-expiring` + `company-docs-expiring`, calendar
overlays `company_doc` + `qualification_date`, the vault page, the
Qualification and Documents tabs, `/partners/qualifications`, the grant on
Admin → Users, the vault owner + default checklist on Admin → Business
Development. Gate: typecheck clean, lint 5/22, 1632 tests (+16), build clean.
Dev QA: API 54/54 (the one script miss was my reading of the tasks route; the
vault task was verified raised and settled by SQL), headless Chromium 14/14
at 1280 and 400 px with no page errors — found and fixed in QA: the
qualification dialog seeded its checklist from options that had not loaded
(a new qualification came up with an empty list), and link-styled buttons
needed `nativeButton={false}`; role matrix: SALES_REP sees the restricted row
locked and gets 404 on its bytes / 403 on upload, MANAGER without the grant
404 and with it 200 plus one `document_view` audit row. QA rows and files
deleted; no `.enc` blobs left in `uploads/`. Not exercised: the email of a
vault task (owner = Richard on prod), a blob key rotation (no sweep yet),
PDF rendering of the preview frame in a full browser (the headless shell
showed the frame element only — the same caveat as 2026-10-03). Details:
[features/partners.md](docs/project-memory/features/partners.md).
Merged and deployed the same day through `/tmp/knuco-main`; Richard pushed
and deployed from `!` (background, 265 s, exit 0): BUILD_ID
`teFcePwxp9jUwltnPFRYK` → `k_Dv0RZV2Xs5ihU2PF5fB`, `.deploy-sha` `65cc01e`,
migration applied (90; both CHECKs and the grant column present), smoke 307
×2, zero journal errors since the restart, backup
`postgres-2026-10-13-170744.dump`. Then on prod: seed (16 document types
created, the default checklist filled; second run unchanged ×21), wrapper
`crm-cron/company-document-alerts.sh` + crontab `56 11 * * 1-5` (crontab
copy `/home/knuco/crontab.bak-20261013-vault`), first run `{"documents":0,
"qualifications":0,"raised":0}` 200. `FIELD_ENCRYPTION_KEYS` is set on prod,
so RESTRICTED uploads work.

### 2026-10-13 — GC Partnerships Stage 1: accounts, contacts, interactions, follow-ups (built + dev-QA'd on `partners-s1`, not deployed)

Richard: "start stage 1" after approving the plan and the build spec earlier
the same day. Built in a worktree branched from `main` (the main checkout
holds uncommitted takeoff M3 work). Migration `20261023120000_partners_core`
generated as a datamodel diff against the committed schema (the dev DB already
carries M3's `plan_ai_calls`), applied with `db execute` — note `migrate
resolve` ran first by mistake and recorded the migration before the SQL had
run; the SQL was then executed and every object verified. Pure modules with
tests: `stages` (six-value enum + `StageLike`), `derive` (badges, quiet days),
`follow-ups` (rules new-target / no-response / quiet with period keys; rules 3–4
coded, waiting on Stage 2 inputs), `query`, `access`, `validation`,
`time/working-days` (shared with the crew install planner). Services:
`service` (create / update / stage / owner / delete, every write audited,
owner change reassigns open engine follow-ups), `contacts` (one primary per
account), `interactions` (moves `lastContactAt`, ActivityLog bridge for bid
leads, optional follow-up task, settles), `follow-up-run` (copy of the vendor
alert run), `settings`. **The fence**: `Lead.kind` guards `buildLeadListWhere`
(`?kind=` param, test), nurture enrolment, `emitLeadEvent`, the overdue
follow-ups row, the dashboard counts and the funnel cohort; `customerName()`
prefers the company on a `GC_BID` lead; search labels bids. Task plumbing
(`organizationId` on create / include / list params, `SubjectKind
"organization"`, chip icon), attention row `partner-follow-ups`,
contact-lookup returns `contacts`. Decided while building: the partner list
does **not** floor SALES_REP to Mine (seven users; Mine is a convenience
filter). Gate: typecheck clean, lint 5/22, 1616 tests (+44), build clean. Dev
QA: API 46/46 as ADMIN (found and fixed: contact-lookup compared digits
against phones stored with dashes), headless Chromium 17/17 at 1280 and 400
px with no page errors, role matrix as SALES_REP / MARKETING / CREW_LEAD
exactly as specified; seed idempotent (second run unchanged ×5); backfill dry
run on dev "nothing to do"; QA rows deleted. Not exercised: the follow-up
assignment email (QA owner was the muted dev rep), a bid lead end to end
(Stage 3). Details:
[features/partners.md](docs/project-memory/features/partners.md).
Merged and deployed the same day: `main` was fast-forwarded in a temporary
worktree (`/tmp/knuco-main`) because the main checkout holds uncommitted
takeoff M3 work; Richard pushed and deployed from `!` (background, 272 s,
exit 0): BUILD_ID `rdnoX1aBXPhXwFrp21OQG` → `teFcePwxp9jUwltnPFRYK`,
`.deploy-sha` `b8af730`, migration `20261023120000_partners_core` applied
(89; the two CHECKs and the partial index present), smoke 307 ×2, zero
journal errors since the restart, backup `postgres-2026-10-13-154729.dump`.
Then on prod: seed (created ×5 / unchanged ×5), backfill dry run → `--apply`
(JOB-00009 was already PROGRESS / 10 %, so `--fix-billing` was not needed;
account `cmv6v0zei0000asbt4ua6kjs7` created ACTIVE with the Drywall trade,
the lead marked `GC_BID` and linked, re-run "nothing to do"), wrapper
`crm-cron/partner-follow-ups.sh` + crontab `55 11 * * 1-5` (crontab copy
`/home/knuco/crontab.bak-20261013-partners`), first run
`{"organizations":1,"raised":0}` 200.

### 2026-10-09 — Fix: "Choose a PDF" on the Plan takeoff tab did nothing; the Assignment select showed an id (deployed `f670e84`)

Richard, on the M2 click-through: "I click choose pdf on plan take and select
the file but it doesn't seem to be uploading." No upload request ever reached
nginx. Reproduced in his Chrome against prod with a 6-page slice of the 3310
set through the real file input: the uploader's `onChange` read
`e.target.files`, cleared `e.target.value` (so the same file can be picked
again) and only then called `take()` — in Chrome the `FileList` is live, so it
was empty by then (probed in the page: 1 file at the event, 0 a microtask
later). Drag-and-drop was unaffected, which is why the dev QA (drop + API)
passed. The handler now snapshots the list with `Array.from` before clearing,
as `task-attachments.tsx` already did; the other pickers were checked (they
take `files[0]` or snapshot synchronously). Also proven on the way: a 15 MB
body reaches the app on prod through Cloudflare, nginx and the Next proxy in
about 3 s (the route answered its own 400 for a non-PDF), so the 100 MB nginx
regex location and `proxyClientMaxBodySize` are right. Second fix: the lead
page's Assignment card select now passes `items`, so it shows the person's
name instead of the user id (the 2026-10-04 lesson; `44fd0c7`). Gate:
typecheck clean, lint clean on both files, takeoff tests 36/36. Not done: the
same `items` sweep on the admin-side selects (follow-up rules, job task
templates, personnel crew, users role, Apply workflow permit file). Prod has
one empty plan set on Brian Carter's lead (6770 McKinley), created 10:18 UTC —
the upload goes on it after the deploy.
Richard pushed and deployed from `!` (background, 252 s, exit 0): BUILD_ID
`JyubG__VqAsj4BvpIQTie` → `rdnoX1aBXPhXwFrp21OQG`, `.deploy-sha` `f670e84`,
no migration, smoke 307 ×2, zero journal errors since the restart, backup
`postgres-2026-10-09-103217.dump`. Verified on prod from Chrome: the 6-page
slice went through the real picker (POST 201, progress, toast), and **the
first prod index ran**: 9 steps done, 6 sheets numbered and titled (A-00 to
A-05, scales as printed, all rendered). The test plan set was then deleted
and an empty "Plan set" recreated on the lead (prod: 1 set, 0 documents, 0
sheets, 0 jobs), so Richard lands where he was. **Also seen in the first
prod index: `plan_jobs.started_at` is stamped by the last claim, not the
first** — 48 ms between started and finished for nine steps — cosmetic.

### 2026-10-09 — Plan takeoff M2: calibration + manual tools (built + dev-QA'd on `takeoff-m2`, not deployed)

Built straight after the M1 deploy: migration `20261021120000_takeoffs_measurements`
(`Takeoff` with `TK-nnnn` from a sequence, `TakeoffSheet`, `TakeoffMeasurement`
with the calibration it was measured at, `previousValue` and a review status;
three CHECKs); pure `geometry/*` — dimension strings, chain merging of dash
fragments, dimension-line matching that verifies the printed scale (A-10: 40
of 45 strings matched, median 1.5 % over 18 pt/ft → VERIFIED), snapping with a
grid index, one `computeValue` for client and server; `takeoff-service.ts`
(create with proposed sheets, measurements refused on an uncalibrated sheet,
edits keep the first value, explicit Recompute, calibrate auto / confirm /
manual / clear); nine routes; the `/takeoff/[takeoffId]` workspace (rail,
SVG overlay with dashed proposals and vertex handles, Area / Linear / Count /
Calibrate tools with snapping and a live readout, label popover, calibrate
dialog with the verification, grouped list with totals, inspector) and trade
cards on the hub. Gate: typecheck clean, lint 5/22, 1572 tests (+17), build
clean. Dev QA: API 37/37, headless Chromium 22/22 at 1280 and 400 px; QA data
deleted. Details:
[features/plan-takeoff.md](docs/project-memory/features/plan-takeoff.md).
Richard pushed and deployed from `!` (background, 253 s, exit 0): BUILD_ID
`jZogc4PvvnFSYj7gxiyS0` → `JyubG__VqAsj4BvpIQTie`, migration
`20261021120000_takeoffs_measurements` applied (88; `takeoff_number_seq` and
the three CHECKs present, 0 takeoffs), smoke 307 ×2, zero journal errors
since the restart, the tick cron still answering `{"jobs":0}`, backup
`postgres-2026-10-09-042406.dump`.

### 2026-10-08 — Plan takeoff M1: plan sets, sheet index, viewer (built + dev-QA'd on `takeoff-m1`, not deployed)

"start M1". Built: migration `20261020120000_plan_sets` (`PlanSet`,
`PlanDocument`, `PlanSheet`, `PlanJob`, `PlanJobStep`, `FileCategory.PLAN_SET`);
the extraction worker (`src/lib/takeoff/pdf/extract-worker.mjs`, forked by
path — pdf.js and `@napi-rs/canvas` never run in the Next process); pure sheet
parsers (`sheets/*`: cover-sheet list, title block, discipline, scale,
classify) tested on text fixtures from the real set; the tick runner
(`pipeline/*`: `SKIP LOCKED` claims, 40 s budget, 3 attempts, stale-lock
reclaim, 2 concurrent across the app); `service.ts`; routes under
`/api/plan-sets`, `/api/plan-sheets`, `/api/takeoff-jobs`, `/api/cron/takeoff-tick`
(lead guard + explicit role lists); `PlanTakeoffPanel` on the lead's Plan
takeoff tab and job Money → Plan takeoff; `/plans/[planSetId]` viewer
(server PNG at 72 / 144 dpi under one CSS transform with an SVG overlay slot,
own pan/zoom). Found in QA: the SSO middleware caps request bodies at 10 MB
→ `experimental.proxyClientMaxBodySize: "100mb"`. Gate: typecheck clean, lint
5/22, 1555 tests (+19), build clean. Dev QA: API 35/35 (the 34-sheet set
indexed in 2 ticks / 44 s, every sheet numbered and titled, scales as
printed), headless Chromium 19/19 at 1280 and 400 px, SALES_REP 404 / 403;
QA sets deleted. Details:
[features/plan-takeoff.md](docs/project-memory/features/plan-takeoff.md).
Richard pushed and deployed from `!` (the first run stopped at pre-flight on
the two untracked 2026-10-07 research reports, committed as `d2fa4d0`; the
second ran in the background, exit 0): BUILD_ID `cKcuzqLdl3kPJiUWOl6SE` →
`jZogc4PvvnFSYj7gxiyS0`, migration `20261020120000_plan_sets` applied (87),
`@napi-rs/canvas` linux binary present, smoke 307 ×2, zero journal errors
since the restart, backup `postgres-2026-10-09-034839.dump`. Operator items
done by the session: `location /api/plan-sets/ { client_max_body_size 100M;
proxy_read_timeout 120s; … }` in the CRM vhost (copy at
`/root/crm.careyos.com.bak-20261008-takeoff`, `nginx -t` ok, reloaded) and
`crm-cron/takeoff-tick.sh` on the `knuco` crontab every minute (crontab copy
`/home/knuco/crontab.bak-20261008-takeoff`), first run `{"jobs":0}`.

### 2026-10-08 — AI plan takeoff, Stage 1: plan approved, design written (nothing built)

Richard's brief (plan mode): upload construction plan sets inside the
estimator → identify sheets → roofing / plumbing takeoff → reviewed material
list → supplier RFQ (no pricing). Audited (3 explore agents + read-only prod:
5 draft estimates, 11 roof estimates, 0 vendors, 0 roof measurements), evaluated
OpenTakeoff (Apache, concepts only), ConMCP (MIT, concepts), ProTakeoff (MuPDF =
AGPL, reject), ran three PoCs on the 3310 NE 37th set (34 vector pages, 20 MB;
sheet list on A-00; pdf.js `getOperatorList` gives the lines; dimension strings
match their lines within 0–2 % of the printed 1/4" scale; pdf.js +
`@napi-rs/canvas` renders a sheet in 0.3–0.7 s) and one AI test (Claude Opus
5.5 on A-10 image only, $0.12: every drain, scupper, slope and dimension string
read correctly, no material named — correct; free polygons −9 % on area, so
geometry comes from ids + snapping). Plan approved
(`~/.claude/plans/harmonic-churning-stearns.md`); full design in
`CAREYOS_PLAN_TAKEOFF_STAGE1_DESIGN.md` (repo root). Decisions: native module
`src/lib/takeoff`, takeoff on the Lead, code extracts and measures, Claude
labels by picking ids, table-driven tick queue, server PNG + SVG viewer,
`/takeoff/[id]` workspace, roles edit = office + SALES_REP own leads / approve =
office. Milestones M0 (PoCs) → M1 plan sets → M2 calibration + manual tools →
M3 AI roofing → M4 AI plumbing → M5 materials + review → M6 RFQ. **Open
rulings:** prod `ANTHROPIC_API_KEY`, role lists, 2–3 historical plumbing
projects for the accuracy benchmark, suppliers under Vendors. Oddity: macOS
refused every read of the 3310 PDF mid-session (Richard's own `cp` from `!`
too); the copy came from Terminal.app. **M0 run the same day** (details and
pictures in [features/plan-takeoff.md](docs/project-memory/features/plan-takeoff.md)):
canvas renders under the `knuco` sandbox on the droplet (11 pages 3.2 s, 277 MB);
geometry extraction is complete for this set (no forms, no curves) but pipe
runs are dash-dot fragments → a chain merge (21,470 segments → 5,990 chains in
24 ms) is required; with chains as candidates Claude picked the right pipe line
in 10/10 tiles ($0.13), with raw segments it failed; the roof call with segment
ids snapped 36/36 vertices and chose 16 valid parapet ids (2,867 SF, 391 LF, 11
drains, assembly = cementitious waterproofing with 10 items not specified);
timing 1.0 s/page (≥ 39 pages per 40 s tick) but RSS reaches 2.3 GB across
pages → the pipeline step runs in a forked child process. **M0 verdict: id
design confirmed; next is M1.** No code, no migration, nothing on prod.

### 2026-10-05 — Crew install dates: calendar marker + get-ready task (deployed `fd736c1`)

Richard asked whether a crew's install date notifies anyone (it did not: the
date was display-only and could not be changed after saving), then ruled in
plan mode (`~/.claude/plans/dynamic-orbiting-raven.md`): calendar marker + a
task; owner = superintendent, else PM; raised when saved and due the working
day before; tick the checklist line and offer the date as the job's start.
Built on `crew-install-dates`: pure `lib/crews/install.ts`, `install-run.ts`
(`syncInstallTask`, `openInstallTasks`); `POST /api/jobs/[id]/crews` validated
and pinned through `parseDueAt`; new `PATCH|DELETE
/api/jobs/[id]/crews/[assignmentId]`; `crew_install` calendar overlay;
`HeldFacts.crewInstallSet`; **held facts are now also ticked when a step
closes** (`afterClose`), so a line on a step that becomes Ready later is
ticked then; Crews panel with date edit, remove and the owner line. No
migration. Gate: typecheck clean, lint 5/22, 1536 tests (+9), build clean. Dev
QA by API and headless Chromium at 1280 and 400 px; dev DB restored. Not
exercised: the assignment email, a superintendent slot, SALES_REP. Prod has 2
crew assignments and no install dates, so nothing to backfill. Details:
[features/crews.md](docs/project-memory/features/crews.md).
Richard pushed and deployed from `!` (background, 282 s, exit 0): BUILD_ID
`ZHdfRxz1Bvd0_yY3_Y3sI` → `cKcuzqLdl3kPJiUWOl6SE`, no migration, smoke 307 ×2,
zero journal errors since the restart, `UPLOADS_DIR` carried, 22 files in the
store, backup `postgres-2026-10-05-155517.dump`.

### 2026-10-04 — An admin can delete a job (deployed `ac1e22b`)

Richard: "I would like to give admin users the option to delete a job. Some
jobs were created as a test." There was no delete. Built: `lib/jobs/delete.ts`
(pure `jobDeleteBlockers` / `jobDeletePlan`, `loadJobDeleteCounts`, `deleteJob`
— tasks deleted first because their job link is SET NULL, the rest by cascade;
audit `job_delete` with a snapshot, the counts and the reason);
`canDeleteJob` (ADMIN only) + `guardJobDelete`; `GET
/api/jobs/[id]/delete-check` (writes nothing) and `DELETE /api/jobs/[id]`
(reason required; 409 with the blockers); `DeleteJobDialog` behind "Delete
job…" in the job page's ⋯ menu. **Refused when the job has customer payments,
expenses, invoices, crew payments, daily logs, field labor entries, a sent or
signed customer contract or a linked violation case** — chosen by the session,
Richard ruled 2026-10-19: keep it strict. The lead and the job's files
stay. Read-only prod check: 13 of 26 jobs carry none of those records. Gate:
typecheck clean, lint 5/22, 1527 tests (+2), build clean. Dev QA: API 409 /
400 / 404, SALES_REP 403 on both routes, headless Chromium deleted a job with
a workflow, 16 tasks and 35 budget lines (job and tasks gone, audit row, no
page errors); dev DB restored from a dump. Not exercised: a job with permits,
labor contracts, change orders or commitments. No migration. Richard pushed
and deployed from `!` (background, 263 s, exit 0): BUILD_ID
`hLEppdI-GfVnoKGiBISj-` → `ZHdfRxz1Bvd0_yY3_Y3sI`, smoke 307 ×2, zero journal
errors since the restart, 21 files in the store, backup
`postgres-2026-10-04-135010.dump`.

### 2026-10-04 — Fix: Create Lead refused an empty job value; source / rep pickers showed ids (deployed `4c0aaae`)

Richard: "When I click create lead I get an error message", and Source /
Assign To on the lead form did not show the chosen name. Reproduced on dev:
the empty "Estimated Job Value" field (`valueAsNumber` → NaN → JSON `null`)
failed `z.number().optional()` with a 400, shown as raw JSON in the toast.
`estimatedJobValue` is now `.nullish()`; the create and update routes answer
with `leadIssuesMessage` ("field: what is wrong"); both lead forms post through
`fetchJson`; the Source and Assign To selects on New Lead and Edit Lead pass
`items`, which Base UI needs to show a label instead of the value. Gate:
typecheck clean, 1525 tests. Dev QA in headless Chromium on New Lead (both
pickers show the name, lead created with the value empty, no page errors; QA
lead removed). Not exercised: Edit Lead in the browser. No migration. Richard
pushed and deployed from `!` (background, 254 s, exit 0): BUILD_ID
`dnrclujOQuYo8gnVkDHq2` → `hLEppdI-GfVnoKGiBISj-`, smoke 307 ×2, zero journal
errors since the restart, 21 files in the store, backup
`postgres-2026-10-04-132441.dump`. **Lesson: a Base UI `Select` fed ids needs
`items` (or a `SelectValue` render function) — other id-valued selects may
show the same fault.**

### 2026-10-04 — Tasks page always opens on the signed-in person's tasks (deployed `330fd6f`)

Richard: "the default view for each user should be only tasks assigned to the
user." The page already defaulted to Mine but followed the saved Mine / All
preference shared with Jobs and Leads, so anyone who had picked All there (or
clicked Everyone on Tasks once) kept landing on everyone's tasks.
`resolveTaskScope` now reads only the URL (`?scope=all` for the visit, else
Mine); the Everyone toggle no longer writes `defaultListScope`; Settings →
Lists & boards says so. Links that mean the team's tasks (`scope=all`) are
unchanged. Gate: typecheck clean, lint clean on the touched files, 1525 tests.
Not clicked through in a browser. No migration. Richard pushed and deployed
from `!` (background, 262 s, exit 0): BUILD_ID `Sm73Z7jwQy_iEWRSA7K2T` →
`dnrclujOQuYo8gnVkDHq2`, smoke 307 ×2, zero journal errors since the restart,
21 files in the store, backup `postgres-2026-10-04-131016.dump`. **The deploy
also carried the roofing import script (`9265589`) — on prod now, still not
run.**

### 2026-10-03 — Roofing integration, P0 Stage C: the import script (on `main`, not deployed, not run on prod)

Built on `roofing-import`: pure `src/lib/roofing/import-plan.ts`
(`matchProperty` — street + zip, nothing looser; `planMaterials`;
`planRuleChanges`; `measurementDifferences`; `manualOverrides`) and
`scripts/import-roof-estimator-2026-10.ts` (read-only session on the
estimator's database; materials + prices, rule changes, Roofr reports
re-parsed onto the lead at the same address with typed corrections carried
over; lists and invoices counted, not imported). There was no local estimator
database, so QA ran against a throw-away one built from the estimator's own
schema and seed (its 40 / 40 / 43 / 2 counts equal prod's — prod's catalog is
seed data) plus two test reports: dry run wrote nothing, `--yes` imported,
a second run created nothing; everything removed afterwards. Gate: typecheck
clean, lint 5/22, 1525 tests (+8), build clean. No migration. Not exercised:
the real source and its storage folder. Details:
[features/roofing.md](docs/project-memory/features/roofing.md).

### 2026-10-03 — Roofing integration, P0 Stage B: takeoff rules + price book (deployed `ac2a1d8`)

Carried on after the Stage A deploy check. Built on `roofing-price-book`:
migration `20261019120000_roof_price_book`; pure `engine/resolve.ts` (rules
with the company's changes over the code defaults — a switched-off rule is
gone, which the estimator could not do; day-based price in force; catalog
order = the takeoff's choice); `price-book.ts`, `access.ts` (ADMIN / MANAGER
for everything under `/api/roofing`), eight routes, `/admin/roofing`. Narrower
than the plan: one append-only price table instead of price + history, and no
`RoofSystem` yet (nothing would read it before the estimate builder). Found in
QA and fixed: a price dated today through the date picker lost to the price
saved earlier the same day (instants compared) — prices now take effect by
day, later entry wins. Gate: typecheck clean, lint 5/22, 1517 tests (+15),
build clean. Dev QA: API 26/26, headless Chromium 10/10; QA rows removed.
Details:
[features/roofing.md](docs/project-memory/features/roofing.md).
Richard pushed and deployed from `!` (background, 255 s, exit 0): BUILD_ID
`HfCtieXEwvKgJaManWLme` → `Sm73Z7jwQy_iEWRSA7K2T`, migration
`20261019120000_roof_price_book` applied (86), smoke 307 ×3, zero journal
errors since the restart, 21 files in the store, backup
`postgres-2026-10-03-232527.dump`. Prod after (read-only script): 0 changed
rules, 0 materials, 0 prices, 0 measurements; the engine loads 16 shingle
rules and an empty catalog.

### 2026-10-03 — Roofing integration, P0 Stage A: library, measurements, cost baseline (deployed `79e4e19`)

"approved, start with P0". 0.1: `~/roofestimator` verified identical to the
server copy and put under local git (`e0adbff`). Stage A on `roofing-p0`:
`src/lib/roofing/{types,round,address,measurements,service,validation}.ts`,
`parsing/{roofr,pdf,waste-table}.ts`, `engine/{engine,defaults}.ts`;
`pdfjs-dist` 4.10.38 (`serverExternalPackages`); `RoofMeasurement` +
`FileCategory.MEASUREMENT_REPORT`; routes under `/api/leads/[id]/roof-measurements`
and `/api/roof-measurements/[id]`; `RoofMeasurementsPanel` on the lead and the
job; `signedEstimateCost` so a roofing estimate is a cost baseline. Found on
the way: Roofr's recommended waste is a position on the page, not text — read
from glyph positions, stored as a suggestion, never applied by the engine. The
estimator's OCR stub (did nothing) was not carried over. Gate: typecheck clean,
lint 5/22, 1502 tests (+63), build clean. Dev QA: API 25/25 with a real
report, headless Chromium at 1280 and 400 px, all 23 real Roofr PDFs parse in
the CRM (confidence ≥ 0.84); dev DB restored. Not exercised: SALES_REP, and
PDF parsing under the production server. Details:
[features/roofing.md](docs/project-memory/features/roofing.md).
Richard pushed and deployed from `!` (background, 264 s, exit 0; the deploy
also carried the preview-frame fix `1a1313d`): BUILD_ID
`9llN2MQ3E4W4TUZGOSNH5` → `HfCtieXEwvKgJaManWLme`, migration
`20261018120000_roof_measurements` applied (85), smoke 307 ×2, zero journal
errors since the restart, `UPLOADS_DIR` carried, 21 files in the store, backup
`postgres-2026-10-03-230418.dump`. Headers on prod: `/` `DENY`,
`/api/files/:id` `SAMEORIGIN`. A real Roofr PDF parsed on the droplet with the
deployed code through `tsx` (confidence 0.91, 31.6 squares, 3 pitch bands,
waste 6%; nothing written, 0 measurement rows). **Still unproven: the same
parse inside the running Next server** (pdfjs loaded as a server-external
package) — the first upload from the lead's Roofr tab is that test.

### 2026-10-03 — Fix: the in-app PDF preview was blocked by the site's own frame headers (deployed inside `79e4e19`)

Found while starting the roofing integration. `next.config.ts` sends
`X-Frame-Options: DENY` and `frame-ancestors 'none'` on every path, so the
browser refused the `<iframe>` in `FilePreviewDialog` (shipped in `d18d054`)
and the agreement frame on the customer signing page (older; prod has no
customer contracts). The frame stayed blank; "Open in a new tab" and Download
worked. The Stage 1 QA had only counted the iframe element in a headless shell
with no PDF viewer and reported it as passing. Fix: a second headers entry
after the site-wide one lets `/api/files/:id` and `/api/sign/:token/pdf` be
framed by this origin only (`SAMEORIGIN`, `frame-ancestors 'self'`). Verified
by headers on dev (the two paths `SAMEORIGIN`; `/api/files`, `/api/jobs`,
`/vendors` still `DENY`) and in full Chromium (`chromium-1228`, which has a PDF
viewer): the preview frame loads the file URL with no refusal, and a control
frame of `/api/jobs` is still refused. **Lesson: a framed response needs a
real-browser check of the frame's loaded URL or a refusal in the console —
`chrome-headless-shell` cannot show a PDF, so "an iframe exists" proves
nothing.** No migration.

### 2026-10-03 — Tidy-up pass after the MVP roadmap (deployed `b28e94e`)

"continue" with nothing queued: offered the audit's Phase 2 list, Richard chose
a tidy-up pass. Checked the audit's 14 quick wins against the code: 9 were
already done, 1 is superseded (the "failed inspections" tile — the attention
row "Inspections to correct" covers it), 2 were open and are now done, 2 need
a ruling (below). Built on `tidy-up`: `FileLink` (violation inspection report,
hearing order, fine file, case photo grid and labor-contract documents open in
the preview); "Photo missing" placeholder on the field daily-log grid; the
vendor compliance warning inside the Record payment and Request a payment
dialogs; ⌘K and the lists find a job by **invoice number** and a lead by
**estimate number** (both estimate builders); the bulk "Move to stage: Won"
toast says how many jobs were created; the lead page links to its jobs; the
Won confirmation no longer mentions a deposit task. No migration. Gate:
typecheck clean, lint 5/22, 1439 tests (+2), build clean. Dev QA: search by
invoice and estimate number by API; headless Chromium — lead → job link,
labor-contract document in the preview, the warning in both payment dialogs,
the field placeholder; dev DB restored. Not exercised: the violation file
links (dev has no case) and the bulk-Won toast (it would create jobs).
**Left for Richard's ruling:** (1) should logging a contact on a lead move its
next follow-up date, and to when? (2) `/api/messaging` (inbound Twilio texts)
is behind the SSO gate and Twilio is not configured on prod — make it public
or remove the handler. *(Ruled 2026-10-19: (1) no; (2) leave it for now.)*
Richard pushed and deployed from `!` (background, 269 s, exit 0): BUILD_ID
`SBnOF_n7Dfa0xpp-w6tyi` → `9llN2MQ3E4W4TUZGOSNH5`, no migration, smoke 307 ×2,
zero journal errors since the restart, `UPLOADS_DIR` carried, 21 files in the
store, backup `postgres-2026-10-03-205754.dump`. Two of the session's SSH
checks right after the deploy were refused (`kex_exchange_identification:
Connection reset by peer`) and succeeded on a retry 20 s later — the droplet's
sshd throttling a burst of connections, not an app fault.

### 2026-10-03 — Audit initiative 7, Stages 2 and 3 deployed (`a03c698`); the MVP roadmap is complete

Richard pushed and deployed from `!` (background, 253 s, exit 0): BUILD_ID
`16_91QFu9eTLm0-ZEhAiC` → `SBnOF_n7Dfa0xpp-w6tyi`, migration
`20261017120000_expense_receipts` applied (84; `files.expense_id` nullable
with its index, enum value `RECEIPT`), smoke 307 ×2, zero journal errors since
the restart, `UPLOADS_DIR` carried, 21 files in the store, backup
`postgres-2026-10-03-203928.dump`. Prod after: 92 files (37 with a job), 0
receipts, 106 daily-log photos (all on JOB-00009, all missing on disk), 0 image
files. **Foundation and all seven initiatives of the audit's MVP roadmap are
on prod.**

### 2026-10-03 — Audit initiative 7, Stage 3: receipts on expenses (deployed inside `a03c698`)

Built on `expense-receipts` straight after Stage 2: migration
`20261017120000_expense_receipts` (`files.expense_id`, `FileCategory.RECEIPT`);
`expenseId` on `POST /api/files` (`canEnterJobCosts`; job and lead from the
expense; category forced to RECEIPT); receipts with `missing` on
`GET /api/jobs/[id]/expenses`; a receipt cannot be moved off its job; receipts
left out of the photo gallery; the expenses panel's add-form picker, row
paperclip + count, per-row attach (bank-fed rows too), edit-dialog list; the
Files tab's Receipts group naming the expense. Gate: typecheck clean, lint
5/22, 1437 tests, build clean. Dev QA: API 13/13, headless Chromium 10/10 at
1280 and 400 px, SALES_REP without the cost grant 403. Dev DB restored.
**Lesson: `set -a; . ./.env` in the same shell as `npm run build` sets a
development `NODE_ENV` and the build dies prerendering
(`Cannot read properties of null (reading 'useState')`). Run the build in a
shell that has not sourced `.env`.** The "fails right after killing `next
dev`, passes on the re-run" seen in earlier sessions was very likely this.
**Deploy carries a migration.** Details:
[features/job-files.md](docs/project-memory/features/job-files.md).

### 2026-10-03 — Audit initiative 7, Stage 2: one photo gallery, two sources (deployed inside `a03c698`)

Carried on straight after the Stage 1 deploy check (same approved plan, no
migration). Built on `job-gallery`: pure `lib/photos/gallery.ts`
(`mergeGallery`, `filterGallery`, each item with its `origin` and `href`);
`GET /api/jobs/[id]/gallery` (daily-log `FieldPhoto`s + the job's image
`File`s, `missing` per item); `POST /api/photos/[id]/replace` (only when
missing; the taker or an office role; an approved log does not lock a
restore); `JobPhotoGallery` rebuilt (source chips, Missing chip, placeholder
tile, lightbox across both kinds with Upload again); `preparedUpload` —
photos are downscaled on every upload path (task sheet, Complete dialog,
AddTaskDialog, field task page, Files panel). Gate: typecheck clean, lint
5/22, 1437 tests (+8), build clean (a first build failed because the dev
`.env` had been sourced into the same shell — see the Stage 3 entry). Dev QA: API
14/14; headless Chromium at 400 and 1280 px, no console errors; a 4000 px /
1.3 MB photo taken from the field task page was stored at 2000 px / 204 KB and
appeared in the job gallery; SALES_REP off the job 403, on it read-only. Dev DB
restored. Not done: the field daily-log screen's own grid still shows a broken
image for a missing photo. Details:
[features/job-files.md](docs/project-memory/features/job-files.md).

### 2026-10-03 — Audit initiative 7, Stage 1: files belong to the job (deployed `d18d054`)

"continue". Planned first (one explore agent + a read-only prod check: 92 file
rows, 106 daily-log photos, 21 files on disk; no lead with files has two
jobs). Richard ruled: missing files are marked and can be uploaded again onto
the same record; any expense may carry receipts; one photo gallery from two
sources. **Found while exploring: a signed customer agreement's PDF could be
deleted** — it is stored as `SIGNED_DOC`, the guard covered only
`CUSTOMER_CONTRACT`, and the delete unlinked the PDF the contract reads (prod
has no customer contracts yet). Built on `job-files`: `files.job_id` with a
three-rule backfill (migration `20261016120000_file_job_link`); pure
`lib/files/scope.ts`; `canDeleteFile` / `canEditFile` take `generated` (any
file a `GeneratedDocument` references is untouchable through the file routes);
`presentFiles` adds `missing` and `generated` to every list;
`GET /api/files?jobId=` → `{ files, leadFiles }`; `PATCH /api/files/[id]`;
`POST /api/files/[id]/replace`; `?download=1` / `?meta=1`; the six contract
writers set the job; `FilePreviewDialog`; Files panel rebuilt (groups, chips,
Missing, search, row menu); task attachments, workflow-step files and the
field task page open the preview. Gate: typecheck clean, lint 5/22, 1429 tests
(+10), build clean. Dev QA: API 31/31, headless Chromium 28/28 at 400 and
1280 px, SALES_REP 200 / 404 / 403; dev DB restored. Not exercised: signing a
customer contract end to end. **Deploy carries a migration**; expected prod
backfill: 37 files on single-job leads gain a job (less any on a case), 2 task
files take their task's job, 54 stay lead documents. Details:
[features/job-files.md](docs/project-memory/features/job-files.md).
Richard pushed and deployed from `!` (background, 261 s, exit 0): BUILD_ID
`xqCVJVDrq3De9dtsbMCfy` → `16_91QFu9eTLm0-ZEhAiC`, migration
`20261016120000_file_job_link` applied (83), smoke 307 ×2, zero journal errors
since the restart, `UPLOADS_DIR` carried, 21 files in the store, backup
`postgres-2026-10-03-201622.dump`. Backfill predicted read-only before the
deploy and matched after it: 92 files → 37 with a job (2 through their task,
35 on single-job leads, across 10 jobs; JOB-00009 has 13), 55 lead documents
(5 of them on code-violation cases, left with the case), 0 files whose job
belongs to a different lead.

### 2026-10-03 — Audit initiative 6, Stage 3: commitments (deployed `78bdc4c`)

"continue". Built on `commitments`: migration `20261015120000_commitments`;
pure `lib/vendors/commitments.ts` (`openAmount`, `receivedAmount`,
`commitmentForExpense`, `canMoveStatus`); `commitment-service.ts`
(`openCommitmentsByJob` as the one definition); `computeCostSummary` takes
`commitmentsOpen` and returns `laborCommittedOpen` / `commitmentsOpen` /
`committedOpen`; `getFinancialSummary` and the Overview's cost line now agree
with it; routes for a job's commitments and one commitment; `commitmentId` on
the expense PATCH; auto-link on the manual create and the cc-allocator intake;
`CommitmentsPanel` as Money → Commitments; cost card split and "View
commitments"; C-n tag and pick on expenses; "+ $x committed" on budget lines;
Commitments card on the vendor page. Decided while building: existing expenses
are not linked when a commitment is created (it is for what has not been paid
yet), and the vendor cannot change once an expense is linked. Gate: typecheck
clean, lint 5/22, 1419 tests (+10), build clean. Dev QA: API 33/33 (a $10,000
commitment raised committed by $10,000 and lowered projected profit by
$10,000; a $4,000 expense moved it to spent with the total unchanged),
headless Chromium 20/20 at 1280 and 400 px, SALES_REP read-only / 404 / 403;
fixed in QA: the panel's tiles counted a closed commitment. Dev DB restored.
**Deploy carries a migration.** Details:
[features/vendors.md](docs/project-memory/features/vendors.md).
Richard pushed and deployed from `!` (background, 256 s, exit 0): BUILD_ID
`DcJXs_PTMUJdAIU9AJO2p` → `xqCVJVDrq3De9dtsbMCfy`, migration
`20261015120000_commitments` applied (82; `commitments` with its unique
`(job_id, number)` index, `job_expenses.commitment_id` nullable), smoke 307
×2, zero journal errors since the restart, `UPLOADS_DIR` carried, 21 files in
the store, backup `postgres-2026-10-03-194329.dump`. Cost inputs identical
before and after (26 jobs, labor $1,521,951.31, approved expenses
$798,991.29, unposted field labor $8,944.00); the cost loader run read-only
on prod: 0 open commitments, committed $2,332,236.60 = spent $1,144,189.60 +
labor not yet paid $1,188,047.00. One figure moved, as expected: JOB-00002's
Overview "Cost to date" rose $2,350 because its crew has been paid $17,380
against labor contracts of $15,030 and the Overview now counts what was paid
— worth Richard's look (a missing labor change order, or a payment on the
wrong contract).

### 2026-10-03 — Audit initiative 6, Stage 2: compliance documents + expiry alerts (deployed `45899b2`)

"continue". Built on `vendor-compliance`: migration
`20261014120000_vendor_documents`; pure `lib/vendors/compliance.ts`
(`deriveCompliance`, `docInForce` — the most recently filed document of a
requirement is the one in force) and `alerts.ts` (expiring inside 30 days →
HIGH, due 14 days before; lapsed → URGENT, replaces the reminder);
`alert-run.ts` (owner = the person set under Vendors → Accounting role default
→ oldest admin; raise once per key; settle on every document write);
`documents.ts`; routes for documents, settings and the cron; `Task.vendorId`
through `createTask`, the task include and `subjectLabel` (kind `vendor`);
Compliance card, document dialog, badge / callout, owner control; warning on
the labor contract card and add form; attention row `vendor-compliance`;
calendar overlay `vendor_doc`. One addition to the plan, from Richard's answer
"a task 30 days before expiry and again when it lapses": the second, URGENT
task. Gate: typecheck clean, lint 5/22, 1409 tests (+14), build clean. Dev QA:
API 39/39, headless Chromium 23/23 at 1280 and 400 px, SALES_REP 403s; found
and fixed in QA: the vendor page's cards ran past the right edge at phone
width (grid children needed `min-w-0`). Dev DB restored. Not exercised: the
assignment email and the oldest-admin fallback. **Deploy carries a
migration.** Details:
[features/vendors.md](docs/project-memory/features/vendors.md).
Richard pushed and deployed from `!` (background, 256 s, exit 0): BUILD_ID
`5x6HE43-USWkCl1cgP0Zn` → `DcJXs_PTMUJdAIU9AJO2p`, migration
`20261014120000_vendor_documents` applied (81; `vendor_documents`,
`vendor_settings`, `tasks.vendor_id` nullable), smoke 307 ×2, zero journal
errors since the restart, `UPLOADS_DIR` carried, 21 files in the store, backup
`postgres-2026-10-03-192156.dump`. Then `crm-cron/vendor-compliance.sh` +
crontab `50 11 * * 1-5` installed as `knuco` (crontab copy
`/home/knuco/crontab.bak-20261003-vendor`), run twice by hand →
`{"vendors":0,"expiring":0,"expired":0}` 200 both times; no secret → 403. Prod
has 0 vendors and no Accounting role default, so expiry tasks fall to the
oldest admin (Richard) until an owner is chosen on the Vendors page.

### 2026-10-03 — Audit initiative 6, Stage 1: vendor record + payee matching (deployed `ec88e96`)

"continue where i left off". A plan from earlier the same day existed
(`abundant-scribbling-kahn.md`, nothing built); it was re-planned with a fresh
read-only prod check and four amendments (labor contracts get their own vendor
link because 5 of 11 are typed by name; the Unmatched tab lists crews and
contract labels; expiry tasks fall back to the Accounting role default before
the oldest admin; commitments never route through `Job.laborCost`, and the two
cost formulas outside the summary get switched to it in Stage 3). Richard
approved. Built Stage 1 on `vendors`: schema + migration
`20261013120000_vendors`; pure `lib/vendors/match.ts` (pattern at a word
start, open end, longest wins), `access.ts`, `service.ts`, `validation.ts`;
seven routes under `/api/vendors`; matching in the cc-allocator intake, manual
expense create and expense PATCH; `vendorId` accepted on the crew and labor
contract PATCH, typed contracts matched on create; `/vendors` and
`/vendors/[id]`; vendor suggestions and vendor links in the expenses panel;
vendor line on crew cards and labor contract cards; sidebar entry; ⌘K group;
`scripts/link-expense-vendors-2026-10.ts`. Gate: typecheck clean, lint 5/22,
1395 tests (+8), build clean. Dev QA: API 31/31, headless Chromium at 1280 and
400 px with no console errors, SALES_REP 403s, backfill 3 → 3 → 0; dev DB
restored from a dump. Nothing is seeded: after the deploy the directory is
built from Vendors → Unmatched (prod: 86 payee strings, 11 crews, 4 typed
contractor names). Details:
[features/vendors.md](docs/project-memory/features/vendors.md).
Richard pushed and deployed from `!` (the deploy ran past the shell's 120 s
timeout into the background and finished exit 0, 256 s): BUILD_ID
`PmFnvrNoVx2_HApQwqCDx` → `5x6HE43-USWkCl1cgP0Zn`, migration
`20261013120000_vendors` applied (80; `vendor_id` nullable on `job_expenses`,
`crews`, `labor_contracts`), smoke 307 ×2, zero journal errors since the
restart, the process carries `UPLOADS_DIR`, 21 files in the store, backups
`postgres-2026-10-03-184726.dump` + `uploads-2026-10-03-184726.tar.gz`. Prod
after: 0 vendors, 456 expenses, 0 linked — as designed.

### 2026-10-03 — Audit initiative 5: attention dashboard (deployed `9b75536`)

"continue". Built on `attention-dashboard`: pure `lib/attention/rows.ts` (12
rows with explicit role lists, thresholds, `visibleAttention`), `load.ts` (one
`where` per row, read by both its count and its list), `GET /api/attention`
and `/api/attention/[key]`, `NeedsAttention` at the top of the dashboard, the
list page `/attention/[key]` (Mine | All), and the dashboard reordered:
attention → Today / My tasks → Workflow health → Sales (four tiles + charts,
with an error state instead of zeros). The two overdue tiles became rows.
Gate: typecheck clean, lint 5/22, 1387 tests (+7), build clean. Dev QA by API
with staged rows (count = list for every row that had data, both scopes;
SALES_REP forced to Mine, 403 on the office-only lists) and headless Chromium
at 1280 and 400 px, no console errors; QA rows removed. Not exercised at
runtime: the list rows for contracts, violation cases, inspections to correct
and quiet jobs (no dev data). No migration. Digests were not switched on: SPF
is still deferred. Details:
[features/attention-dashboard.md](docs/project-memory/features/attention-dashboard.md).
Richard pushed; the deploy was run from the session at his request, in the
background (248 s): BUILD_ID `Jz-SkZNZkAW6myqxzsKMy` → `PmFnvrNoVx2_HApQwqCDx`,
no migration, smoke 307 ×2, journal clean, uploads intact (21 files), backup
`postgres-2026-10-03-151438.dump`. Prod check with a temporary read-only
script (removed): count = list on every row, both scopes. Prod as ADMIN / All:
12 overdue tasks, 1 permit not issued (JOB-00002's, 397 days), 19 overdue
follow-ups, 10 daily logs to review (oldest Aug 11), 15 deposits missing, 0
quiet jobs, 0 on the other six.

### 2026-10-03 — Initiative 4 deployed (`9cd2aba`); the deploy's build was cut off and finished by hand

"continue where we left off". `main` was already pushed and Richard's deploy
from `!` had run backup (`postgres-2026-10-03-142612.dump`), rsync, `npm ci`
and the migration (79, up to date) — then the remote build died at the
compile stage two minutes in (the `!` shell's 120 s timeout), leaving no
`BUILD_ID`, no `.deploy-sha` and the old process running over a half-written
`.next`. Finished on the droplet: `npm run build` under `nohup` (log
`/home/knuco/build-20261003.log`, clean), restart, `.deploy-sha` written.
BUILD_ID `Jz-SkZNZkAW6myqxzsKMy`, smoke 307 ×2, zero journal errors since the
restart, process carries `UPLOADS_DIR`, `job_permit_inspections.task_id`
present. Then: `crm-cron/permit-aging.sh` + `inspection-reminders.sh`
installed with crontab lines `40 11` / `45 11 * * 1-5` (crontab copy
`/home/knuco/crontab.bak-20261003`); retirement script dry run (18 active
rules, 4 pending) → `--yes` (18 switched off, 4 cancelled) → re-run 0 / 0;
crons by hand: permit-aging raised one 14-day task (JOB-00002, permit
#BD23-016647-001, "still not issued after 397 days", HIGH, assigned to
Richard, one notification row), second run raised 0; inspection-reminders
scanned 0; no secret → 403. **Lesson: a deploy from `!` can be killed by the
shell timeout mid-build — if `BUILD_ID` is missing afterwards, run the build
detached on the droplet and restart.**

### 2026-10-03 — Audit initiative 4, Stage 3 finished: permit follow-ups as tasks, fee shown from costs (built, dev-QA'd, on `main`, not deployed)

"continue on the next phase". Read-only prod check first: 18 active permit /
inspection follow-up rules (9 of them customer emails), 4 executions PENDING
since 09-28, and **the rule processor was never on the crontab — nothing was
ever sent**; 2 permits (both Applied, JOB-00002 submitted 2025-09-01), no
inspections, no fee typed on any permit, 3 `PERMIT_FEE` expenses ($1,298.13).
Richard ruled: tasks + digests for staff, no customer emails, show the fee
and create nothing. Built: pure `lib/permits/alerts.ts` + `alert-run.ts`
(waiting 7 days → coordinator, 14 days → PM and the 7-day task is cancelled,
expiring within 30 days → PM, "Be ready" the working day before an inspection
→ superintendent; once per source key, closed by the record through
`settlePermitAlerts` / `settleInspectionAlerts`); both cron routes rewritten
on it (`inspection-reminders` is daily now); every `emitPermitEvent` /
`emitInspectionEvent` call removed; the rules page marks those triggers
retired; `scripts/retire-permit-follow-up-rules-2026-10.ts`; `feeCharges` on
the job permits route + "Permit fees paid" card ("Permit fee quoted" on the
form); permit number in the job search and ⌘K. Gate: typecheck clean, lint
5/22, 1380 tests (+13), build clean. Dev QA by API on JOB-00001 (crons 403
without the secret; run 1 raised 1/1/1 + 1 inspection task, run 2 raised 0;
issuing, re-submitting, moving and passing each closed its task with the
reason; a passed final closed the permit and its expiring task; no rule
execution queued; search by permit number found the job) and the fee card in
headless Chromium at 1280 and 400 px, no console errors; dev DB restored;
retirement script on dev: 18 switched off, re-run 0. Not exercised: the
assignment email itself (dev's owner was a muted seed user), and the fallback
to the oldest admin. On prod the first run will raise one HIGH task for
JOB-00002's permit (waiting since 2025-09-01) unless that job is closed.
**Deploy carries the Stage 1 migration.** Details:
[features/permits.md](docs/project-memory/features/permits.md).

### 2026-10-03 — Audit initiative 4: permits and inspections as one record (Stages 1–2 and part of 3 built, dev-QA'd, on branch `permits-one-record`, not deployed)

"start initiative 4". **Stage 1 (backend):** pure `lib/permits/rules.ts`,
`effects.ts`, `service.ts`; `JobPermitInspection.taskId` (migration
`20261012120000_permit_inspection_task_link`). A status change stamps the
issue / final-passed dates; a permit inspection result runs the workflow path
on the matching active inspection step (fail → BLOCKED + correction task; a
pass completes single-inspection steps, "Rough inspections" only on a tick,
"Final inspection passed" once every permit is Final), or raises a plain HIGH
correction task on the job when there is no step; a result recorded on a
workflow step is filed on the permit (booked inspection of that kind, else a
new row on the job's one live permit); a passed final closes the permit and
settles the gates. Permit and inspection routes validate type / result /
status / dates / fee and use `guardJob` on the permit's job. **Stage 2 (UI):**
shared `components/permits/*` (editor + inspections panel with a result
dialog that names the step and says what will happen) on the job's Permits
tab and in the Permit Center drawer; Permit Center gets an Expired column, an
Inspections tab (`GET /api/inspections`), names instead of raw ids, and a
real error toast; Field → Inspections (dead `Inspection` table) and its route
are retired, old links land on Permits. Gate: typecheck clean, lint 5/22 (one
old error went with the old page), 1364 tests (+31), build clean. Dev QA by
API (both directions, validation 400s / 404, re-inspection after a
correction, standalone correction, final closes the permit) and in headless
Chromium (`qa-permits-ui.js` 17/19 — the two misses were the script reading
before the refetch; both confirmed on the screenshots); dev DB restored from
a dump afterwards. Not exercised: a SALES_REP session against another job's
permit (the guard is `guardJob`, tested in Foundation). **Deploy carries a
migration.** **Stage 3, the part needing no ruling, built the same day**:
`permit_date` calendar overlays ("Permit expires", "Permit approval
expected") and `permit-aging` moving a lapsed permit to EXPIRED (dev: week
view returned both overlays; cron `expired: 1`, second run 0; 1367 tests).
The two open rulings (cron mail, permit fee) were made the same day — see the
entry above. Details:
[features/permits.md](docs/project-memory/features/permits.md).

### 2026-10-02 — Crew payment requests + assignable labor-contract lines (deployed `7b1b3a7`)

Richard, plan mode: under Field, tasks should be assignable to a person with
an email, or go automatically to the accountant. He chose labor-contract
tasks and crew payment requests, defaulting to the job's accountant. Built:
`LaborPaymentRequest` + four columns on `LaborContractTask` (migration
`20261011120000_labor_payment_requests`); `lib/labor/payment-requests.ts`,
`schedule-task-link.ts`, `payment-math.ts`; `userForJobRole` in
`workflows/roles.ts`; routes for requests and `requestId` on recording a
payment; `components/jobs/labor-payment-requests.tsx` on each contract card;
owner + due date + "Request this payment" in the schedule dialog; a link from
the task sheet to Field → Labor; Overview row and timeline events. A request
is an ordinary HIGH task for the accountant that closes when the payment is
recorded against it. Found in dev QA and fixed: the task-closed hooks were
first placed in `onTaskTransition`, which only runs for workflow tasks — they
now sit in `updateTask` beside the field-issue sync. Gate: typecheck clean,
lint 6/22, 1333 tests (+11), build clean (a stale `.next` from the dev server
failed the prerender of `/leads/new` until the folder was cleared). Dev QA by
API on a throw-away contract: request → accountant's task (HIGH, due on the
needed-by day) → payment recorded → request PAID, task done, Spent +$500;
withdraw; task closed by hand → "closed, no payment recorded"; line owner →
task, both directions of completion; a covered line cannot be requested twice
(409); card and both dialogs viewed in headless Chromium. Not observed: the
email itself (dev's accountant is a muted seed user). **Deploy carries a
migration.** Details:
[features/labor-payment-requests.md](docs/project-memory/features/labor-payment-requests.md).
Richard pushed and deployed from `!`: BUILD_ID `1GuzX67ZxlMMr8L2VKeV-`,
migration `20261011120000_labor_payment_requests` applied (schema up to date;
table and the four columns verified), smoke 307 ×2, zero journal errors since
the restart, uploads intact (8 of 8), backup
`postgres-2026-10-02-183410.dump`. Prod still has no Accounting default under
Workflow Roles, so on jobs without a workflow the request dialog asks for a
person.

### 2026-10-02 — Labor payments: nothing lost, made easier to find (deployed `c4e7c05`)

Richard: "I also do not see payments made on labor contracts anymore" (3001
SW 23 Ter, 3411 Sleepy Hill Road). Checked on prod, read-only: all 27
`labor_payments` rows are intact (JOB-00002: 6 payments, $17,380; JOB-00014:
4 + 2), none deleted, and Job → Field → Labor lists them as before — no code
touched that panel. What changed today is that the job opens on Overview, and
neither it nor the Money tab mentioned crew payments. Added: labor payments in
the Overview's Recent activity (`labor_payment` events linking to Field →
Labor) and a "View labor contracts and payments" link under Spent on the Cost
summary card. Gate: typecheck clean, lint 6/22, tests green, build clean.
Richard pushed and deployed from `!` (with the My-jobs change): BUILD_ID
`9jussQ-th_vyn1X9ELMek`, no migration, smoke 307 ×2, zero journal errors
since the restart, uploads intact (8 of 8), backup
`postgres-2026-10-02-160454.dump`.

### 2026-10-02 — "My jobs" includes jobs where you own a workflow step (deployed inside `c4e7c05`)

Richard: "When the accountant role is selected for that user that job should
be on their job list." A workflow team slot already put a job in "My jobs"
(prod: Elizabeth holds the ACCOUNTING slot on all 9 workflow jobs). The gap
was a role filled from the company defaults (Admin → Workflow Roles): the
person is handed that role's steps on every job but holds no slot, so none of
those jobs were "theirs" — and jobs created at Won since `4558cbd` carry no
slots but the sales rep's. `jobsInvolvingUserWhere` now also counts an open
workflow step assigned to the user. It flows to every reader of the rule: the
Jobs list and board, leads Mine, dashboard Mine, the calendar's My calendar
overlays, by-id access for SALES_REP / CREW_LEAD, files and notification
permissions. Field mode's "My Jobs" is unchanged (PM or field-assigned).
Gate: typecheck clean, lint 6/22, 1322 tests, build clean. Dev: a manager
with accounting steps on JOB-00004 through the role default and no slot now
gets it under `scope=mine` (was absent before the change). No migration.

### 2026-10-02 — Audit initiative 3: one progress system (deployed `4558cbd`)

"continue". (1) **A new job starts with its workflow**:
`lib/workflows/auto-apply.ts` (`autoApplyWorkflowForNewJob`, pure
`suggestTradeKeys`) — `createJobFromLead` applies Core plus the trades the
lead's services point at, permit UNDETERMINED, the lead's rep in the SALES_REP
slot; the stand-alone "Collect deposit" task is raised only when no workflow
could be applied. Applies to the single and the bulk Won routes. (2) **The
stage follows the workflow**: `lib/workflows/stage-sync.ts` — pure
`stageNameForWorkflow` (verify_deposit → Financing Cleared, precon_plan →
Scope Finalized, submit_permit_application → Permit Submitted,
confirm_permit_issued → Permit Approved, confirm_production_start → In
Progress, punch list reached → Punch List, punch done + inspection open →
Final Inspection, final invoice done → Final Payment Due, close_job → Closed;
COMPLETED only, a skipped step proves nothing) and `syncJobStageFromWorkflow`
called from `onTaskTransition`; forward only, through `changeJobStage`
(reason "Moved by the workflow"), a hand-set later stage is left alone, jobs
without a workflow are untouched. (3) **Held facts tick themselves**:
`gates.ts` `linesToTick` / `tickHeldFacts` — "Project manager set on the
job", "Superintendent / field lead set on the Workflow team", "Target start
date set on the job", "Permit added / closed on the Permits tab", "Job moved
to the Closed stage" — run inside `settleJobGates`, on apply, on a team save
and on a job PATCH. (4) **PM and sales rep on the Team card**:
`components/jobs/team-person-field.tsx`; `PATCH /api/jobs/[id]` now upserts /
clears the matching workflow team slot and settles the gates. No migration.
Gate: typecheck clean, lint 6/22, 1322 tests (+14), build clean (first build
after killing dev failed on `.next` contention; the re-run was clean). Dev QA
end to end on a throw-away lead: Won → JOB with core + roofing +
doors_windows, 24 steps, no deposit task → PM set (slot written, line ticked)
→ deposit recorded (gate completed, stage Deposit Needed → Financing
Cleared); Team card viewed in headless Chromium; QA rows deleted. **Not
built** (deferred from the plan): generating a contract on the lead before
Won — `CustomerContract.jobId` is required, so it needs its own design.
Completing "Close the job" now closes the job, which sends the review-request
email as a manual move to Closed always did.
Richard pushed and deployed from `!`: BUILD_ID `NrwssgzE8M0lgWvTt5zOn` →
`3S1UF2Qayh1oZ828e8Am-`, no migration, smoke 307 ×2, zero journal errors since
the restart, uploads intact (8 of 8), backup
`postgres-2026-10-02-155021.dump`.

### 2026-10-02 — Audit initiative 2: job cost summary (deployed `389a124`)

"continue and follow recommendation regarding labor count": crew labor counts
when the labor contract is signed; the unpaid part is shown as committed.
Pure `lib/jobs/cost-summary.ts` (`computeCostSummary`: original / revised
contract, estimated cost from the budget or the signed estimate, spent,
committed, remaining, projected profit and margin, over / under billed);
`lib/services/job-cost.ts` (`getJobCostRows`, `getJobCostSummary`);
`Job.originalContractAmount` (migration `20261010120000_job_original_contract`
with a backfill from signed contracts; set at signing, cleared on void);
`GET /api/jobs/[id]/cost-summary`; the financial report returns `jobCosts`.
UI: a Cost summary card on the job's Money tab, the Budget sub-tab on every
job type, the Overview's projection and over-budget row, and "Job costs and
projected profit" on Collections in place of the profitability table. A job
with neither a budget nor a cost shows no profit rather than 100%. Gate:
typecheck clean, lint 6/22, 1308 tests (+10), build clean. Dev QA: the new
committed figure equals the old Collections cost on all 5 dev jobs; card,
Budget tab and Collections table viewed in headless Chromium, no console
errors. **Deploy carries a migration.** Details:
[features/job-cost-summary.md](docs/project-memory/features/job-cost-summary.md).
Richard pushed and deployed from `!`: BUILD_ID `dEhUKikVuIWutnVYetsDj` →
`NrwssgzE8M0lgWvTt5zOn`, migration `20261010120000_job_original_contract`
applied (schema up to date; column nullable; backfill touched 0 jobs — prod
has no signed customer contract yet), smoke 307 ×2, zero journal errors
since the restart (the old process logged module-not-found errors while the
build rewrote the app under it, as on every in-place deploy), uploads intact
(8 of 8), backup `postgres-2026-10-02-153533.dump`. On prod 3 of 17 open
billable jobs have a budget; 2 carry labor equal to the whole contract.

### 2026-10-02 — Audit initiative 1: Job Overview tab (deployed `9bbb34c`)

The job page now opens on **Overview** (`?tab=overview` is the default; every
existing `?tab=` link is unchanged). Pure `lib/jobs/health.ts`
(`deriveJobHealth`: On track / At risk / Delayed / Not started / Closed with
reasons, derived on read) and `lib/jobs/timeline.ts` (`mergeTimeline`);
`lib/jobs/overview.ts` `loadJobOverview` gathers workflow summary, open
tasks, permits and next inspection, money (cost in the same three streams as
Collections), awaiting items and a 20-row activity timeline from the tables
that carry the job; `GET /api/jobs/[id]/overview`;
`components/jobs/job-overview.tsx`. On phones the tabs now come before the
customer / team / pricing cards and the four money cards sit two across. No
migration. Gate: typecheck clean, lint 6/22, 1298 tests (+11), build clean.
Dev QA in headless Chromium at 1280 and 400 px on JOB-00001 (no console
errors; "Open money" navigates; the Workflow tab still loads). Details:
[features/job-overview.md](docs/project-memory/features/job-overview.md).
Richard pushed and deployed from `!` (with Foundation (c)): BUILD_ID
`rol5mL5vu49ynynjCUQ1E` → `dEhUKikVuIWutnVYetsDj`, no migration, smoke 307
×2, journal clean, backup `postgres-2026-10-02-151219.dump`; the process
still carries `UPLOADS_DIR`, and all 8 referenced files are in the store.
**Foundation is complete.** Richard's click-through pending: open any job
(lands on Overview), Reports funnel ≤ 100%, Collections deposits list.

### 2026-10-02 — Foundation (c): number fixes + the last open routes (deployed inside `9bbb34c`)

"continue". **Numbers:** (1) the conversion funnel is counted per lead —
pure `src/lib/reports/funnel.ts` `computeFunnel`: a lead reached a step when
it ever stood at that stage or a later progress stage (Lost and On Hold are
not progress), so no ratio passes 100% (was 400% on prod); the stage
distribution chart is unchanged. (2) Collections: "Deposits Missing" skips
closed jobs; "All Balances Due" lists open jobs first and the Outstanding
tile says how much sits on closed jobs. (3) One overdue rule: new
`isPastDue(dueAt, allDay)` beside `isOverdue` in `lib/calendar/status.ts`,
now used by the tasks page buckets, task card, entity task panel, workflow
row and panel chip, the job page Tasks badge, `lib/tasks/summary.ts`
(`dueBucket` on the office day), `lib/workflows/{summary,read,reports}.ts`,
and as `overdueWhere` in `jobs/query.ts` (`workflowOverdue`) and the
`/api/jobs` task counts — an all-day task due today is no longer overdue
anywhere. (4) Bulk "Move to stage: Won" now calls `createJobFromLead` like
the single route and returns `jobsCreated`. (5) Contract signing keeps
approved billable add-ons: `computeMoneyEffects` takes
`approvedBillableExpenseTotal` (base + approved change orders + approved
billable expenses). **Routes:** `guardLead` on the lead's activity, both
estimate families (PDF generation counts as a read), permits and Roofr
orders; `guardProspect` (lead-writing roles; a sales rep only their own) on
prospects by id, promote and door-knocks; `guardLeadCreate` on lead /
prospect create, prospect bulk and review create; `guardReferrals`
(ADMIN / MANAGER) on referrals. Gate: typecheck clean, lint 6/22, 1287 tests
(+7), build clean. Dev QA by API: funnel max 100%, overdue filters and the
pages load as ADMIN; as SALES_REP own lead's estimates and activity 200,
another lead's 404, referrals 403. No migration. Not exercised on dev: bulk
Won (would create jobs) and a signing with a billable add-on (unit-tested).
**Foundation is complete once this is deployed**; next is initiative 1, the
job Overview tab.

### 2026-10-02 — Foundation: upload store moved out of the app folder + guards on lead, job, permit and change-order routes (deployed `45d5604`)

"continue". **Uploads:** `src/lib/files/storage.ts` reads `UPLOADS_DIR`
(absolute path; unset = `./uploads`), declared in `env.ts`. After this is
deployed the droplet's store moves to `/var/lib/knuco/uploads` and joins the
nightly backup. **Guards:** pure `src/lib/access/roles.ts` (`canWriteLeads` =
ADMIN / MANAGER / OFFICE_STAFF / SALES_REP / MARKETING; `canWriteProduction`
= the first four; `canDecideChangeOrder` = ADMIN / MANAGER, replacing the
last `hasMinRole` on change orders; `isOwnOnlyRole` = SALES_REP, CREW_LEAD)
and `src/lib/access/records.ts` (`guardLead`, `guardLeads`, `guardJob`,
`guardJobs`, `guardProductionWrite`, `leadAccessWhere`, `jobAccessWhere`).
An own-only role now opens by id only what its lists show — leads assigned
to it, raised by it, or the customer of one of its jobs; jobs it has a role
on — and anything else answers 404. Applied to `api/leads/[id]` (+ stage,
notes, communications, bulk-stage), `api/jobs/[id]` (+ stage, bulk-stage,
crews, permits, change-orders, and the GETs for payments, invoices, budget,
labor contracts, expenses), `api/permits/[id]` (+ inspections),
`api/inspections/[id]`, `api/change-orders/[id]` (+ send). `GET /api/permits`
is scoped to the viewer's jobs and an unknown `status` is a 400 (was a 500);
`PATCH /api/permits/[id]` validates status and 404s a missing permit. Gate:
typecheck clean, lint 6/22, 1280 tests (+4), build clean. Dev QA by API as
SALES_REP (own lead / job 200, others 404, bulk stage 403, bad permit status
400) and ADMIN (all reads and pages 200). No migration. **Still session-only:**
prospects, referrals, both estimate route families, lead create, daily-log
and field routes with their own guards untouched.
Richard pushed and deployed from `!`: BUILD_ID `ClLUJA-KTPisCzUOy_FFC` →
`rol5mL5vu49ynynjCUQ1E`, no migration, smoke 307 ×2, backup
`postgres-2026-10-02-144826.dump`. **Then the store was moved on the
droplet:** `rsync -a /opt/knuco/uploads/ /var/lib/knuco/uploads/` (21 files,
owner `knuco`), `UPLOADS_DIR=/var/lib/knuco/uploads` appended to
`/etc/knuco/env` (copy kept as `env.bak-20261002`), `knuco` restarted (active,
the process carries the variable, 307 ×2, all 8 referenced files present at
the new path, `knuco` can write there). `/usr/local/bin/knuco-backup.sh`
(run by `knuco-backup.timer`, daily 06:31 UTC, and before every deploy) now
also writes `uploads-<ts>.tar.gz` with the same 14-day retention (copy kept
as `.bak-20261002`); run once by hand: success, 21 files in the archive. The
old `/opt/knuco/uploads` is left in place, unused. The backup is on the same
droplet as the files.

### 2026-10-02 — Foundation (b): role checks + audit on money and file routes (deployed `9daf99e`)

First build from the approved audit roadmap. Richard approved the role list
(ADMIN / MANAGER / OFFICE_STAFF for money writes). New pure
`src/lib/money/access.ts` (`canManageJobMoney`, `canViewCompanyFinancials` =
money roles + READ_ONLY, `canEditJobRecord` = money roles + SALES_REP,
`touchesJobMoney`) guards every write handler under `api/payments`,
`api/jobs/[id]/payments`, `api/jobs/[id]/invoices`, `api/invoices/[id]`,
`api/labor-contracts/**`, `api/labor-change-orders/**`,
`api/labor-contract-tasks`, `api/labor-payments`, `api/budget-lines`,
`api/jobs/[id]/budget/{lines,import}`, `api/expenses/[id]/budget-allocations`
and the QBO export; `PATCH /api/jobs/[id]` needs `canEditJobRecord`, and its
pricing fields need the money roles (audit `pricing_update` with before /
after); `GET /api/reports/financials` needs `canViewCompanyFinancials`.
Payment create / edit / delete and labor-payment delete now write
`AuditEvent`s; payment POST validates type and amount. `src/lib/files/access.ts`:
`fileReadWhere` (SALES_REP / CREW_LEAD read their uploads, files on leads
and jobs they are involved with, their tasks and their cases; outside that a
file is 404) on `GET /api/files` and `GET|DELETE /api/files/[id]`;
`canDeleteFile` (office roles any ordinary file, others only their own
upload, READ_ONLY none, `CUSTOMER_CONTRACT` never); file delete audited and
row-before-disk; READ_ONLY cannot upload. **Deposit drift fixed in the same
pass**: `recomputeJobBalance` now derives `depositReceived` /
`depositReceivedDate` from RECEIVED deposit payments (prod had no mismatch
on the day, checked read-only), and `recordPayment` no longer increments.
UI: Collections nav entry and page limited to the financial-report roles
(the page crashed on a 403 before); a "View only" note on the job's Money /
Field tabs for non-money roles. Reads of a job's payments, invoices and
budget are unchanged. Gate: typecheck clean, lint 6/22, 1276 tests (+12),
build clean. Dev QA by API as ADMIN (deposit 500 → edit 300 → delete moves
the deposit figure 8000 → 8500 → 8300 → 8000; three audit rows) and as
SALES_REP (403 on payment, contract, invoice, budget, labor contract, QBO
export, financial report; 200 on next-action edit and payment read; 404 on
another person's file; 403 deleting a contract document). No migration.
**Not yet guarded** (next): lead and job stage routes, lead by-id, permits
and inspections, change-order create / send (still `hasMinRole` on
decision), prospects, estimates. Server check for the 190 missing uploads:
the nightly backup is DB-only and the attached volume holds only Postgres —
no copy on the droplet; DigitalOcean panel backups are the last place to look.
Richard pushed and deployed from `!`: BUILD_ID `7b496oPUA25tYbcyDW1wY` →
`ClLUJA-KTPisCzUOy_FFC`, no migration, smoke 307 ×2, journal clean, backup
`postgres-2026-10-02-143823.dump`. **First deploy with the uploads exclude:
all 8 referenced files on prod survived it** (21 on disk = 8 real + 13 dev
leftovers).

### 2026-10-02 — Deploys were deleting prod uploads: script fixed, 7 files restored (not yet deployed)

Found during the product audit (doc: https://claude.ai/code/artifact/c50661ee-92a5-47aa-a581-f15fbcf4b25b).
`deploy.sh` ran `rsync --delete` with no exclude for `uploads/`, and the app
stores every upload in `/opt/knuco/uploads` (`src/lib/files/storage.ts`), so
each deploy replaced prod's uploads with the laptop's dev files. Measured on
prod: 198 stored files referenced (92 `files`, 106 `field_photos`), 1 on
disk. **Fix:** `--exclude=/uploads/` in the rsync step; a dry run of the same
sync now lists nothing under `uploads/`. **Restored** the 7 files the seven
retained pre-deploy tarballs still held (all `2026-09/*.pdf`; sizes match the
`files` rows; owner `knuco`, mode 600). **190 files remain missing** — the
only route is a droplet-level backup, not yet checked. 13 dev files are still
in prod's `uploads/` (unreferenced, harmless). Follow-ups in the audit's
Foundation block: move the store outside the app folder
(`/var/lib/knuco/uploads` exists, empty), add it to the nightly backup, show
a clear "missing on disk" state. Richard approved the whole MVP roadmap.

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

- **`knuconstruction.com` has two SPF records** (seen in DNS 2026-10-03):
  `v=spf1 include:_spf.mailersend.net include:secureserver.net -all` and
  `v=spf1 include:secureserver.net -all`. Two records are an SPF error to
  receivers, so this counts as "SPF not set" until the second one is deleted
  at the DNS host. Richard deferred it 2026-10-03; the nurture and escalation
  switches keep waiting on it.
- Delivery failures now escalate through `lib/email/delivery-report.ts`
  (ERROR log with marker `EMAIL_DELIVERY_FAILURE`, an `EmailDelivery` audit
  row, and a best-effort ops email). Read history at
  `GET /api/admin/email-health` — the channel that still answers when email
  itself is what is broken. Optional `OPS_ALERT_EMAIL`, else oldest active
  ADMIN.
- `PHONE_ROUTING_API_KEY` unset → that endpoint 503s.
- **Uploads live in `/var/lib/knuco/uploads`** (`UPLOADS_DIR`), backed up
  nightly beside the DB dump — on the same droplet, so not protection against
  losing the box. 190 older files are missing on disk (see known-issues).
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
# Permit follow-up crons, by hand (droplet; each alert is raised once)
ssh knuco-droplet '/home/knuco/crm-cron/permit-aging.sh; tail -1 /home/knuco/crm-cron/permit-aging.log'
ssh knuco-droplet '/home/knuco/crm-cron/inspection-reminders.sh; tail -1 /home/knuco/crm-cron/inspection-reminders.log'
# Business Development seed (idempotent; categories + lead source + settings, all create-only)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-partners.ts"'
# Coastal Choice backfill (dry run by default; --apply writes; --fix-billing only on Richard's word)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx scripts/backfill-partners-coastal-choice.ts"'
# JOB-00009's award as a bid record (dry run by default; --apply writes; idempotent)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx scripts/backfill-partners-bid-job00009.ts"'
# Permit Intelligence seed (idempotent; type catalog + the completed-application requirement, create-only)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-permit-intel.ts"'
# Link pre-existing permits to jurisdictions / types / cycle 1 (dry run by default; --apply writes; idempotent)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx scripts/backfill-permit-records-2026-10.ts"'
# Vault + qualification expiry cron, by hand (droplet; each alert is raised once)
ssh knuco-droplet '/home/knuco/crm-cron/company-document-alerts.sh; tail -1 /home/knuco/crm-cron/company-document-alerts.log'
# Partner follow-up cron, by hand (droplet; each follow-up is raised once per period; ?dryRun=1 plans only)
ssh knuco-droplet '/home/knuco/crm-cron/partner-follow-ups.sh; tail -1 /home/knuco/crm-cron/partner-follow-ups.log'
# Vendor document expiry cron, by hand (droplet; each alert is raised once)
ssh knuco-droplet '/home/knuco/crm-cron/vendor-compliance.sh; tail -1 /home/knuco/crm-cron/vendor-compliance.log'
# Link existing expenses to vendors (dry run by default; --yes applies; idempotent)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx scripts/link-expense-vendors-2026-10.ts"'
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
`UPLOADS_DIR` (absolute path of the upload store; set on the droplet so it
lives outside the app folder; unset = `./uploads`),
`MAILERSEND_INBOUND_SECRET` (signing secret of the MailerSend inbound route
that forwards bid invitations; unset = `/api/integrations/mailersend/inbound`
503s, pasting on Bid intake still works),
`ANTHROPIC_API_KEY` (shared AI layer `src/lib/ai`; unset = every AI action
503s "AI is not set up"), `AI_MODEL` (default `claude-opus-5-5`),
`AI_MAX_USD_PER_SUBJECT` (default `5`), `AI_MONTHLY_MAX_USD` (default `100`),
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
- **Every route answers to an explicit role list** (2026-10-02). Money
  writes (payments, lump-sum invoices, labor contracts and payments, budgets,
  a job's pricing): ADMIN / MANAGER / OFFICE_STAFF (`lib/money/access.ts`).
  Production records (job record and stage, crews, permits, inspections,
  change orders): those plus SALES_REP; leads and prospects add MARKETING
  (`lib/access/roles.ts`). SALES_REP and CREW_LEAD open by id only what their
  lists show (`lib/access/records.ts` — outside that is a 404). Files follow
  the same scope; contract documents are never deleted through the file
  route. New routes take a guard from these modules, never a bare session
  check and never `hasMinRole`.
- **A job's money is shown by `jobMoneyView`** (`lib/money/access.ts`, ruled
  2026-10-19): "full" for ADMIN / MANAGER / OFFICE_STAFF / READ_ONLY and the
  job's project manager; "price" (contract, invoices, payments, change orders —
  never cost, profit or crew pay) for a sales rep; "none" for crew leads and
  marketing. Money reads use `guardJobMoney(viewer, jobId, "price" | "full")`;
  a record carrying money goes out through `redactJobMoney` / `redactOverview`.
  `src/app/api/route-guards.test.ts` fails on a new session-only handler.
- **A job's price and cost come from its estimate** when one is picked at Won
  (or signed, or bid): `createJobFromLead` freezes the cost on the job
  (`estimatedCostSnapshot`), budgets each section at cost (`source "estimate"`,
  never over a typed budget) and marks the estimate Accepted. The cost summary
  reads the frozen cost, never a live estimate, and adds approved change orders'
  crew + other cost. With no estimate the lead's typed value is used, as before.
- **Money records change only with a trace.** An approved expense's amount,
  date, type or billable flag is changed by the money roles only; a sent
  invoice's amount is fixed (void and reissue); a change-order decision claims
  the row inside its transaction; an accepted estimate is never edited (Revise
  makes a draft copy). Each of these writes an AuditEvent.
- **Job costs are gated by role + the `canEnterJobCosts` grant** —
  ADMIN/MANAGER/OFFICE_STAFF implicitly, anyone else by explicit grant. Use
  **explicit role lists, never `hasMinRole`**, for anything financial:
  `ROLE_HIERARCHY` ranks SALES_REP above OFFICE_STAFF (Accounting).
- **A job is deleted only through `deleteJob`** (`lib/jobs/delete.ts`): ADMIN
  only, a reason, audited, and refused while the job carries money, field or
  contract records (kept strict — Richard, 2026-10-19). A new table that hangs real business records on a job adds
  a blocker there.
- **A job's cost and profit come from one calculation**
  (`lib/jobs/cost-summary.ts` via `lib/services/job-cost.ts`). Crew labor
  counts when the labor contract is signed; the unpaid part is "committed".
  New screens read `getJobCostRows` / `getJobCostSummary` — never their own sum.
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
- **The job stage follows the workflow** (`lib/workflows/stage-sync.ts`):
  forward only, COMPLETED milestones only, never on a job without a workflow.
  A new job is created with its workflow (`auto-apply.ts`). Do not add code
  that moves a stage back or that requires a person to restate a fact the
  job record holds — extend `linesToTick` in `gates.ts` instead.
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
- **Permit follow-ups are tasks, and a permit event never mails a customer.**
  The rule engine takes no permit or inspection event; new permit alerts go
  in `lib/permits/alerts.ts` (once per source key, closed by the record). The
  fee typed on a permit is a quote — it never becomes an expense; what was
  paid is read from the job's `PERMIT_FEE` costs.
- **Every write to a crew assignment calls `syncInstallTask`**
  (`lib/crews/install-run.ts`): an install date is a calendar overlay plus one
  get-ready task per date for the superintendent (else the PM), closed by the
  record. The crew itself is never emailed.
- **The roofing library is pure.** Nothing under `src/lib/roofing/parsing` or
  `src/lib/roofing/engine` imports Prisma, Next or the rest of the CRM; the
  database lives in `src/lib/roofing/service.ts`. A measurement the reader did
  not find is null, never 0. A person's correction keeps the report's own
  reading (`applyEdits`). Roofr's recommended waste is a suggestion and is
  never applied to a takeoff by itself.
- **Takeoff rules are code; `RoofRule` holds only the company's changes**
  (a number, or switched off — and off means the rule orders nothing). **Roofing
  prices are append-only and take effect by day** (`priceInForce`); a material
  is switched off, never deleted. Everything that prices a takeoff goes through
  `loadEngineInputs`. The price book and takeoff rules are ADMIN / MANAGER
  (`canManageRoofPricing`). Ruled 2026-10-19: cost and margin on a job's
  roofing estimate (P1) show to ADMIN, MANAGER and that job's project manager.
- **Every response is unframeable except the two documents the app frames
  itself** (`FRAMED_BY_SELF` in `next.config.ts`: the file route and the
  signing PDF, same-origin only). A new page that shows one of the app's own
  responses in an `<iframe>` must add its path there, and be checked in a full
  browser.
- **A file belongs to a job when it has `jobId`; a lead's file with none is a
  lead document** (shown on the lead and, in its own group, on the lead's
  jobs). Code that writes a `File` for something on a job sets `jobId`. A file
  a `GeneratedDocument` references is never deleted, renamed or replaced
  through the file routes — a signed agreement is stored as `SIGNED_DOC`, so
  the category alone protects nothing. A record whose file is missing is shown
  as missing and re-uploaded onto the same row, never hidden. New file links
  open `FilePreviewDialog`.
- **A commitment is a promise, not a cost.** Only its unspent part counts
  (`OPEN ? max(0, amount − Σ approved linked expenses) : 0`), and it reaches a
  job's numbers only through `computeCostSummary` (`commitmentsOpen`) — never
  through `Job.laborCost`, which sets what a cost-plus customer owes. Crew
  labor contracts are commitments of their own kind and are never copied into
  `Commitment`. New readers use `openCommitmentsByJob`.
- **A vendor's compliance is derived from its documents on read, never
  stored** (`lib/vendors/compliance.ts`): the most recently filed document of
  a requirement is the one in force. A gap warns wherever the vendor is used
  and **never blocks**. Expiry alerts are tasks raised once per document date
  (`lib/vendors/alert-run.ts`) and closed by the record — every document write
  calls `settleVendorAlerts`. A document never filed raises no task.
- **`JobExpense.vendor` is the payee as it arrived; `vendorId` is the match**
  (`lib/vendors/match.ts`, run wherever an expense is written). Never rewrite
  the text; payroll rows are never matched. A labor contract's vendor is its
  own link, else its crew's. Vendor routes use `canManageVendors` /
  `canViewVendors` (`lib/vendors/access.ts`).
- **Relationship health is computed on read, never stored**
  (`lib/partners/health.ts`, weights in `PartnerSettings.healthWeights`,
  versioned). Every reader goes through `loadHealth` in
  `lib/partners/scorecard-load.ts`; a new screen never sums its own. Money on
  partner pages (scorecard, analytics) is for `canViewPartnerMoney` roles and
  counts jobs active in the window. An account's `lastContactAt` only moves
  forward (`advanceLastContact`).
- **A bid's status is the master; its lead's stage only mirrors Won and
  Lost** (`lib/partners/bids.ts`). A `GC_BID` lead is never moved through the
  lead stage route (409) and never fires the lead event; an award creates the
  job through `createJobFromLead` with progress billing, 10 % retainage and no
  deposit. The bid / no-bid score is deterministic advice
  (`lib/partners/bid-score.ts`): a person decides (ADMIN / MANAGER), and the
  decision stores the score, its inputs and the weights version. Every bid
  route and list is lead-scoped (`bid-guard.ts`). A submission is a record:
  append-only, snapshotting the estimate's price and cost.
- **A dashboard attention row's count and its list share one `where`**
  (`lib/attention/load.ts`). A new row gets a role list in `rows.ts` and both
  a counter and a lister over the same builder — never two queries.
- **A GC account is an `Organization`, never a Vendor** (vendors are payees,
  matched against expense payees); an account that is also a payee links
  through `vendorId`. **A GC's bid package is a Lead of kind `GC_BID`**; the
  customer surfaces — `buildLeadListWhere`, nurture, follow-up rules, the
  overdue-follow-ups row, the dashboard and the funnel — filter on `kind`,
  and any new reader that means homeowners must add `kind: "CUSTOMER"`.
  Relationship stages are the `PartnerStage` enum; everything else about an
  account (quiet, prequalified, bidding, awarded) is derived on read
  (`lib/partners/derive.ts`). Account follow-ups are tasks raised once per
  source key by `lib/partners/follow-up-run.ts` and settled by every
  interaction or stage write; the CRM never emails a GC contact. Access through
  `lib/partners/access.ts` (SALES_REP manages; owner change, write-off, delete
  and settings are ADMIN / MANAGER). **KNU's own documents live in the vault**
  (`CompanyDocument`, own storage, never a `File` row): the current version of
  a type is the highest; a RESTRICTED document's bytes are encrypted under the
  field keyring and served only by `/api/company-documents/[id]/file`, which
  answers 404 to anyone outside `canReadDocument` (`lib/partners/vault-access.ts`)
  and audits every RESTRICTED read. Qualification and requirement states are
  derived on read (`qualification-state.ts`); the GC's answer is the only
  stored decision. Vault and qualification expiries are tasks raised once per
  key (`document-alert-run.ts`) and settled by every write.
- **An emailed bid invitation is never a bid until a person confirms it**
  (`lib/partners/itb-intake.ts`): every channel (paste, MailerSend inbound,
  Outlook) goes through `ingestItbEmail` into a `BidIntake`; the reader
  (`itb-parse.ts`) is deterministic and leaves what it cannot read empty; no
  due date or addendum count moves without the person ticking it. New intake
  channels call `ingestItbEmail`, never `createBid` directly.
- **A vault document leaves the CRM in a package only if a manager approved it
  for external distribution** (`lib/partners/package-plan.ts`): in date, on
  file, and RESTRICTED only for someone who may open it and asked for it —
  each such file audited as a `document_view`. The contents sheet the GC sees
  never states internal reasons.
- **A crew payment is counted once, on its labor contract.** The cost
  summary counts a labor contract in full from the day it is signed, so the
  same money arriving as an expense (a bank posting to the crew) is counted
  twice. Such an expense is REJECTED with `coveredByLaborPaymentId`
  (`lib/expenses/labor-cover.ts`); the intake holds a posting that matches a
  labor payment or pays a crew with a contract on the job; Cost
  Reconciliation → Crew payments decides. Never delete the bank row — it is
  cc-allocator's record.
- **A permit's submissions are frozen** (`lib/permit-intel/submissions.ts`): a
  package is a zip of exactly what was sent, with a sha256 per document and for
  the zip, and the files in it are locked (`permitLockOf`) — as are the
  approved permit and stamped plans. A correction is a new file in the next
  submission, never an edit. The permit's status follows the department's
  answer to a review cycle through `updatePermit`. Requirements are rows in
  `PermitKnowledge`, the most specific per document type winning; retired,
  never deleted. A PATCH schema never carries zod defaults.
- **A correction notice moves nothing until a person confirms it**
  (`lib/permit-intel/corrections.ts`): the AI's items are PROPOSED; confirming
  makes them tasks, answers the review cycle with corrections (the permit
  follows through `recordCycleOutcome`) and sets the resubmission due. An item
  is waived, never deleted, once confirmed; its task follows its status. The
  next review settles the earlier items (accepted, or carried by the comment
  that repeats them). An email about a permit is a draft until a person sends
  it (`messages.ts`), from the company sender with reply-to the person, and is
  recorded on the job's lead. The response letter is built from confirmed
  items only and refuses a blank response.
- **A permit form is filled from records, never from the model**
  (`lib/permit-intel/field-fill.ts`, `data-dictionary.ts`): the AI only says
  which dictionary key a blank form's field means, and a fixed value it
  proposes is kept only as one of a choice field's own options. Licence and
  qualifier fields come from the permit's QUALIFIER party or the company
  profile, else stay blank; signatures and notary blocks are never filled. A
  template belongs to its exact file and never changes once published (edit =
  next version). A fill is finalised only when no two records disagree.
- **A flat form's blanks come from the page, never from the model**
  (`lib/permit-intel/flat/detect.ts`): the AI only says which numbered blank
  is which; positions are found in the rendered pixels. Values are printed
  only from records, signatures and notary blocks never, a value that does
  not fit is reported rather than cut, and a template is checked against its
  filled preview before it is published.
- **A product approval's checks are advice** (`lib/permit-intel/approvals-plan.ts`):
  every flag carries "not an engineering determination"; the CRM never
  computes a required pressure (a person types the engineer's), never infers
  an expiry or HVHZ status, and an approval is relied on only once a person
  has checked its fields against the document (VERIFIED).
- **Preflight advises; a person decides** (`lib/permit-intel/preflight.ts`):
  the readiness score counts the rules only and is never a prediction of
  approval; the AI look adds warnings, never blockers, and only points that
  cite the package summary. A permit is marked ready with zero blockers or an
  ADMIN / MANAGER override with a reason (audited); freezing a package clears
  the mark. New permit checks are rules in `runPreflight` with a code, never a
  second engine.
- **A lesson is learned, never applied, until a person approves it**
  (`lib/permit-intel/knowledge.ts`): only comments the department accepted
  propose one, their particulars are scrubbed first, and only APPROVED lessons
  reach preflight — a warning only when the document its check names is not
  on the permit. Permit Center tiles carry the ids they count; a new tile is a
  line in `metrics.ts`, never a second query.
- **The CRM opens the web only through `safeFetch`** (`lib/permit-intel/web-fetch.ts`):
  the model never fetches — it picks numbered links, and links the fetcher
  would refuse are never offered. Every connection is checked at connect
  time (no private / reserved address), redirects re-checked, robots.txt
  honoured, every request logged (`PermitAssistFetch`); a fetched web page is
  never served back from the CRM. What the assistant finds is a proposal: a
  document joins the permit, with a type, only when a person accepts it.
- **Every model call goes through `runAiCall`** (`src/lib/ai/calls.ts`): it is
  recorded as an `AiCall`, held to the per-subject and monthly caps, has no
  tools, and must match a zod schema. Document text goes in through
  `untrustedDocument`. What the model returns is a proposal a person confirms —
  never a status change, a sent message, a licence number or a signature.
- **cc-allocator owns money that actually moved**; the CRM owns job costing
  including costs that have not moved yet. Expenses with an `externalId` are
  cc-allocator's record — ADMIN-only to delete here, and better fixed there.

## 10. Next Prompt

> **Audit roadmap: Stage A is on prod (`53871b5`); Stage B (the estimate drives
> the job) is on `main`, not deployed — the deploy carries migration
> `20261109120000_estimate_drives_job`.** After it: mark a lead Won from its page
> and pick the estimate; the job's Money → Budget shows the "from estimate" lines.
> **Stage B is on prod (`c1c6539`).** **Stage C (owner command center) is on `main`,
> not deployed (no migration).** After it: the dashboard's owner strip and the new
> rows (never contacted, estimates out, delayed, over budget). Next build: **Stage D —
> overdue control (by person, unowned steps, clean-up) + the lead call list.**

> **Plan takeoff M3 is on prod (`166a362`, BUILD_ID
> `U90VFCrDknZ6GfCb-zWQr`).** Click-through: a lead
> with the 3310 set → Plan takeoff → roofing takeoff → calibrate A-10 →
> Analyze with AI → tick A-10 only → review the dashed proposals and the
> Specifications card (~$0.35, shown under Admin → AI Usage). Next build: M4
> (AI plumbing). M5 must guard totals across roof plans that draw the same roof.

> **AI Permit Intelligence Stages 2, 3 and 4 are on prod (`da551cc`, BUILD_ID
> `6KAPwvK3Td9KNoioZBmQr`, 2026-10-19 00:26 UTC).** Stage 4 after it: Permits → Product approvals →
> add the NOAs / FL approvals KNU installs, check each, add them on permits'
> Products tabs. **Stage 5 (preflight) is on `main`, not deployed** (migration
> `20261105120000_permit_preflight`); after its deploy: a permit → Preflight →
> Run (try "with an AI second look") → Create tasks → Mark ready. **Stage 6
> (lessons + metrics) is on `main` too** (migration
> `20261106120000_permit_lessons`); after the deploy: Permit Center's tiles;
> Admin → Permits → Knowledge fills as the department answers resubmissions.
> **All seven stages are on prod (`2359e54`, BUILD_ID
> `C7dZ4cfftPCjy5oiFvv9z`, 2026-10-19)**; what remains is the click-throughs
> and the open ruling below. **The document assistant is on prod (`64e3c4d`,
> BUILD_ID `TLxVz6KDW9VoRZKRR74nA`)**; next: Admin → Permits → Jurisdictions → each department's website, then a
> permit → Documents → Document assistant → Sort documents…. **Filling found
> forms (fillable and printed) is on prod (`391efe1`, BUILD_ID
> `U5IBZ_zSrPTNhnC0nmT4x`)**:
> Make a fillable form → check the filled preview → publish → Forms tab. Stage 3 after it: After it: Admin → Permits → Forms → upload the
> Palm Beach County universal application (county "Palm Beach", from
> discover.pbc.gov) → Map with AI → check "Check these" and clear the
> office-use header → Publish; set each Palm Beach County jurisdiction's
> county; add the qualifier under a permit's Parties; on a permit → Forms →
> Fill → add the parcel number → Write the PDF → Finalise. Next build:
> **Stage 5** (preflight: deterministic readiness checks, optional AI review,
> the ready gate).

> **AI Permit Intelligence Stage 2 (corrections) is on `main`, not deployed;
> the deploy carries migration `20261102120000_permit_corrections`** (no seed,
> no cron). After Richard's push + deploy (if the `!` deploy's build is cut off
> again: rebuild on the droplet with `/etc/knuco/env` loaded and
> `ssh -n … < /dev/null`, then restart). Click-through: a permit with a
> submission → Corrections → Add a correction notice (a real letter) → check
> the items, Confirm → tick items → Email about… → Write the response letter →
> Submissions → Submit again; Documents → Suggest a type; Permits → Library.
> Next build: **Stage 3** (form filling) — needs Richard's sample blank
> applications (Palm Beach, Boynton Beach, Miami). Ruled 2026-10-19: confirming a
> notice / freezing a submission = office roles + the permit's coordinator.

> **AI Permit Intelligence Stage 1 (permit record) is on prod (`acdf728`,
> BUILD_ID `3SyklAeo2NGYbawokTWey`), seeded and backfilled (3 permits linked
> to their jurisdictions, types and cycle 1).** Click-through: Admin → Permits (county, HVHZ, the real
> requirements); a job → Permits → Open the permit record → Documents
> (upload with a type) → Submissions → Submit. Next build: **Stage 2**
> (corrections: AI extraction of a correction letter → confirmed items →
> tasks, drafts, response letter) — the queue change and the Permit Library
> come with it. Ruled 2026-10-19: office roles + the permit's coordinator.

> **GC Partnerships Phase 8a (prequalification package) is on `main`, not
> deployed (no migration; `npm ci` picks up `fflate`).** After Richard's push +
> deploy: an account → Qualification → Package — only documents marked
> "approved for external" in the vault go in, so approve the ones KNU sends.
> Still blocked: 5b (Bid Board Pro), 6 (volume), 7 (prod AI key + the takeoff
> AI layer).

> **GC Partnerships Phase 5 (bid intake) is on prod (`f4f39c3`, BUILD_ID
> `fq9IG_D9irXnQMsxcg7XR`).** Next: paste
> two or three real ITB emails on Business Development → Bid intake and check
> what was read; any field misread is a parser fixture to add. To have
> forwarded mail arrive by itself: MailerSend → Inbound routing → a route
> (its `…@inbound.mailersend.net` address) forwarding to
> `https://crm.careyos.com/api/integrations/mailersend/inbound`, its secret as
> `MAILERSEND_INBOUND_SECRET` in `/etc/knuco/env` + restart; then forward one
> invitation and watch it land. Check first that the MailerSend plan includes
> inbound routing.

> **GC Partnerships Stage 4 is on prod (`68bfb2f`, BUILD_ID
> `kRdp4GOoGpB0OBh-SM6ol`); all four stages are live.** Coastal Choice reads
> 15 / Dormant until its contacts, interactions and prequalification are
> entered. Richard's click-through: an account → Performance; GC Partnerships → sort
> by Health; Business Development → Analytics (by GC / trade, CSV); Admin →
> Business Development → Weights; the dashboard's Business development strip.
> That completes the four-stage plan.

> **GC Partnerships Stage 3 (bids) is on prod (`d2afb6f`, BUILD_ID
> `Hb0xqBxUlMkJKftTLAj88`); JOB-00009 is BID-00001, awarded.
> Richard's click-through: Admin → Business Development → Bid scoring (trades
> KNU bids, home / reachable counties, usual size per trade, bonding
> capacity) → Coastal Choice → Log a bid → the lead's Bid tab (sliders, Bid,
> Record submission, Close…) → Business Development → Bids. Next build:
> **Stage 4** (health score, scorecard, analytics, weights editor).

> **GC Partnerships Stage 2 (qualifications + vault) is on prod (`65cc01e`,
> BUILD_ID `k_Dv0RZV2Xs5ihU2PF5fB`), seeded, cron installed.** Click-through: Business Development → Document
> Vault → File a document (a GL COI with an expiry — the date prefills), then
> Coastal Choice → Qualification → Start a qualification → "Mark sent" on the
> GL line → the Documents tab; Admin → Users → the new "Open restricted vault
> documents" grant. Next build: **Stage 3** (bids) per the build spec §3.
>
> **Stage 1 is on prod** (`b8af730`, BUILD_ID `teFcePwxp9jUwltnPFRYK`).
> The paragraph below is its record.
>
> **GC Partnerships Stage 1 is built + dev-QA'd on `partners-s1` (a worktree
> under `.claude/worktrees/`), not merged, not deployed.** The main checkout is
> on `takeoff-m3` with uncommitted M3 work, so the merge is: from the main
> checkout, `git merge --ff-only partners-s1` onto `main` once `takeoff-m3` is
> parked or committed (expect a `prisma/schema.prisma` merge if M3 lands
> first — both add models at the end of the file). **Deploy carries migration
> `20261023120000_partners_core`.** After the deploy: run `prisma/seed-partners.ts`
> (prints created / unchanged), the backfill dry run → `--apply` (creates
> "Coastal Choice Construction", marks JOB-00009's lead a `GC_BID`; `--fix-billing`
> only after Richard reads the printed billing values), install
> `crm-cron/partner-follow-ups.sh` at `55 11 * * 1-5` and run it once
> (`raised 0` expected). Richard's click-through: Business Development → GC
> Partnerships → New account (owner, markets, trades) → the account page → Add
> contact → Log interaction with "Create a follow-up task" → the task on /tasks
> and under Open follow-ups → the board drag → Admin → Business Development
> thresholds. Next build: **Stage 2** (qualifications + the KNU document vault
> + expiry alerts + RESTRICTED access) per
> `CAREYOS_GC_PARTNERSHIPS_BUILD_SPECIFICATIONS.md` §2 — on a branch from
> `main` after Stage 1 is merged.
>
> **Update 2026-10-13: Stage 1 is on prod (`b8af730`, BUILD_ID
> `teFcePwxp9jUwltnPFRYK`), merged through a temporary `main` worktree at
> `/tmp/knuco-main` (the main checkout stays on `takeoff-m3`). Seed run
> (created ×5, then unchanged ×5), backfill applied — "Coastal Choice
> Construction" exists as an ACTIVE account owned by the job's sales rep,
> JOB-00009's lead is now `GC_BID` and linked; the job was already PROGRESS /
> 10 %, so `--fix-billing` was not used — and the follow-up cron is
> installed (`55 11 * * 1-5`, first run `organizations 1, raised 0`). What
> remains is Richard's click-through (the paragraph above), then Stage 2.**

> **Crew install dates are on prod (`fd736c1`, BUILD_ID
> `cKcuzqLdl3kPJiUWOl6SE`, no migration).** Richard's click-through — a job → Field → Crews: assign a crew with an install date
> (toast offers the start date when the job has none), the row names the
> get-ready task's owner, move the date, Calendar → Everyone shows "Install —
> <crew>" on the day. Assign a superintendent on the Workflow team first if
> the task should not go to the PM.

> **Initiative 6, Stage 1 (vendors + payee matching) is on prod (`ec88e96`,
> BUILD_ID `5x6HE43-USWkCl1cgP0Zn`).** Richard works Vendors → Unmatched:
> create Home Depot first (trim the bank memo to the name — it should link
> about 200 expenses at once, and the alias `homedepot` about 20 more), then
> each crew and the four typed contractors (BNW Construction, JDA Legacy,
> Prime Surfaces, MTL Granite). The backfill script's dry run should then
> report 0 matchable.
>
> **Stage 2 (compliance documents + expiry alerts) is on prod (`45899b2`,
> BUILD_ID `DcJXs_PTMUJdAIU9AJO2p`), cron installed.** Click-through once
> the directory has a subcontractor: its page → Compliance → Add document
> (a certificate expiring inside 30 days raises a task the next weekday
> morning at 11:50 UTC); the "Expiry tasks go to …" control on Vendors
> (automatic falls to Richard on prod — no Accounting role default is set).
>
> **The tidy-up pass is on prod (`b28e94e`, BUILD_ID
> `9llN2MQ3E4W4TUZGOSNH5`, no migration).** Click-through: ⌘K with an
> invoice number or an estimate number; a lead that became a job shows "Job
> JOB-…" under its name; Record payment on a labor contract whose vendor lacks
> documents shows the warning. **Two rulings are open**: should logging a
> contact move a lead's next follow-up date (and to when), and should
> `/api/messaging` be made public or removed (Twilio is not configured on
> prod). Phase 2 candidates if asked to continue: violations reports (Code
> Violations Stage 4), sending estimates and invoices from the CRM, the job
> timeline.

> **The audit's MVP roadmap is complete on prod (`a03c698`, BUILD_ID
> `SBnOF_n7Dfa0xpp-w6tyi`): Foundation + initiatives 1–7.** No build is
> queued. What remains is Richard's:
> - click-throughs — JOB-00009 → Files (13 files, most missing: Missing chip,
>   Upload again) and Field → Photos (106 "Photo missing" placeholders); a job
>   → Money → Expenses → attach a receipt; a job → Money → Commitments; a
>   subcontractor's Compliance card; the dashboard's Needs attention rows;
> - operator work — delete the duplicate SPF record (then digests, nurture,
>   escalations can be switched on), build the vendor directory under Vendors
>   → Unmatched, set Admin → Workflow Roles, pick the vendor compliance owner;
> - a look at JOB-00002 (crew paid $17,380 against $15,030 of labor
>   contracts).
> If asked to "continue" with nothing else said: propose the audit's Phase 2
> list (Part 10 of the audit doc) and the small leftovers recorded in
> `features/job-files.md` ("Not done") rather than starting a build.

> **Initiative 7, Stage 1 (files belong to the job) is on prod (`d18d054`,
> BUILD_ID `16_91QFu9eTLm0-ZEhAiC`).** Click-through for Richard: a job →
> Files (JOB-00009 has 13): category groups, the Missing chip, open a PDF in
> place, "Upload again" on a missing one, rename from the row menu. Next
> build: Stage 2 (one photo gallery), then Stage 3 (receipts on expenses).

> **Stage 3 (commitments) is on prod (`78bdc4c`, BUILD_ID
> `xqCVJVDrq3De9dtsbMCfy`); initiative 6 is complete.** Click-through for
> Richard, in order: Vendors → Unmatched (build the directory); a
> subcontractor's Compliance card; a job → Money → Commitments → Add
> commitment, then an expense to that vendor shows C-1 and the Open figure
> drops. Also check JOB-00002: crew paid $17,380 against $15,030 of labor
> contracts. Next build: initiative 7 (job documents and photos:
> `File.jobId`, preview, receipts on expenses) — plan it first.

> **Roofing P0 Stage C (the import script) is on `main`, not deployed.**
> After Richard's push and deploy (no migration): run the import's dry run on
> prod (reads both databases, writes nothing), show Richard the report —
> what would be created, which properties match a lead, which are held — and
> apply with `--yes` only on his word, after a fresh backup. Then P0 is
> complete; P1 (the estimate builder) needs his rulings first: who sees cost
> and margin, labor basis, price source, when a budget is seeded.

> **Roofing P0 Stage B (rules + price book) is on prod (`ac2a1d8`, BUILD_ID
> `Sm73Z7jwQy_iEWRSA7K2T`).** Click-through for Richard: Admin → Roofing
> Prices & Takeoff (empty until the import). Next build: Stage C — import the estimator's data (script with a
> dry run and a match report; strict address match; unmatched to a person).

> **Roofing P0 Stage A is on prod (`79e4e19`, BUILD_ID
> `HfCtieXEwvKgJaManWLme`)** with the preview-frame fix. Click-through for
> Richard: upload a Roofr PDF on a lead's Roofr tab (first run of the PDF
> reader inside the production server) and open a PDF from a job's Files tab
> (it should show in place, not blank). Next build: Stage B — roof systems, rules and
> the price book (`RoofSystem`, `RoofRule`, `RoofMaterialItem`, prices with
> history, Decimal money, vendor link, admin pages), then Stage C — the import.

> **Initiative 5 (attention dashboard) is on prod (`9b75536`, BUILD_ID
> `PmFnvrNoVx2_HApQwqCDx`).** Click-through for Richard: the dashboard's
> Needs attention rows each open a list of the same length; 10 daily logs
> wait for review and 15 open jobs show a missing deposit — check whether
> those deposit figures are real or stale `depositRequired` values. Digests
> stay off until the duplicate SPF record is removed. Next build: initiative
> 6 (vendors, compliance, commitments) — plan it first, it is the only wholly
> new module.

> **Initiative 4 (permits) is on prod (`9cd2aba`, BUILD_ID
> `Jz-SkZNZkAW6myqxzsKMy`), crons installed, old rules retired.**
> Click-through for Richard: a job's Permits tab (edit, record an inspection
> result, "Permit fees paid"), Permit Center's Inspections tab, ⌘K with a
> permit number, and the new HIGH task on JOB-00002's permit (issue the
> permit or close the job to settle it). Next build: initiative 5, the
> attention dashboard + digests on.

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
