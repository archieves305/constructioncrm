# O — Functional and regression testing plan

The existing suites are extended, not replaced:
- web: `scripts/qa/run.sh` (flows, smoke per role, axe, roles, dev DB restored);
- app: `mobile/src/**/*.test.ts`, including the VoiceOver scan, and the scripted dev checks against a dev CRM.

## New role runs
- **`run.sh`:** adds a **CREW_MEMBER** pass, with smoke and roles, beside ADMIN / SALES_REP / READ_ONLY. A CREW_LEAD pass is added too; today it is not covered.
- **`roles.mjs` steps for the crew roles:**
  - money routes 404 / 403;
  - an ESTIMATE / LABOR_CONTRACT / CUSTOMER_CONTRACT file 404;
  - another job's task 404;
  - creating a task for someone else 403;
  - crew-sheet PUT 403 (CREW_MEMBER);
  - daily-log submit 403 (CREW_MEMBER);
  - own task Done 200;
  - photo / issue / material on their job 201, off their job 404.
- **A response scan:** every crew-role JSON response in the run is searched for the seeded customer's phone, email and contract amount. Any hit fails.

## Scenarios (dev data, then restored)

| # | Persona | Scenario | Pass when |
|---|---|---|---|
| 1 | Office | Assign crew A to job X for tomorrow at 7:30 | The worker in crew A gets one push; Week shows X with 7:30 |
| 2 | Crew member | Tap OK on the assignment | The PM sees "Confirmed"; the calendar overlay shows it |
| 3 | Crew member | Today → job → Done on a task → Undo | Two taps; Undo restores the prior status |
| 4 | Crew member | Offline: 3 photos (after) + a problem (blocked), then back online | One issue, three files with phase AFTER, no duplicates |
| 5 | Crew member | Safety issue | The 911 notice shows; the PM gets an immediate push; the task is urgent |
| 6 | Crew member | Removed from crew A mid-day | Next refresh: job X is gone; a queued photo for X ends as "No longer on this job" |
| 7 | Foreman | Opens job X | Files: plans and photos only; no customer phone on Day |
| 8 | Office | Deactivates the worker | Next request is refused; the phone signs out |
| 9 | Crew member | Español | Every crew screen and push in Spanish (if P-2) |
| 10 | Admin | Revokes the phone (Release 2) | The app wipes its cache on the next start |

## Device checks per release (TestFlight)
- iPhone in light and dark, VoiceOver on Today / Job / Photo / Problem, outdoor brightness, one-handed reach.
- Android once the Play build exists.
- A field test on a real site: one day with a W2 worker, timed to the first Done and the first photo.

## What "works" means
Server state is read back (SQL or API) after every UI action. A rendered screen alone is never a pass.
