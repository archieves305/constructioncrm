# A — Executive recommendation · P — decisions · the 12 answers

## A. Recommendation

**Put the crew experience inside KNU Field, as a crew mode chosen by role, with no separate app.**
- **The backend is already there.** Tasks, photos, issues, punch, material requests, daily logs, the crew sheet, offline queue, push and English / Spanish guest links all work today, so the crew mode is mostly a new face on existing routes.
- **Build first for KNU's W2 workers with logins** (Richard's ruling). Today that is four people. Subcontractor crews keep the guest links; they come back in Release 3.
- **Fix three access gaps first** (verified in the code):
  1. a crew lead can read every file on a job, including customer contracts and estimates;
  2. two job-access rules disagree;
  3. the day screen shows the customer's phone and address.
- **The real risk is adoption, not features.** In the last 60 days prod has 1 daily log and no crew hours, field photos or field issues, and no guest link has ever been sent. Release 1 therefore ends in a two-week pilot measured by the usage log, before more is built.
- **Release 1 is about 17 engineer-days.** Release 2 is about 9, Release 3 about 15.

## The 12 questions

1. **In the current app or a separate one?** In KNU Field. It's one app, one sign-in, one outbox and one store listing, and the role decides the tabs: crew members get Today / Jobs / + / Me. A separate app would double the release work for four users. A web-only (PWA) version would lose the offline outbox and push notifications that already work.
2. **What does a crew member see first?** Today:
   - the job, the start time and the foreman (with Call);
   - Directions;
   - today's tasks;
   - three buttons: Photo, Problem, Materials.
3. **Reusable:**
   - tasks with Done / Undo, the outbox, the photo pipeline;
   - field issues: punch, material requests to Purchasing, safety;
   - the daily log and crew sheet (for the foreman), inspections (read);
   - push and my-day, the offline cache;
   - the shared status words and colours, the guest links.
4. **Hidden from crew:**
   - all money (contract, costs, pay, margins);
   - estimates and customer contracts;
   - the customer's phone and email;
   - other workers' details, payroll and rates;
   - other jobs;
   - approvals, admin, leads, reports, dispatch.
5. **Foreman extras:** everything a crew member has, plus:
   - the whole crew sheet, the daily log and its submission;
   - tasks for others;
   - reading the inspection schedule;
   - completing the workflow steps of a job they're assigned to;
   - seeing who has confirmed.
6. **Crew assignments:** the office assigns a crew to a job (`CrewAssignment`, with a new start time) or a person (`JobFieldAssignment`). One "on the job" rule reads both. Workers acknowledge, and only the office changes dates.
7. **Field progress to the office:** through the same tables, with no second store:
   - Done → task → dashboard;
   - photo → job files;
   - issue → PM or Purchasing task;
   - clock → crew sheet → daily log → payroll.
8. **Subcontractors without accounts:** guest links (photos, payment, install-day confirmation) in English and Spanish, with every submission reviewed by the office. Release 3 has Twilio text them, adds "today's job" and "report a problem" links, and makes the crew phone a required field.
9. **The five to build first:**
   1. the crew Today with Directions / Call;
   2. Done on their own tasks;
   3. photo-first upload;
   4. Report a problem;
   5. the week with acknowledge.

   These come after the access fixes and the role.
10. **Office-only:**
    - money, estimates and contracts;
    - approvals and payments;
    - personnel, rates and SSN;
    - the schedule itself, recording inspections;
    - approving the daily log;
    - reports, settings, leads, crew links.
11. **MVP effort:** about 17 engineer-days, including QA and a TestFlight pilot.
12. **Order:**
    1. access fixes S1-1 to S1-3;
    2. the CREW_MEMBER role, then linking logins to workers;
    3. the crew API, then the screens;
    4. photo phase, Report a problem;
    5. Week with acknowledge, push;
    6. Spanish (P-2);
    7. the pilot;
    8. Release 2 by the pilot's numbers.

## P — Decisions for management

1. **Who are the pilot workers?** The four W2 workers each need a CareyOS account with an email. Do they have work emails, or should personal ones be used?
2. **Spanish:** does any of the four prefer Spanish? If yes, Spanish goes into Release 1 (+2.5 days); if not, Release 2.
3. **Self clock in / out and payroll:** should workers' own punches feed payroll after the foreman approves the day? Who corrects a missed punch? This decides whether clocking is in Release 2.
4. **Location on punches:** off by default. Turn it on only by a written decision, with employee consent.
5. **Who is the foreman** on each crew? Today `Crew.foremanName` is empty everywhere and only one CREW_LEAD exists.
6. **Documents for crews:** is the allowlist right (plans, photos, video, permit, inspection, plus "Show to crew")? Should installation and product sheets be uploaded with that tick?
7. **Material requests:** who is Purchasing on each job? The workflow role default is empty on prod, so requests fall back to the PM.
8. **Phones:** KNU-issued or personal? This matters for remote wipe, and for the privacy notice if location is ever used.
9. **The pilot's success measure:** we propose that by week 2 every pilot worker opens the app on 4 of 5 workdays and sends at least one photo per job-day.

## Decisions taken (Richard, 2026-11-09)

| # | Decision | Effect on the plan |
|---|---|---|
| P-1 | **Frank Picado is the first pilot user** | He already has a CREW_LEAD login, linked to his worker record (1099, "Supervisor"), and is field-assigned to 2 jobs. No phone or app use yet. The pilot starts with no new role. |
| P-2 | **English is enough** | Spanish leaves Release 1 (−2.5 days). It is reconsidered when W2 crew members join. |
| P-3 | **Workers' own punches don't need to feed payroll yet** | Self clock-in is dropped from Release 2. The foreman's crew sheet stays the record. |
| P-4 | **Location stays off** | No location on any punch or photo. |
| P-5 | **Frank Picado is the foreman** | Set as the crew's foreman and the field lead on his jobs; the crew's "Call foreman" points at him. |
| P-6 | **An admin decides which documents crews see** | Release 1 gains an admin setting: the file types crews may see (default plans, photos, video, permit, inspection), plus a per-file "Show to crew / Hide from crew" override. |
| P-7 | Purchasing per job | **TBD.** Material requests keep falling back to the PM. |
| P-8 | **Personal phones** | No device management. Remote wipe covers the app's own data only; sign-out and revoke stay the controls. |
| P-9 | **Pilot measure agreed** | Opens the app on 4 of 5 workdays and sends a photo every job-day. |

*Verified findings cite code or read-only prod queries (see B and C). Assumptions are marked **A**.*
