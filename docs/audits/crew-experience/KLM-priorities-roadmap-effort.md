# K–M: priorities, roadmap, effort

## K. Prioritisation matrix

Each feature is scored 1–5 on each criterion. Total = the weighted average × 20, so 100 means 5 on every criterion.

**Weights:** daily usefulness 25 · office time saved 20 · operational importance 20 · ease of adoption 15 · backend readiness 10 · implementation efficiency 10.

| Feature | Use | Office | Ops | Adopt | Ready | Effic | **Score** | Bucket |
|---|---|---|---|---|---|---|---|---|
| Task Done / Blocked on own tasks | 5 | 4 | 4 | 5 | 5 | 5 | **92** | MVP |
| Photo-first upload with before / during / after | 5 | 4 | 4 | 5 | 4 | 4 | **88** | MVP |
| Crew Today home (job, start, foreman, tasks, quick actions) | 5 | 4 | 4 | 5 | 4 | 3 | **86** | MVP |
| Report a problem (incl. safety prompt) | 4 | 4 | 5 | 4 | 5 | 4 | **86** | MVP |
| Access fixes: file allowlist, one crew rule, no customer phone | 3 | 3 | 5 | 4 | 4 | 4 | **75** | MVP, built first (ruling) |
| Directions + call foreman | 4 | 2 | 3 | 5 | 5 | 5 | **75** | MVP |
| CREW_MEMBER role + login link | 4 | 3 | 4 | 4 | 3 | 4 | **74** | MVP (prerequisite) |
| Self clock in / out (server time) | 4 | 4 | 4 | 3 | 3 | 3 | **73** | Release 2: needs the payroll ruling (P-3) |
| Material request with status + past items | 3 | 4 | 3 | 4 | 5 | 4 | **73** | Release 2 (MVP keeps today's request) |
| Week schedule + acknowledge | 4 | 4 | 3 | 4 | 3 | 3 | **72** | MVP |
| Push: assignment / change / my day | 4 | 3 | 3 | 4 | 4 | 4 | **72** | MVP |
| Sub crews: Twilio-sent guest links, today / problem links | 3 | 4 | 3 | 4 | 4 | 3 | **69** | Release 3 (sub track) |
| Plans and allowlisted documents (+ superseded warning) | 4 | 3 | 3 | 4 | 3 | 3 | **68** | Release 2 |
| Spanish (app strings + push) | 4 | 2 | 3 | 5 | 1 | 3 | **63** | MVP if any W2 worker prefers Spanish (P-2), else Release 2 |
| Crew photos and notes rolled into the foreman's daily log | 2 | 4 | 3 | 3 | 4 | 3 | **61** | Release 2 |
| Trade QA checklists (drywall, interior, doors / windows) | 3 | 3 | 3 | 3 | 2 | 2 | **56** | Release 3: KNU writes the content |
| Remote wipe of a revoked phone | 1 | 2 | 4 | 3 | 3 | 4 | **52** | Release 2 |
| Job message thread | 3 | 3 | 2 | 3 | 1 | 2 | **50** | Release 3 |
| Location on punch (with consent) | 1 | 2 | 2 | 2 | 3 | 3 | **39** | Only if KNU asks |
| AI: photo tagging, daily summary | 1 | 2 | 2 | 2 | 3 | 2 | **37** | Only once usage shows the need |

**Office-only:**
- money, estimates and contracts;
- approvals, payments and crew links;
- personnel records, rates and SSN;
- the schedule itself, dispatch;
- inspections recording;
- the daily-log approval;
- reports, settings and leads.

**Better as a guest link:** anything for subcontractors or people without a login.

## L. Releases

**Release 1, crew MVP (the four W2 workers and the foreman):**
1. Access fixes: S1-1 to S1-3.
2. CREW_MEMBER role and linking a login to a worker.
3. The crew Today home, with directions and Call foreman.
4. Own tasks: Done, Blocked, a photo on the task.
5. Photo-first upload, tagged before / during / after.
6. Report a problem, with the safety prompt.
7. The week schedule, with acknowledge.
8. Push notifications.
9. Spanish, depending on the answer to P-2.

Then a pilot: the four workers for two weeks, with usage measured by the existing usage log.

**Release 2, field operations:**
- self clock in / out;
- material request status and past items;
- plans and the document allowlist UI (Show to crew);
- crew contributions in the foreman's daily log;
- remote wipe;
- Spanish, if it was not in the MVP.

**Release 3, advanced:**
- trade QA checklists (KNU writes them);
- the job thread;
- the subcontractor track (Twilio links);
- location on punch, or AI, only if measured or asked for.

## L′. Release 1 after the decisions (2026-11-09)

The pilot starts with Frank, the foreman, who already has a CREW_LEAD login. Release 1 therefore serves the foreman first. The CREW_MEMBER role moves to Release 2, when KNU's W2 workers join.

| Step | Days |
|---|---|
| S1-1..3 access fixes (Frank is a crew lead, so they apply to him directly) | 2 |
| Admin document visibility: crew file-type setting + per-file override (P-6) | 1 |
| Crew projection API (today / week) for CREW_LEAD | 1.5 |
| Simplified Today, Job and Task screens for CREW_LEAD; foreman tools (crew sheet, log) stay on the Job screen | 3 |
| Photo phase + quick actions | 1 |
| Report a problem with the safety prompt | 1 |
| Week + acknowledge (start time on the crew assignment) | 2 |
| Push for assignment changes | 1 |
| Pilot: Frank's TestFlight invite, the Frank-as-foreman set-up, how-to card, 2-week measure | 1.5 |
| **Release 1** | **≈ 14** |

**Release 2:** CREW_MEMBER role and login link for W2 workers; material status and past items; plans viewer; crew contributions in the foreman's log; app-data wipe. Spanish only if a W2 worker needs it. Self clock-in is dropped (P-3).

## M. Effort (engineer-days, including QA)

| Item | Days |
|---|---|
| S1 access fixes (allowlist, crew rule, contact strip) + tests | 2 |
| CREW_MEMBER role: portal config, migration, confinement, link worker ↔ login on the personnel page | 1.5 |
| Crew projection API (`/api/mobile/crew/today`, `/week`) | 1.5 |
| Crew Today, Job and Task screens; crew tab set | 3 |
| Photo phase + quick-action flow | 1 |
| Report a problem with the safety prompt | 1 |
| Week + acknowledge (incl. `startTime` on the assignment, office field) | 2 |
| Push kinds (assigned, changed) | 1 |
| Spanish (i18n layer, ~250 strings, push text) | 2.5 |
| QA, TestFlight build, pilot set-up | 1.5 |
| **Release 1** | **≈ 17** |
| **Release 2** | ≈ 9: clock 2.5 · materials 1.5 · docs / plans 2.5 · daily-log roll-up 1.5 · wipe 1 |
| **Release 3** | ≈ 15, plus KNU's checklist content |
