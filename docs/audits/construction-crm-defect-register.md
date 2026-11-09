# Defect register — KNU Construction CRM (web)

Checkpoints 1 and 2 of the audit (steps 1–5 of the approved plan), 2026-11-09. Commit `2ad2f9d`. D-01 to D-11 come from the page smoke pass; D-12 to D-14 from the workflow tests and the UI audit ([functional audit](construction-crm-functional-audit.md), [UI / UX audit](construction-crm-ui-ux-audit.md)).

**Environment:** local dev server (`next dev`, port 4000) on the dev database, sign-in through the dev bypass, outside services (mail, AI, SMS, Zylow) switched off. Headless Chromium at 1440 × 900 and 400 × 860. Accounts: ADMIN (all 87 pages), SALES_REP (all 87), CREW_LEAD (17 field / public / sample pages), READ_ONLY (55 office pages). Throw-away records (vendor, person, GC account, prospect, permit, violation case) were created for the record pages and removed afterwards; the dev database was checked table by table against a dump taken before the audit (identical row counts).

**Evidence:** `results-<role>.json` (one row per page and width: status, final URL, console and page errors, failed API calls, overflow, screenshot), screenshots under `shots/<role>/`, `axe.json`, `selects.json`. Kept in the session scratchpad `audit/` folder.

**Severity:** P0 critical (security, data exposure, data corruption) · P1 core workflow broken · P2 partial / misleading / stuck · P3 cosmetic or minor.

## Headline

- **No P0 or P1 found in either pass.** All 14 planned workflows complete end to end (7 driven in the browser, 7 by API with the result checked on screen); 11 refused-role calls as a sales rep against another rep's records all held. Every role refusal held: a sales rep, crew lead and read-only account were refused (403 / 404 / redirect) on every page and API their role may not use, and no page showed another role's data. No page crashed for ADMIN, and no page overflowed sideways at phone width for any role.
- **The main fault class is error handling:** a refused or missing record leaves 9 pages on loading placeholders forever, and 1 page crashes. Root cause in most: a bare `fetch(...).then(r => r.json())` that treats an error answer as data (31 files still use it; `fetchJson` is the house rule).

## Verified defects

| ID | Sev | Route | What happens | Repro | Likely cause | Fix |
|---|---|---|---|---|---|---|
| D-01 | P2 | `/field/jobs/[jobId]/logs` | Page crashes: "This page hit an error — logs.map is not a function" | Crew lead opens the logs of a job they are not on (API 403) | Error JSON passed to `.map` (raw fetch) | `fetchJson` + a refusal state |
| D-02 | P2 | `/plans/[planSetId]`, `/takeoff/[takeoffId]` | Sheet image request answers 500; sheet stays blank | Plan set whose PDF is missing on disk | `renderPathFor` throws ENOENT from the extraction worker; the route's own 410 "missing on disk" branch is never reached | Catch a missing source in `renderPathFor` → 410; viewer shows "file missing, upload again" (as Files does) |
| D-03 | P2 | `/personnel/[id]`, `/canvassing/[id]`, `/field/tasks/[taskId]`, `/jobs/[id]/daily-logs/[date]` | Missing record (or a day with no log) → loading placeholders / "Loading route…" forever | Open any of them with an id that does not exist | Query error not rendered (raw fetch or no `isError` branch) | Shared not-found state (the jobs / leads pages already have one) |
| D-04 | P2 | `/personnel`, `/field-logs`, `/referrals` (SALES_REP); `/canvassing`, `/crew-submissions`, `/violations/templates` (READ_ONLY); `/field/jobs/[jobId]/daily/[date]` (CREW_LEAD off the job) | Data refused (403) → loading placeholders forever; write buttons ("Add person", "New Route") still shown | Open as the role named | No refusal branch | Shared "You don't have access to this" state; hide the write buttons by the same permission the API uses |
| D-05 | P2 | `/partners/analytics`, `/response-dashboard`, `/vendors` (SALES_REP) | Data refused but the page shows zeros / an empty list — reads as "no data" | Open as SALES_REP | Error swallowed into empty defaults | Refusal state, or hide the nav entry for that role |
| D-06 | P2 | Permits list → Coordinator filter; Job → Daily logs → field assignment; Personnel → Add person → Crew; Change order → Linked crew contract; Admin → Follow-up rule → Message template | After picking, the box shows the record id (`cmo75a652…`) instead of the name; before a pick some show "none" / "__none"; the follow-up rule's Trigger and Priority show raw codes ("LEAD_CREATED", "MEDIUM") | Pick any option | Base UI `Select` without `items` (the 2026-10-04 lesson) | Pass `items` (or a `SelectValue` render function) — 2 more selects use the same pattern (see suspected) |
| D-07 | P3 | `/leads`, `/leads/new`, `/tasks` (READ_ONLY) | "New Lead" / "New task" offered; saving is refused (403) | Read-only account | Buttons not gated by role | Gate with `canWriteLeads` / task rights |
| D-08 | P3 | `POST /api/prospects` | A validation error comes back as a raw JSON dump in `error` | Post without `city` | Route returns `JSON.stringify(zodIssues)` | `validateBody` (house pattern) |
| D-09 | P3 | `/permits/[id]` | Title is the raw type code ("BUILDING"); 13 tabs wrap onto 3 rows on a phone | Open a permit | Type key shown instead of its label; tab list not scrollable | Label lookup; horizontal-scroll tab list (as job page) |
| D-10 | P3 | Not-found pages | Four different wordings and layouts ("X not found", "Couldn't load…", "The X did not load", blank) | Open missing records across modules | No shared component | One `NotFoundState` |
| D-12 | P2 | `/tasks` (New task dialog and Quick add); `/calendar` | A task made with the default settings is saved with **nobody assigned**; the page opens on "Mine", so the new task is not in the list and looks unsaved. The calendar's default view hides it too | Tasks → New task → a title → Create | The dialog's assignee defaults to none; the list defaults to Mine | Default the assignee to the creator when the dialog opens from a "mine" view, and say so; or show "Created — unassigned, see Everyone" |
| D-13 | P3 | Any form posting to a `validateBody` route (change orders, bulk tasks, vendors…); expenses | The toast reads "Validation failed" — the field message ("Customer price must be greater than zero", "say why they are being closed") is dropped. Expense amounts answer zod's raw "Too small: expected number to be >=0" | Zero-price change order; bulk close with no reason (API-verified; toast path code-inspected) | `fetchJson` shows only `error`, and the reason is in `fields` | `fetchJson` uses the first `fields` message when present; plain wording in the schemas |
| D-14 | P2 | Every page | **The app renders in Times, not Geist.** The font is downloaded and never applied | Open any page; computed `font-family` of `body` is `Times` (headless and full Chromium) | `globals.css`: `--font-sans: var(--font-sans)` refers to itself, so it resolves to nothing | `--font-sans: var(--font-geist-sans)` — one line; then check the screens, since every width changes |
| D-11 | P3 | `/` (SALES_REP, READ_ONLY rows vary) | Dashboard calls `/api/attention/owner` for every role; refused 403 each load | Load the dashboard as a rep | Strip hidden after the call, not before | Ask only when `canViewCompanyFinancials` |

