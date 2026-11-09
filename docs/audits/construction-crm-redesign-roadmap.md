# Redesign roadmap — KNU Construction CRM (web)

Checkpoint 3, 2026-11-09. Six phases in the brief's order, built on the house pattern. Each phase is:
- built on its own branch;
- dev-QA'd: tests, typecheck, build, headless Chromium at 1440 and 400 px for every role it touches;
- clicked through by Richard;
- deployed with `KNUCO_PUBLIC_URL=https://crm.careyos.com`;
- followed by the regression suite (T-27) before the next phase starts.

Effort is in engineer-days, with one Claude Code session-day counted as one ([backlog](construction-crm-prioritized-backlog.md)).

| Phase | Goal | Tickets | Days | Exit check |
|---|---|---|---:|---|
| **A — Critical stabilization** | No screen lies or hangs: every refusal, missing record and validation error says what happened; no id shows in a picker; new tasks don't vanish | T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08 | 10.5 | Smoke pass for 4 roles: 0 stuck skeletons, 0 page errors, 0 unexpected 403s; the 7 pickers show names; the 14 flows green |
| **B — Design system foundation** | One font, one colour system, one button hierarchy, named controls, ConfirmDialog, StatusBadge, DataTable, PageHeader, phone touch targets | T-09, T-10, T-11, T-12, T-13, T-14, T-15, T-16, T-17 | 29.5 | `ui-measure.sh`: 0 raw palette classes, 0 native confirms, 87 / 87 PageHeader; axe 0 critical / serious on the 20 pages |
| **C — Primary workflows** | Tasks, dashboard and lead entry reworked on the new parts | T-18, T-19, T-20 | 3.5 | Task Done in 2 taps on a phone; attention visible without scrolling; no empty-form POST |
| **D — Secondary modules** | Permits, pickers, admin screens, money navigation, refusal wording | T-21, T-22, T-23, T-24, T-25 | 7 | Typed record fields replaced; admin screens axe-clean |
| **E — Advanced usability** | Saved views and search | T-26 (plus keyboard shortcuts and micro-interactions as found) | 4 | A saved view restores its rows |
| **F — Regression and release** | The audit's checks become the repo's | T-27 | 4 | One command reproduces the audit's tables and leaves the dev DB unchanged |

**Total: 58.5 engineer-days. About 73 with QA, click-throughs and deploys between phases, roughly 15 working weeks for one engineer.**

## Recommended sequence inside the phases

1. **Week 1 (quick wins, no design decision):** T-09 font, T-06 task assignee, T-05 pickers, T-07 messages, T-01 permit validation, T-04 plan sheets, T-17 touch targets, T-20, T-22, T-23, T-25. About 6.5 days. Each can ship on its own.
2. **Then** T-02 → T-03 → T-08, since every later screen relies on the query states.
3. **T-27 moves forward to run alongside Phase A.** The scripts already exist from this audit, and having the suite in the repo before Phase B means the token migration (the largest change) is checked by machine.
4. **Phase B order:** T-10 tokens → T-11 buttons → T-12 Field → T-14 StatusBadge → T-15 DataTable → T-13 / T-16. Migrate module by module together with each module's Phase C / D work, so no screen is touched twice.

## What would change the plan

- **Phases C–D as listed are the smallest useful set.** Fuller redesigns, such as a rebuilt job page or a new permits overview, need their screens drawn and approved first. Expect them to add roughly as much again as Phase C–D.
- **Release 3 of the mobile app (Twilio) competes for the same time.** The web phases don't depend on it.
- **If the font fix (T-09) changes how pages wrap more than expected,** run the screenshot pass before Phase B starts.
