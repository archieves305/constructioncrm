# N — Implementation tickets (Release 1)

> **Revised after the 2026-11-09 decisions:**
> - R1-1 (CREW_MEMBER), R1-2 (link a login) and R1-9 (Spanish) move to Release 2.
> - S1-1 gains the admin setting below (P-6).
> - R1-3 and R1-4 target CREW_LEAD first.
> - The pilot is Frank, the foreman.

Every ticket follows the same rules:
- the gate: tests, typecheck, lint baseline, build, `scripts/qa/run.sh all`, and the app's checks;
- server guards are tested in `route-guards.test.ts` and `roles.mjs`;
- no money or customer contact reaches a crew response.

---

## S1-1 — Document allowlist for crew roles
- **Objective:** a crew lead or crew member reads only the documents the field needs.
- **Files:** `src/lib/files/access.ts` (`fileReadWhere`), `/api/files`, `/api/files/[id]`, `/api/jobs/[id]/gallery`.
- **Backend:** for CREW_LEAD and CREW_MEMBER, add `category IN (PLAN_SET, PHOTOS, VIDEO, PERMIT, INSPECTION) OR crewVisible = true`.
- **DB:** `files.crew_visible boolean default false` (additive).
- **Mobile:** none. The phone's file list just shrinks.
- **Permissions:** office unchanged.
- **Acceptance:** as a crew lead on a job, an ESTIMATE / LABOR_CONTRACT / CUSTOMER_CONTRACT file id answers 404, and the list omits them. A PLAN_SET and a crew-visible OTHER are listed.
- **Tests:** unit tests on the `where`; a roles.mjs step.
- **Depends on:** nothing.
- **Effort:** 0.75 d.

## S1-1b — Admin sets what crews may see (P-6)
- **Files:** a new `CrewDocumentSettings` row (the visible `FileCategory` list, admin-edited); `File.crewVisible` becomes a tri-state override (`null` follows the setting, `true` show, `false` hide); Admin → Field settings; a "Show to crew / Hide from crew" item in the Files panel row menu (ADMIN / MANAGER).
- **Backend:** `fileReadWhere` for crew roles = (category in the setting AND override is not false) OR override is true.
- **DB:** a settings singleton; `files.crew_visible boolean null` (additive).
- **Acceptance:**
  - an admin unticks PERMIT and the crew lead no longer sees permit files;
  - "Show to crew" on one ESTIMATE makes only that file visible;
  - a non-admin cannot change either.
- **Effort:** 1 d.

## S1-2 — One "on the job" rule for crew roles
- **Objective:** a crew lead's job access is the same everywhere.
- **Files:** new `src/lib/access/crew.ts` (`crewJobIds`, `isOnCrewJob`); `src/lib/access/records.ts` (`guardJob` for crew roles), `src/lib/labor/permissions.ts` (`resolveJobFieldAccess`), `src/app/api/field/today/route.ts`.
- **Backend:** a person is on a job if any of these holds: a JobFieldAssignment; a CrewAssignment on the job for their Personnel.crewId; the PM or a workflow team slot.
- **DB:** none.
- **Acceptance:** for a crew lead, the job's files, logs and photos answer alike: all 200 on the job, all 404 off it.
- **Tests:** a matrix test over the three link kinds.
- **Depends on:** nothing.
- **Effort:** 0.75 d.

## S1-3 — No customer contact for crew roles
- **Files:** `src/lib/calendar/field-day.ts` (`contactOf`), `/api/calendar`, `/api/field/today`, the mobile job and calendar DTOs.
- **Backend:** for crew roles, return the street only; drop the customer's name, phone and email.
- **Acceptance:** no customer phone appears in any crew-role response; checked by a script over the crew routes.
- **Effort:** 0.5 d.

## R1-1 — CREW_MEMBER role
- **Objective:** W2 workers sign in with less than a crew lead can do.
- **Files:** `prisma/schema.prisma` (enum, migration), `~/careyos/config/apps.config.ts` (appRoles: portal deploy first), `src/lib/access/roles.ts`, `src/lib/tasks/access.ts`, `src/lib/labor/roles.ts`, `(dashboard)/layout.tsx` confinement, `@crm/mobile-api` `ROLE_NAMES`.
- **Permissions:** as in C.
- **Mobile:** the role picks the crew tab set.
- **DB:** enum value (additive).
- **Acceptance:**
  - a CREW_MEMBER is refused when creating a task for another person, editing the crew sheet, writing the daily log or reading money;
  - they can complete their own task, and add a photo, an issue or a material request on their job.
