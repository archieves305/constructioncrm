# Feature — Crew mode (Release 1, foreman first)

Study and decisions: `docs/audits/crew-experience/` (A–P). Pilot: Frank Picado, the
foreman (CREW_LEAD), on an iPhone. English only, no location, no self clock-in.

## Server

- **One "on the job" rule for crew leads.** `resolveJobFieldAccess`
  (`lib/labor/permissions.ts`) and `/api/field/today` now use
  `jobsInvolvingUserWhere`, the rule `guardJob` already used. A crew lead could
  previously open a job's files but get 403 on its logs and photos.
- **What crews can see** (ruling P-6). `LaborSettings.crewFileCategories`
  (default: plan sets, photos, video, permit, inspection) is set on the Crews page
  ("What crews can see"; ADMIN saves, MANAGER reads) through
  `/api/admin/crew-documents`. `File.crewVisible` overrides one file: `true` shows
  it, `false` hides it, `null` follows the kind. The Files row menu has "Show to
  crews / Hide from crews / Crews: follow the setting" (ADMIN / MANAGER). Contracts,
  estimates, receipts, signed documents and insurance are never shown by kind
  (`NEVER_CREW_BY_KIND`). The file routes call `fileReadWhereFor`
  (`lib/files/crew-visibility.ts`, server-only). `fileReadWhere` stays
  client-safe.
- **No customer contact for crew leads.** `forViewer` (`lib/access/crew-redact.ts`)
  blanks `primaryPhone` / `secondaryPhone` / `email` on every object that carries
  `primaryPhone` (only a lead does). It is applied to:
  - `GET /api/jobs`
  - `GET /api/jobs/[id]`
  - `GET /api/leads/[id]`
  - `GET /api/tasks/[id]`
  - `GET /api/calendar`
- **Crew day and week.** `lib/crews/crew-view.ts` serves `/api/mobile/crew/today`
  and `/api/mobile/crew/week`:
  - the open jobs a person is on, with street, start time (from
    `CrewAssignment.startMinutes`) and the PM's name and phone (new `User.phone`,
    set on Admin → Users);
  - their own tasks, today's log status and open issues;
  - no money and no customer contact, by construction.
- **Got it / Can't make it.** `POST /api/crew-assignments/[id]/ack` records
  `confirmation` and `confirmedByUserId`. Can't make it gives the PM a HIGH task
  due today. Moving the install day clears the earlier answer.
- **Start time.** The job's Crews panel has a start time field.
  `PATCH /api/jobs/[id]/crews/[assignmentId]` takes `startMinutes`.
- **Push.** Kind `crew.scheduled` (IMMEDIATE) goes to the job's field-assigned crew
  leads and to any crew member with a login (never the actor) when a day is set,
  moved or timed. It opens the app's Week tab.
- **Problems go to the PM.** A field issue a crew lead raises with nobody named
  goes to the job's PM. Materials go to Purchasing first.
- **Photo phase.** `File.phase` BEFORE / DURING / AFTER comes from the upload form
  field `phase`, and the Files list shows it.

Migration `20261122120000_crew_release1` (additive only):
`labor_settings.crew_file_categories`, `files.crew_visible`, `files.phase`
(+ enum `PhotoPhase`), `crew_assignments.start_minutes` / `confirmed_by_user_id`,
`users.phone`.

## App (KNU Field)

`isCrewRole` (`mobile/src/lib/crew.ts`) means CREW_LEAD, or CREW_MEMBER later.

- **Tabs:** Today · Week · + · Me. Tasks are hidden; they sit in the job.
- **Screens:**
  - `CrewToday`: greeting, one card per job (start, PM, Directions, Call PM, their
    tasks, the log), then Photo / Problem / Materials;
  - `CrewWeek`: install days with Got it / Can't make it;
  - `problem.tsx`: kind chips (safety shows "call 911" first), photo, dictated
    note, urgent. Queued through the outbox.
- **Photo phase:** the photo screen has Before / During / After chips.
- **Job screen:** "Call PM" replaces the customer Call, and there is a "Report a
  problem" button.

## QA

