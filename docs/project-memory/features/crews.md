# Crews: install dates

_Built 2026-10-05 on `crew-install-dates`. No migration._

## What it does

A crew is assigned to a job on Job → Field → Crews, with an optional install
date. The date is a day (pinned to noon UTC by `parseDueAt`).

- **Calendar:** a read-only `crew_install` overlay ("Install — <crew>") on the
  install day, opening the job's Crews tab. Scoped like the other job overlays
  (My calendar = jobs I have a role on). Closed jobs are left out.
- **Get-ready task:** one ordinary HIGH all-day task per install date, raised
  when the date is saved, due the working day before (today when that day has
  come or gone). Owner: the job's superintendent → its project manager → the
  oldest admin. Source key `crew-install:<assignmentId>:ready@<day>`.
  - Date moved → the old task is cancelled ("The install date was moved") and
    a new one is raised. Cleared / crew removed → cancelled with the reason.
  - A date in the past raises nothing. Raised once per key: completing the
    task does not bring it back on the next save.
- **Workflow:** the checklist line "Crew and install date set" (Doors &
  Windows → "Receive delivery and get ready to install") ticks itself
  (`HeldFacts.crewInstallSet`). Held facts are now also ticked when a step
  closes (`afterClose` in `lib/tasks/transitions.ts`), so a line on a step
  that becomes Ready later is ticked then — this applies to every held fact.
- **Start date:** saving an install date on a job with no target start date
  offers "Use as the job's start date" in the toast (to whoever may
  coordinate the workflow). Never overwrites one.

## Code

- `src/lib/crews/install.ts` — pure: `planInstallTask`, `previousWorkingDay`,
  `liveInstallKey`, keys.
- `src/lib/crews/install-run.ts` — `syncInstallTask` (close overtaken, raise
  the live one; never throws), `openInstallTasks` (for the Crews tab).
- `POST /api/jobs/[id]/crews`, `PATCH|DELETE /api/jobs/[id]/crews/[assignmentId]`
  — `guardJob(…, "write")`, activity line, `syncInstallTask`, `settleJobGates`.
- `GET /api/jobs/[id]` adds `installTask` to each crew assignment.
- `lib/calendar/overlays.ts` + `overlays-load.ts` — the overlay.
- `components/jobs/crews-panel.tsx` — row date edit, remove, owner line.

## Rule

Every write to a `CrewAssignment` calls `syncInstallTask`. The crew itself is
never emailed.

## QA (dev, 2026-10-05)

API: assign → task for the PM due the working day before; same date again →
no duplicate; move → old cancelled, new raised (Monday install → due Friday);
clear → cancelled; past date → none; remove → cancelled; wrong job 404; bad
date / missing or unknown crew 400; job with no PM and no workflow → oldest
admin. Calendar API and job GET return the overlay and `installTask`. Both
tick paths for the checklist line. Headless Chromium at 1280 and 400 px: row
edit, start-date offer, calendar marker (not draggable, links to the Crews
tab), remove; no page errors. Dev DB restored.

Not exercised: the assignment email itself (dev's PM is a muted seed user), a
superintendent slot (dev has none — the PM fallback ran), SALES_REP access
(the guard is `guardJob`, tested in Foundation).

Prod before deploy: 2 crew assignments, none with an install date — nothing
to backfill.

## Not done

- No "installs today" line in the digest's Starting-today section.
- The task is not reassigned when the superintendent changes later.
- The same crew can be assigned to a job twice (as before).