- **Tests:** a roles.mjs CREW_MEMBER run; a smoke pass as CREW_MEMBER (run.sh gains it).
- **Depends on:** S1-2.
- **Effort:** 1 d.

## R1-2 — Link a worker to a login
- **Files:** the personnel page (`src/app/(dashboard)/personnel/[id]/page.tsx`), `/api/personnel/[id]` (`userId`).
- **Mobile:** none.
- **Acceptance:** an office user picks the CRM user for a Personnel row; one user per worker (unique). The crew rule then sees the worker's crew assignments.
- **Effort:** 0.5 d.

## R1-3 — Crew projection API
- **Files:** `src/app/api/mobile/crew/{today,week}/route.ts`, `src/lib/mobile-api` (zod contracts).
- **Backend:** the jobs on the crew rule for the day or week, each with street, start time, foreman (name and phone of the job's field assignment or crew foreman), the person's own tasks, the crew's tasks on the job (read), the open-issue count and the doc count. No money, no customer.
- **Acceptance:** contract tests; a CREW_MEMBER sees only their jobs; refused for other roles' private fields.
- **Effort:** 1.5 d.

## R1-4 — Crew screens (Today, Job, Task, tabs)
- **Files:** `mobile/src/app/(app)/(tabs)/_layout.tsx` (role tab sets), new `mobile/src/app/(app)/crew-home.tsx`, `crew-job/[id].tsx`, `mobile/src/ui/*`.
- **Mobile:** as in G1–G3. Done / Undo reuses `quick-done`; directions use the maps link, Call uses `tel:`.
- **Acceptance:** two taps from launch to Done on a task; Today shows "No job today" with the next assignment; a11y.test passes.
- **Effort:** 3 d.

## R1-5 — Photo phase + quick actions
- **Files:** `/api/files` (`phase`), `mobile/src/app/(app)/photo.tsx`, outbox `file.upload`.
- **DB:** `files.phase` enum, nullable.
- **Acceptance:** a photo taken from a job lands on the job with its phase. Offline: it queues and sends once, never twice.
- **Effort:** 1 d.

## R1-6 — Report a problem
- **Files:** `mobile/src/app/(app)/issue/new.tsx`; field-issues POST (crew rule).
- **Mobile:** category chips, a photo, dictation, urgent. Safety shows the 911 notice and Call foreman before filing.
- **Backend:** urgent or safety notifies the PM and the field lead immediately (`notify` forced immediate).
- **Acceptance:** the issue and its task appear on the job; the PM gets a push at once for a safety issue.
- **Effort:** 1 d.

## R1-7 — Week + acknowledge
- **Files:** `crew_assignments` (`start_minutes`), the job Crews panel (office sets the time), `/api/crew-assignments/[id]/ack`, the calendar overlay.
- **DB:** `crew_assignments.start_minutes int null` (additive).
- **Acceptance:** the worker taps OK and the PM sees "Confirmed by …"; Can't make it notifies the PM.
- **Effort:** 2 d.

## R1-8 — Push for crew
- **Files:** `src/lib/mobile/push.ts` (`PUSH_KINDS`: `crew.assigned`, `crew.changed`), the hooks on CrewAssignment / JobFieldAssignment writes, `my-day.ts` (crew version).
- **Acceptance:** assigning a crew sends one push to each linked worker, with the street and day only.
- **Effort:** 1 d.

## R1-9 — Spanish (if P-2 says so)
- **Files:** `mobile/src/i18n/{index,en,es}.ts`, every crew screen, `User.locale` (migration), push text.
- **Acceptance:** with Español chosen, every crew screen and push reads in Spanish; statuses come from a Spanish status table in `@crm/mobile-api`.
- **Effort:** 2.5 d.

## R1-10 — Pilot release
- TestFlight build; the four workers' CareyOS accounts and portal grants; links set on their Personnel rows; a one-page how-to (English and Spanish).
- **Measure for 2 weeks:** daily active workers, photos per job-day, tasks closed from the phone.
- **Effort:** 1.5 d.

**Release 2 / 3 tickets** follow the same format after Release 1's pilot result. They are listed in K / L.