`scripts/qa/crew.mjs` (in `run.sh all` and `run.sh crew`) runs as a CREW_LEAD on
flows' job. It checks:
- the one rule;
- the allowlist and per-file Show;
- no customer phone or email in 6 answers;
- day and week, Got it and Can't make it;
- problem → PM.

The app tests include `mobile/src/lib/crew.test.ts` and the VoiceOver scan.

## Gotchas

- Expo Router's typed routes regenerate only when `expo start` runs. Start it
  briefly (`CI=1 npx expo start --port 8099`) after adding a screen.
- `pkill -f "<text>"` matches the calling shell when the text is in its own
  command. Stop the dev server by port instead: `lsof -ti tcp:4000 | xargs kill`.
- Never restore the dev DB by hand while a stopped `run.sh` may still be
  running its own restore: two `pg_restore --clean` at once dropped tables on
  2026-11-09. Wait until no `pg_restore` / `run.sh` process is left.
- A QA run killed with TERM did not restore the dev DB. Restore by hand from
  `qa-out/dev-before.dump` and compare the counts files.

## Also in this commit (first Release 2 app pieces)

- **Materials:** the phone's materials screen lists this job's requests with
  their status in materials words (Requested / Ordered / Delivered,
  `MATERIAL_STATUS`), plus "Asked for before on this job" chips (`pastItems`).
- **Plans:** a Plans screen (`plans/[jobId]`) lists the job's sheets
  (`GET /api/jobs/[id]/plan-sheets`) and opens a full-screen sheet with pinch to
  zoom. The list and the sheet image (`guardSheet`) are refused to crews while
  plan sets are not shared.
- **The crew's day in the log:** the phone's daily log shows "From the crew
  today": the day's photos and problems on the job.
- **Revoked phone:** a revoked phone's 401 carries `code: "device_revoked"`
  (`unauthorized()` reads a per-request note set by `getSession`). The app then
  also clears its unsent changes (`clearFor`). An ordinary sign-out keeps them.
- **Foreman-only actions:** `isForeman` hides the log, the crew sheet and New task
  from a CREW_MEMBER, ready for that role.

## Release 2 (built 2026-11-09)

- **CREW_MEMBER role** (a W2 worker). Migrations `20261123120000_crew_member_role`
  (enum value) and `20261123121000_crew_member_seed` (the roles row; separate,
  because a new enum value can't be used in the transaction that adds it). The
  portal needs it too: `~/careyos` branch `crm-crew-member` (`9e520a0`) adds it to
  `config/apps.config.ts` appRoles. Deploy the portal before granting anyone the
  role.
  - `isCrewRole()` (`lib/access/roles.ts`) covers both crew roles:
    - field-mode confinement and the own-only lists;
    - hidden customer contact and the crew document rule;
    - the "crews are refused" checks: permit forms and library, product
      approvals, guest submissions, permit intelligence;
    - task links and digests.
  - Kept for CREW_LEAD only: the weekly hours email, recording inspections,
    completing workflow steps, creating personnel and reading the roster.
  - Field access level "contribute" (`jobFieldAccess`): a crew member on a job
    may post field issues and photos, and refuses the log, crew sheet,
    signature, areas and approvals (all still "write").
  - `canCreateTasks` excludes CREW_MEMBER: they report a problem instead.
- **A crew is refused a lead's records** (gap found in QA): `guardLead` answers
  404 to a crew role unless the caller passes `allowCrew`. Only the slim lead
  view (`crewLeadView`: name, address, jobs) and plan reading opt in. Messages
  carry the customer's address and number in `fromValue` / `toValue`.
- **Worker ↔ login:** the KNU Field login card on a worker's page
  (`PUT /api/personnel/[id]/login`, personnel managers, one login per worker,
  audited). Linking it puts the worker's crew's jobs in their crew mode.
- **The field on the web daily log:** "From the field this day" (`CrewDayCard`)
  shows the day's photos and problems on the job.
- QA: `scripts/qa/crew-member.mjs` (in `run.sh all` / `crew`). The crew pass gained
  the lead sub-route refusals.

Self clock-in was dropped (ruling P-3). Spanish waits until a W2 worker needs it.
