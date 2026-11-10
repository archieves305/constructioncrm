# H–J: shared backend, subcontractors and guest links, security and offline

## H. Backend and API requirements

The guiding rule is to extend the existing routes rather than build a parallel "crew API".

| Need | Change | Reuses |
|---|---|---|
| Crew-member role | `RoleName.CREW_MEMBER` (migration); the portal `apps.config.ts` gains it; `ROLE_NAMES` in `@crm/mobile-api`; confined to `/field` like CREW_LEAD | `(dashboard)/layout.tsx` confinement |
| One "on the job" rule | `lib/access/crew.ts` `crewJobIds(userId)`, used by `guardJob`, `requireJobFieldAccess`, `/api/field/today` and `/api/mobile/*` for crew roles | `CrewAssignment`, `JobFieldAssignment`, `Personnel.crewId` |
| Crew projection of a job | `GET /api/mobile/crew/today` and `/crew/week`: street, start, foreman, the person's tasks, allowlisted doc count, open issues. No customer fields | `field-day.ts` logic minus `contactOf` |
| Document allowlist | `fileReadWhere` for crew roles: categories PLAN_SET, PHOTOS, VIDEO, PERMIT, INSPECTION, plus an office tick "Show to crew" (`File.crewVisible`) | `lib/files/access.ts` |
| Plan sheets for a job | `GET /api/jobs/[id]/plan-sheets` (crew rule) → the existing sheet render route | `plan-sheets/[id]/render` |
| Self clock | `POST /api/me/clock` `{jobId, action: in\|out}`: finds or creates *their* `DailyLaborEntry` on the job's log for today and stamps server time. Location only if the policy allows it (see J) | the check-in / check-out logic |
| Acknowledge | `POST /api/crew-assignments/[id]/ack` → `confirmation = CONFIRMED / CANT_MAKE_IT` and a note to the PM | the guest INSTALL_CONFIRM effect |
| Start time | `CrewAssignment.startTime` (minutes) and `CrewAssignment.date` per day (or a `CrewAssignmentDay`); shown on the calendar overlay | install-date overlay |
| Photo phase | `File.phase` BEFORE / DURING / AFTER (nullable) | `/api/files` |
| Spanish | the app's own strings in `mobile/src/i18n/{en,es}.ts`; `User.locale`; push text in the user's language | guest `GUEST_TEXT` pattern |
| Material status | `FieldIssue.status` mirrored to the crew; "past requests on this job" list | field-issues |

**Sync to the office (no new store):**
- task Done → `updateTask` → notification and dashboard;
- photo → `File` on the job → Files and Photos;
- issue or material → `FieldIssue` + task → the PM or Purchasing;
- clock → `DailyLaborEntry` → the foreman's sheet → the daily log → payroll;
- acknowledgement → `CrewAssignment.confirmation` → calendar and notification.

## I. Subcontractors and guest links

Following Richard's ruling, the employee track comes first. Subcontractors keep what exists:
- guest links (photos, payment, install-day confirmation) in English and Spanish;
- the office reviews every submission.

**Next steps when that track resumes (Release 3):**
1. Text the link through Twilio, so the office no longer copies it by hand.
2. Add a "today's job" link and a report-a-problem link.
3. Make the crew phone a required field on a labor contract.

Prod has 0 links sent so far, so step 1 is an adoption fix rather than a feature.

## J. Security and offline

- **Money and customer data never reach a crew phone:**
  - the crew projection has no money and no customer contact;
  - the cache rules (`mobile/src/cache/rules.ts`) also refuse any query key outside the crew set for crew roles.
- **Lost device or a worker leaving:**
  - existing: revoke the phone in Admin → Phones, deactivate the user;
  - new: the bootstrap answers `wipe: true` for a revoked device, and the app clears its SQLite cache, documents and outbox on its next start.
- **Cached data:**
  - existing: wiped at sign-out; kept for 7 days at most;
  - crew roles: shortened to 3 days;
  - plans: kept offline only for the jobs in this week's assignments.
- **Location:**
  - **off by default**;
  - clock in / out records server time only;
  - if KNU wants location on a punch, it is recorded at the punch only (no tracking), with written consent and the employee told in-app. Florida has no statute requiring consent for this, but the practice is consent (A; worth KNU's own legal check).
- **Offline behaviour:**
  - existing: today's and the week's assignments and tasks are cached; photos, issues, materials, Done and notes queue in the outbox with idempotency keys, so a resend never duplicates;
  - new: clock in / out queues with the phone's time and the server's receipt time, and the foreman sees a ⚠ when they differ by more than 15 minutes.
- **Conflicts:**
  - task changes carry `expect`; a stale Done shows "Changed by the office — check it" (existing);
  - a revoked permission answers 404 / 403, and the outbox item shows "No longer on this job" instead of retrying for ever.