## Accessibility (axe-core, WCAG 2.2 AA tags, 20 key pages as SALES_REP)

| Rule | Impact | Pages | Elements | Where |
|---|---|---:|---:|---|
| button-name | critical | 9 | 29 | select triggers and icon buttons (tasks, jobs, job page…); plus 90 / 52 / 58 unnamed icon buttons on Admin → Follow-up rules / Job task templates / Templates (smoke count) |
| label | critical | 4 | 11 | tasks filters, job page, permit page |
| color-contrast | serious | 2 | 14 | dashboard warning chips (11 px muted text on tinted background), job stage buttons |
| target-size | serious | 3 | 3 | small text links in card headers |
| aria-progressbar-name, aria-toggle-field-name, link-in-text-block | serious | 1 each | 1 each | job page |
| aria-required-attr | critical | 1 | 1 | New Lead address autocomplete |
| aria-prohibited-attr | serious | 1 | 1 | partners board |

## Suspected (code-inspected, not clicked)

- **Two more selects that will show an id after a pick** (same pattern as D-06; not testable on dev, which has no canvassing routes or personnel): Canvassing → Find properties (route), Job → personnel scope (person). Admin → Follow-up rules → target stage appears only for stage triggers and was not opened. The change-order and message-template pickers suspected at checkpoint 1 are now verified (D-06).
- **`POST /api/jobs/[id]/permits` takes the raw body with no schema**: fee and dates are stored as sent.
- **About 30 files read API answers with a bare `fetch().then(r => r.json())`** (29 by the latest pattern count, 31 by checkpoint 1's) — each can turn a refusal or server error into a stuck or wrong screen like D-01 / D-04. List in the functional audit.
- **25 native `confirm()` / `prompt()` calls in 20 files** (checkpoint 1 estimated ~40 by a looser search) (Admin pages, daily-log approve / reopen, payroll, personnel, estimates, partners "not pursued", task note edit, takeoff) where the app has `ConfirmDialog`.

## Not a defect (checked)

- Admin → Users role picker shows the role name (flagged by the code scan; the page renders its own label).
- Crew leads are sent to Field mode from every office page; admin pages send other roles to the dashboard.
- Invalid public links (`/g`, `/co`, `/sign`, `/action`) show a clear message.
- Workflow checks re-run this session: approvals + expenses 15/16, leads 14/14, files 7/7, crew links 33/35 — every miss was the check's own expectation (an unsigned request gets the sign-in redirect, 307), as recorded when they were written.
