# Functional audit — KNU Construction CRM (web)

Checkpoint 2 of the audit (steps 3–5 of the approved plan), 2026-11-09. Commit `2ad2f9d`. Companion to the [defect register](construction-crm-defect-register.md) and the [route inventory](construction-crm-route-inventory.md).

**How each claim was checked** — every row carries one of these:

- **Browser** — driven in headless Chromium on the dev server (clicks, typing, keyboard), result read back from the screen and the database.
- **API** — called against the dev server with the same session the browser uses, result read back from the database; the screen was then opened to see the result shown (**API + screen**).
- **Code** — read in the source, not run.

All writes went to the dev database only, with throw-away records. The database was dumped before the run and restored afterwards; an exact row count of all 176 tables matched the dump (`exact-wf-before.txt` = `exact-wf-after.txt`). No production system was touched.

## Coverage

| What | Covered | Of | How |
|---|---:|---:|---|
| Pages loaded, ADMIN and SALES_REP, 1440 + 400 px | 87 | 87 | Browser (checkpoint 1) |
| Pages loaded, READ_ONLY | 55 | 87 | Browser (office pages; field pages redirect) |
| Pages loaded, CREW_LEAD | 17 | 87 | Browser (field, public, sample pages; office pages redirect) |
| Planned workflows run | 14 | 14 | 7 driven in the browser, 7 by API with the result checked on screen |
| Refused-role calls (SALES_REP against another rep's records) | 11 | 11 held | API |
| Accessibility (axe-core) | 20 | 87 | Browser |
| Dropdowns suspected of showing ids | 5 | 7 | Browser (2 not testable: dev has no canvassing routes or personnel) |

## Workflow results

| # | Flow | How | Result | Notes |
|---|---|---|---|---|
| 1 | New lead → estimate → Won → job | Browser (estimate by API) | Works | Empty form refused with inline errors (after a 400 round trip to the server). Won dialog offered the sent estimate; the job was created at its price ($250), Overview showed it. |
| 2 | A task's whole life | Browser + API | Works, one defect | Title required (Create disabled). Note posted from the sheet. Complete → reopen clears `completedAt`; the timeline shows both moves. **D-12:** a task made from the Tasks page with the default settings is saved with nobody assigned and is not in the "mine" list the page opens on. Completing from the sheet's status dropdown was not re-run after the selector fix. |
| 3 | File upload → preview → download → delete | Browser + API | Works | Upload through the Files tab input; the preview dialog opened with the PDF frame; download is an attachment; delete → 404 afterwards. |
| 4 | Permit → inspection → correction task | API + screen | Works | Bad status refused with a clear message; a FAIL raised "Correct failed inspection items — framing inspection (BUILDING permit)" at HIGH; the Permits tab shows the failure. |
| 5 | Expense → approval | Browser | Works | Negative amount refused, but with zod's raw wording ("Too small: expected number to be >=0"). Approve from Money → Expenses moved the PENDING charge to APPROVED. |
| 6 | Crew payment request → paid | API + screen | Works | Request → accountant task; payment against the request → request PAID and task COMPLETED; Field → Labor shows both. |
| 7 | Change order | API + screen | Works | Contract $250 → $750 on approval; a second approval refused (409). Zero price refused but the toast would read "Validation failed" (**D-13**). |
| 8 | Daily log | API + screen | Works | Write → submit → approve; approving twice refused with a clear message. |
| 9 | Calendar move | Browser (keyboard drag) | Works | Space, →, Space moved the task from Nov 11 to Nov 12. A task with nobody assigned is not on the default "My calendar" view (same root as D-12). |
| 10 | Vendor | Browser | Works | Created through the dialog; a duplicate name refused (409, clear message). |
| 11 | Crew link | API (existing check script) | Works | 33 of 35; both misses are the script's own expectation (an expired link answers 404, the script expects 308), as when written. |
| 12 | Bulk overdue clean-up | Browser | Works | Overdue filter → "Move all to this day" → confirmation "Move 2 overdue tasks to 2026-11-20?" → both moved. Close without a reason refused, again as "Validation failed" (D-13). |
| 13 | Negative: missing required field | Browser + API | Works | Lead form, task dialog, expense, change order, permit status, bulk close — all refused; three answer with an unhelpful message (D-13). |
| 14 | Negative: refused role | API as SALES_REP | Holds | Another rep's job / lead / permit → 404; approve expense, decide change order, pay crew, bulk tasks, edit / delete another's task, financial report → 403. The rep's own task → 201. |

## Module status

| Module | Status | Evidence | Open items |
|---|---|---|---|
| Leads | Works | Browser flow 1; 87-page smoke | D-07 (read-only sees New Lead) |
| Estimates → Won → job | Works | Browser flow 1 | — |
| Jobs (overview, money, field, files) | Works | Flows 1, 3, 5–8 | D-06 (crew contract picker shows an id) |
| Tasks | Works with a defect | Flows 2, 12 | D-12, D-13 |
| Calendar | Works | Flow 9 | Unassigned tasks hidden by default (D-12) |
| Permits + inspections | Works | Flow 4 | D-09 (title code, tab wrap) |
| Plan sets / takeoff | Sheet render fails without the source file | Checkpoint 1 | D-02 |
| Expenses + approvals | Works | Flow 5 | Raw validation wording (D-13) |
| Labor contracts + crew payments | Works | Flow 6 | — |
| Change orders | Works | Flow 7 | D-06, D-13 |
| Daily logs (office) | Works | Flow 8 | D-03 (a day with no log loads forever) |
| Field mode | Works for the crew lead's own jobs | Checkpoint 1 | D-01, D-04 |
| Vendors | Works | Flow 10 | D-05 (rep sees an empty directory) |
| Crew links (guest) | Works | Flow 11 | — |
| Personnel, referrals, field logs | Admin fine; other roles stuck loading | Checkpoint 1 | D-03, D-04 |
| Admin → Follow-up rules | Works; picker shows ids | Select test | D-06 |
| Partners / bids / vault | Pages load for every role; no write flow run here | Checkpoint 1 smoke | Write flows not run in this audit |
| Violations | Pages load; no case on dev | Checkpoint 1 smoke | Write flows not run in this audit |
| Permit AI features | Not run (AI keys blanked on purpose) | — | Not tested |

## Code-inspected risks (not run)

- **About 30 files read API answers with a bare `fetch().then(r => r.json())`** (29 by the current pattern count; `fetchJson` is used in 113). Each can turn a refusal or server error into a stuck or wrong screen, as D-01 and D-04 did when they were run.
- **`POST /api/jobs/[id]/permits` reads the raw body with no schema** (`src/app/api/jobs/[id]/permits/route.ts`): `permitFee` and the dates are passed through as sent. The house pattern is `validateBody`.
- **25 native `confirm()` / `prompt()` calls in 20 files**, against `ConfirmDialog` in 26. They block the page, can't be styled, and are skipped by keyboard and screen-reader patterns the rest of the app follows.
- **`validateBody` errors lose their field messages on the way to the screen**: the route answers `{ error: "Validation failed", fields: {...} }` and `fetchJson` shows only `error` (D-13).

## Not tested

- AI-backed actions (permit reading, takeoff analysis, document assistant): the keys were blanked so nothing reached outside services.
- Outgoing mail and SMS: blanked for the same reason; the code paths that send were run (assignment, payment request), the send itself was not.
- Partner, bid, vault and violation write flows; the customer signing page end to end.
- The mobile app (separate project; its own checks ran at Release 2).
