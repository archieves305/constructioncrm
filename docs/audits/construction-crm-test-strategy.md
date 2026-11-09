# Test strategy — KNU Construction CRM (web)

Checkpoint 3, 2026-11-09. How each roadmap phase is checked, and how the audit's own checks become permanent (ticket T-27).

## Principles

1. **Live evidence over reading.** A claim that something works cites a run: a browser step, an API call read back from the database, or a test. Code inspection is labelled as such and never counted as verification. That is how this audit reported coverage.
2. **Writes only on the dev database, restored after.** Dump first (`pg_dump -Fc`), then compare an exact `count(*)` of every table after the run. `pg_stat` estimates are not exact enough. The suite refuses to run against anything but localhost.
3. **Outside services off.** Start the dev server with the mail, AI, SMS and Zylow keys blank, so a test can never send.
4. **Every role, both widths.** ADMIN, MANAGER, SALES_REP, CREW_LEAD and READ_ONLY, at 1440 and 400 px. The dev bypass writes the role onto the dev user, so reset john.rep to SALES_REP afterwards.

## Layers

| Layer | Tool (already in the project) | What it covers | When |
|---|---|---|---|
| Unit | vitest (≈1,950 tests) | Pure libraries: access rules, money, schedules, status registries, query builders | Every change |
| Route | vitest + `route-guards.test.ts` | Every handler has a guard; new routes get refusal tests | Every change |
| Static | typecheck, ESLint (+ the new rules: raw palette, arbitrary text size, native confirm, raw fetch-json, unnamed icon buttons), CSS self-reference test | Design-system drift, error-handling drift | Every change |
| Smoke | `qa:smoke` (from `smoke.mjs`) — headless Chromium | All 87 pages per role and width: status, page errors, failed calls, sideways overflow, skeletons still showing after 5 s, unnamed controls, screenshot | End of each phase |
| Workflows | `qa:flows` (from `wf.mjs`, 14 flows) | Lead → job, task life, files, permit → correction, expense approval, crew payment, change order, daily log, calendar move, vendor, crew link, bulk clean-up, missing-field and refused-role cases | End of each phase; the touched flows on every ticket |
| Roles | `qa:roles` (from `neg-rep.sh`) | Off-scope ids answer 404; money and approvals answer 403 with a sentence | End of each phase |
| Pickers | `qa:selects` (from `select3.mjs`) | Every id-valued Select shows a name after a pick | Phases A, B, D |
| Accessibility | `qa:axe` (axe-core injected, not a dependency) | WCAG 2.2 AA tags on the 20 key pages plus each redesigned screen | End of each phase |
| Visual | Screenshot pass, before / after per redesigned screen | Layout regressions, the font change | Phases B–D |
| Manual | Richard's click-through on prod | The real data and the real devices | After each deploy |

## Phase gates

| Phase | Must pass before deploy |
|---|---|
| A | Smoke: 0 page errors and 0 stuck skeletons for 4 roles; flows 14 / 14; roles all hold; pickers 7 / 7 show names |
| B | Everything in A, plus axe 0 critical / serious on 20 pages, `ui-measure.sh` targets, and a screenshot review of every page at both widths |
| C–D | A + B, plus before / after screenshots of each redesigned screen and that module's flows extended with the new interactions |
| E | Saved-view round trip; search finds by address, number and name |
| F | The full suite twice in a row, the dev DB unchanged, and no regression against the checkpoint-1 route inventory |

## Fixtures

Dev data is thin: no permits, partners, personnel, violations, vendors, prospects, door-knock routes or daily logs. The suite creates what each flow needs, with names starting "QA", and removes it. The dump / restore is the safety net, not the plan. Add fixtures for a canvassing route and a personnel record so the two still-suspected pickers can be clicked.

## Not covered by this strategy

Production load and performance (none measured in this audit), AI output quality (the permit and takeoff features have their own benchmark sets), the mobile app (its own `release*-check.sh` scripts), and email rendering in real mail clients.
