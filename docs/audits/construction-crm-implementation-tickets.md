# Implementation tickets — KNU Construction CRM (web)

Checkpoint 3, 2026-11-09. Ordered by phase and dependency; each is sized for one Claude Code session or less and can be executed on its own once its dependencies are done. Scores and rank: [prioritized backlog](construction-crm-prioritized-backlog.md). Defect ids: [defect register](construction-crm-defect-register.md).

**Effort:** S ≤ ½ day · M 1–2 days · L 3–5 days · XL 1–2 weeks — one engineer (or one Claude Code session-day) including tests and dev QA; counted as 0.5 / 1.5 / 4 / 8 days.

**Every ticket also requires** (house rules): typecheck clean, lint at or under baseline, the full vitest suite green, `next build` clean, dev QA in headless Chromium at 1440 and 400 px for the roles it touches, dev database dumped before and its exact row counts matching after any write test, and explicit role lists (never `hasMinRole`) on anything that gates access.

## Order

- **Phase A — Critical stabilization:** T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08
- **Phase B — Design system foundation:** T-09, T-10, T-11, T-12, T-13, T-14, T-15, T-16, T-17
- **Phase C — Primary workflows:** T-18, T-19, T-20
- **Phase D — Secondary modules:** T-21, T-22, T-23, T-24, T-25
- **Phase E — Advanced usability:** T-26
- **Phase F — Regression and release:** T-27

## T-01 — Validate the job-permit create body with a schema

| | |
|---|---|
| Category | Data integrity |
| Priority | P2 · score 53 · Data integrity: values stored as sent |
| Phase | A |
| Module | Permits |
| Source | code-inspected |
| Files | src/app/api/jobs/[id]/permits/route.ts; src/lib/permits/rules.ts |
| Effort | S |
| Depends on | — |

**Current:** `POST /api/jobs/[id]/permits` reads `req.json()` and writes `permitFee`, dates and the status from the raw body; only `municipality` is checked.

**Expected:** The body is checked by a zod schema; a bad date, fee or status answers 400 with the field's message, as the PATCH route already does.

**Implementation:** `createPermitSchema` (status via `isPermitStatus`, dates as `yyyy-MM-dd` or ISO, fee ≥ 0, strings trimmed and capped) through `validateBody`; keep the jurisdiction lookup as is.

**Backend dependencies:** none · **Frontend:** none (the permit editor already sends valid values) · **Design system:** none

**Security:** Closes a write path that stores unchecked values; no change to who may call it (`guardJob`).

**Acceptance:** A fee of "abc", a date of "tomorrow" and status "X" each answer 400 naming the field; the editor's normal save still answers 201.

**Tests:** Route test for each refusal and the happy path; existing permit tests green.

## T-02 — One query-state wrapper: loading, refused, not found, failed

| | |
|---|---|
| Category | Functional defect |
| Priority | P2 · score 83 |
| Phase | A |
| Module | Shared (9 pages) |
| Source | D-01, D-03, D-04, D-05, D-10 |
| Files | new src/components/shared/query-state.tsx; src/app/(field)/field/jobs/[jobId]/logs/page.tsx; src/app/(field)/field/jobs/[jobId]/daily/[date]/page.tsx; src/app/(field)/field/tasks/[taskId]/page.tsx; src/app/(dashboard)/personnel/page.tsx; src/app/(dashboard)/personnel/[id]/page.tsx; src/app/(dashboard)/canvassing/page.tsx; src/app/(dashboard)/canvassing/[id]/page.tsx; src/app/(dashboard)/jobs/[id]/daily-logs/[date]/page.tsx; src/app/(dashboard)/field-logs/page.tsx; src/app/(dashboard)/referrals/page.tsx; src/app/(dashboard)/crew-submissions/page.tsx; src/app/(dashboard)/violations/templates/page.tsx; src/app/(dashboard)/partners/analytics/page.tsx; src/app/(dashboard)/response-dashboard/page.tsx; src/app/(dashboard)/vendors/page.tsx |
| Effort | L |
| Depends on | — |

**Current:** A refused (403) or missing (404) answer leaves loading placeholders forever on 9 pages, crashes the field logs page ("logs.map is not a function"), or shows zeros / an empty list on 3 pages; four different not-found wordings.

**Expected:** Every page shows one of four states from the same component: loading, "You don't have access to this" (403), "This … no longer exists" with a way back (404), "Couldn't load — Try again" (other). A day with no daily log offers "Start the log for this day".

**Implementation:** `<QueryState query={q} notFound={…} forbidden={…}>` reading `HttpError.status`; convert the listed pages' raw fetches to `fetchJson`; replace the empty defaults on the three D-05 pages with the refusal state.

**Backend dependencies:** none · **Frontend:** `fetchJson`, react-query · **Design system:** EmptyState, Button

**Security:** None; the refusal already happens on the server. The UI stops implying data is empty when it is withheld.

**Acceptance:** Each D-01/D-03/D-04/D-05 repro from the defect register shows the right state within 2 s, with no page error, at 1440 and 400 px, for the role named.

**Tests:** Unit test for the state choice by status; the smoke script's role passes report no skeleton older than 5 s on those routes.

## T-03 — Convert the remaining raw `fetch().then(r => r.json())` reads to `fetchJson`

| | |
|---|---|
| Category | Technical debt |
| Priority | P3 · score 61 |
| Phase | A |
| Module | Shared (≈30 files) |
| Source | code-inspected (root of D-01/D-04) |
| Files | the 29 files listed by `grep -rlE 'fetch\([^;]*\)\s*\.then\(\(?(r|res)\)? => \(?(r|res)\.json' src` (after T-02's pages) |
| Effort | M |
| Depends on | T-02 |

**Current:** Each treats a refusal or server error body as data.

**Expected:** Every client read throws on a non-2xx and is handled by T-02's states or a toast.

**Implementation:** Mechanical swap to `fetchJson`; an ESLint `no-restricted-syntax` rule for `.then(r => r.json())` in `src/components` and `src/app`.

**Backend dependencies:** none · **Frontend:** T-02 · **Design system:** none

**Security:** none

**Acceptance:** The grep returns 0; lint passes with the new rule.

**Tests:** Lint rule; typecheck; smoke pass for the touched pages.

## T-04 — Plan-sheet render answers 410 when the source PDF is missing

| | |
|---|---|
| Category | Functional defect |
| Priority | P2 · score 61 |
| Phase | A |
| Module | Plan takeoff |
| Source | D-02 |
| Files | src/lib/takeoff/sheet-cache.ts (`renderPathFor`); src/app/api/plan-sheets/**/route.ts; src/app/(dashboard)/plans/[planSetId]/page.tsx; the takeoff workspace viewer |
| Effort | S |
| Depends on | — |

**Current:** `renderPathFor` throws ENOENT from the worker; the route answers 500 and the sheet stays blank.

**Expected:** 410 "The plan file is missing — upload it again"; the viewer shows that message with Upload again, as Files does.

**Implementation:** Check the source path before forking the worker; map the missing case to the route's existing 410 branch; viewer reads 410.

**Backend dependencies:** none · **Frontend:** none · **Design system:** EmptyState

**Security:** none

**Acceptance:** With the PDF removed, the sheet request answers 410 and the viewer shows the message; with it present, sheets render as before.

**Tests:** Unit test on the missing-file branch; dev check with a moved file.

## T-05 — Pass `items` to every id-valued Select; render enum values by label

| | |
|---|---|
| Category | Functional defect |
| Priority | P2 · score 70 |
| Phase | A |
| Module | Shared (7 pickers) |
| Source | D-06 |
| Files | src/app/(dashboard)/permits/page.tsx (coordinator); src/components/jobs/field-assignments-panel.tsx; src/app/(dashboard)/personnel/page.tsx (crew); src/components/jobs/change-orders-panel.tsx (crew contract); src/app/(dashboard)/admin/follow-up-rules/page.tsx (trigger, stage, template, priority); src/app/(dashboard)/canvassing/properties/page.tsx (route); src/components/jobs/job-personnel-scope-panel.tsx |
| Effort | M |
| Depends on | — |

**Current:** After a pick the box shows the record id; before a pick some show "none" or "__none"; follow-up rules show LEAD_CREATED / MEDIUM.

**Expected:** Every picker shows the name or label, before and after a pick.

**Implementation:** `items` from the options already loaded (or `SelectValue` render function, as the task status picker does); a test that renders each Select with a picked id and asserts the label; a lint check for `<SelectValue` without children inside a Select with no `items` (warn).

**Backend dependencies:** none · **Frontend:** none · **Design system:** Select

**Security:** none

**Acceptance:** Each of the 7 pickers shows the name after a pick (browser check script `select3.mjs` extended to all 7, with dev fixtures for the canvassing route and personnel).

**Tests:** Component tests per picker; browser check script.

## T-06 — A task made from a "mine" view is assigned to its maker

| | |
|---|---|
| Category | Workflow defect |
| Priority | P2 · score 81 |
| Phase | A |
| Module | Tasks, Calendar |
| Source | D-12 |
| Files | src/components/tasks/add-task-dialog.tsx; src/app/(dashboard)/tasks/page.tsx (quick add); src/components/calendar/people-view.tsx (cell quick-create) |
| Effort | S |
| Depends on | — |

**Current:** New task and Quick add default to Unassigned; the page opens on Mine, so the task disappears after Create.

**Expected:** Opened from a Mine view (Tasks, My calendar, dashboard My tasks), the assignee defaults to the signed-in person, shown as "Assigned to you" and changeable. From Everyone it stays Unassigned and the toast says "Created — unassigned (see Everyone)".

**Implementation:** `defaults.assignedUserId = session.user.id` when the caller's scope is mine; toast variant when the new task would not be in the current list.

**Backend dependencies:** none · **Frontend:** `useListScope` · **Design system:** toast

**Security:** none (a user may always assign to self)

**Acceptance:** Create from Tasks (Mine) with only a title → the task is in the list, assigned to the creator; from Everyone → unassigned with the toast.

**Tests:** Component test of the defaults; browser flow `taskvis` in the regression script flips to pass.

## T-07 — Show the field's own message when validation fails

| | |
|---|---|
| Category | Functional defect |
| Priority | P3 · score 68 |
| Phase | A |
| Module | Shared (all forms) |
| Source | D-13, D-08 |
| Files | src/lib/fetch-json.ts; src/lib/validation/body.ts; src/app/api/prospects/route.ts; src/app/api/jobs/[id]/expenses/route.ts (amount schema) |
| Effort | S |
| Depends on | — |

**Current:** Toasts read "Validation failed"; expenses answer zod's "Too small: expected number to be >=0"; prospects answer a JSON dump.

**Expected:** The toast names the field and the problem ("Customer price must be greater than zero").

**Implementation:** `messageFor` uses the first `fields` entry when `error === "Validation failed"`; plain messages on the money schemas; prospects through `validateBody`.

**Backend dependencies:** the three routes · **Frontend:** `fetchJson` · **Design system:** toast

**Security:** none

**Acceptance:** Zero-price change order, bulk close with no reason, negative expense, prospect without city each toast a plain sentence.

**Tests:** Unit test for `messageFor`; route tests for the three wordings.

## T-08 — Hide what a role can't do: write buttons, nav entries, the owner strip call

| | |
|---|---|
| Category | Permissions UX |
| Priority | P3 · score 64 |
| Phase | A |
| Module | Leads, Tasks, Field, Money, Dashboard |
| Source | D-07, D-04 (buttons), D-11 |
| Files | src/components/layout/sidebar.tsx; src/app/(dashboard)/leads/page.tsx; src/app/(dashboard)/tasks/page.tsx; src/app/(dashboard)/personnel/page.tsx; src/components/dashboard/owner-strip.tsx; src/lib/access/roles.ts |
| Effort | M |
| Depends on | T-02 |

**Current:** READ_ONLY sees New Lead / New task; a sales rep sees Personnel, Daily Logs and Referrals in the sidebar and Add person on a page that refuses them; the dashboard calls `/api/attention/owner` for every role (403).

**Expected:** Buttons and nav entries follow the same role list the API uses; the owner strip is not requested for roles that may not see it.

**Implementation:** Nav `roles` from the existing access helpers (`canWriteLeads`, personnel / field-log readers); `enabled: canViewCompanyFinancials(role)` on the owner query.

**Backend dependencies:** none · **Frontend:** session role · **Design system:** none

**Security:** Display only; the server already refuses. No new rights.

**Acceptance:** Smoke pass as READ_ONLY and SALES_REP: no 403 in the failed-request log on any page they can open; no button whose action answers 403.

**Tests:** Nav role test (pure); smoke role passes.

## T-09 — Apply the Geist font (fix the self-referencing `--font-sans`)

| | |
|---|---|
| Category | Design system |
| Priority | P2 · score 74 |
| Phase | B |
| Module | Global |
| Source | D-14 |
| Files | src/app/globals.css (line 10) |
| Effort | S |
| Depends on | — |

**Current:** `--font-sans: var(--font-sans)` resolves to nothing; every page renders in Times; Geist is downloaded and unused.

**Expected:** Body and headings render in Geist; mono stays Geist Mono.

**Implementation:** `--font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif`; then re-run the screenshot pass and fix any text that now overflows (Geist is narrower than Times, so wrapping should improve).

**Backend dependencies:** none · **Frontend:** none · **Design system:** Typography tokens

**Security:** none

**Acceptance:** Computed `font-family` of body starts with Geist in full Chromium; smoke pass shows no new overflow at 400 px.

**Tests:** A test that parses globals.css for self-referencing custom properties; smoke pass.

## T-10 — Typography scale and status colour tokens; migrate raw palette classes

| | |
|---|---|
| Category | Design system |
| Priority | P3 · score 67 |
| Phase | B |
| Module | Global (176 files) |
| Source | UI audit |
| Files | src/app/globals.css; every file reported by `ui-measure.sh` (1,070 raw palette classes, 475 `text-[Npx]`) |
| Effort | XL |
| Depends on | T-09 |

**Current:** 2,323 token uses beside 1,070 hard-coded colours (439 of them status colours) and 475 arbitrary text sizes; 11 px muted text fails contrast.

**Expected:** Colour comes only from tokens (`neutral-*` surfaces, `tone-*` status, `stage-*`, `brand`); text sizes from a 6-step scale; muted text meets 4.5:1.

**Implementation:** Add `--surface-*` neutral tokens and a `text-2xs` (11 px, darker fg) step; codemod the common pairs (`bg-gray-50`→`bg-surface-subtle`, `text-red-600`→`text-tone-danger-fg`…), then hand-fix the rest module by module with Phase C/D screens; ESLint rule against raw palette classes in new code.

**Backend dependencies:** none · **Frontend:** none · **Design system:** Tokens (defines them)

**Security:** none

**Acceptance:** `ui-measure.sh` reports 0 raw palette classes and ≤ 20 arbitrary sizes (charts, exceptions documented); axe colour-contrast 0 on the 20 audited pages.

**Tests:** Lint rule; axe pass; screenshot pass.

## T-11 — Button hierarchy: one primary, named icon buttons, loading state

| | |
|---|---|
| Category | Design system |
| Priority | P3 · score 69 |
| Phase | B |
| Module | Global |
| Source | UI audit, axe button-name |
| Files | src/components/ui/button.tsx; 219 raw `<button>`s; icon-size Buttons (71); admin tables |
| Effort | L |
| Depends on | T-09 |

**Current:** brand, default and outline all lead forms; 29 unnamed buttons on 9 audited pages; 200 on three admin screens; no shared loading state.

**Expected:** Primary = `brand` (one per view), secondary = `outline`, tertiary = `ghost`, destructive; icon-only buttons require `aria-label` (type-enforced); `loading` prop shows a spinner and disables.

**Implementation:** Make `aria-label` required on `size="icon"` via a discriminated prop type; `loading` prop; migrate raw `<button>`s that act as buttons; codemod `variant="default"` on form submits to `brand`.

**Backend dependencies:** none · **Frontend:** none · **Design system:** Button

**Security:** none

**Acceptance:** axe button-name 0 on the 20 pages and the three admin screens; typecheck fails on an unnamed icon button.

**Tests:** Type test; axe pass.

## T-12 — Labels tied to fields; named Select triggers

| | |
|---|---|
| Category | Accessibility |
| Priority | P3 · score 60 |
| Phase | B |
| Module | Forms (469 labels) |
| Source | axe label, button-name |
| Files | src/components/ui/label.tsx, select.tsx; a new `Field` wrapper; the 170 form files |
| Effort | L |
| Depends on | T-11 |

**Current:** 469 `<Label>`s have no `htmlFor`; Select triggers have no accessible name.

**Expected:** A `Field` component (label, control, help text, error) wires `id`/`htmlFor`/`aria-describedby`/`aria-invalid` and names the Select trigger.

**Implementation:** `<Field label="Due" error={…} help={…}>{control}</Field>` using `useId`; migrate forms module by module with Phase C/D screens; a lint warning for `<Label>` without `htmlFor` outside `Field`.

**Backend dependencies:** none · **Frontend:** none · **Design system:** Field, Select, Input

**Security:** none

**Acceptance:** axe label 0 and button-name 0 on audited pages; clicking a label focuses its field.

**Tests:** Component test of `Field`; axe pass.

## T-13 — Replace native confirm() / prompt() with ConfirmDialog

| | |
|---|---|
| Category | Design system |
| Priority | P3 · score 56 |
| Phase | B |
| Module | 20 files |
| Source | UI audit |
| Files | the 20 files from `grep -rlE '\b(confirm|prompt)\(\s*["`]' src` (admin pages, daily-log approve / reopen, payroll, personnel, estimates, partners, task note edit, takeoff) |
| Effort | M |
| Depends on | — |

**Current:** 25 native dialogs block the page and can't name the effect or ask for a reason properly.

**Expected:** ConfirmDialog naming the effect ("Delete the rule 'Day 2 follow-up'?"); prompts become a dialog with a labelled field.

**Implementation:** `useConfirm()` hook returning a promise around ConfirmDialog to keep call sites short; a `PromptDialog` for the 2–3 prompt() uses; ESLint `no-restricted-globals` for confirm/prompt.

**Backend dependencies:** none · **Frontend:** none · **Design system:** ConfirmDialog

**Security:** none

**Acceptance:** grep returns 0; each converted action still works (browser check per module).

**Tests:** Lint rule; module browser checks.

## T-14 — StatusBadge: one way to show a status, with label and tone

| | |
|---|---|
| Category | Design system |
| Priority | P3 · score 65 |
| Phase | B |
| Module | Global |
| Source | D-09 (title code), UI audit |
| Files | new src/components/shared/status-badge.tsx; src/lib/ui/stage-colors.ts; the 87 Badge files; permit / inspection / expense / CO / invoice / task status renders |
| Effort | M |
| Depends on | T-10 |

**Current:** Status said three ways (tone chips, stage pills, coloured text); some raw codes ("BUILDING", "LEAD_CREATED").

**Expected:** `<StatusBadge kind="permit" value=…>` maps every enum to a label and a tone in one table; colour is never the only signal.

**Implementation:** A label + tone registry per enum (`lib/ui/status.ts`), tested for completeness against the Prisma enums; migrate renders module by module.

**Backend dependencies:** none · **Frontend:** none · **Design system:** Badge, tone tokens

**Security:** none

**Acceptance:** No raw enum value visible on the smoke screenshots (OCR-free check: a test that every enum has a label).

**Tests:** Registry completeness test.

## T-15 — DataTable: sortable, filterable lists on the table component

| | |
|---|---|
| Category | Design system |
| Priority | P3 · score 76 |
| Phase | B |
| Module | Jobs, Leads, Tasks, Vendors, Permits (38 tables) |
| Source | UI audit |
| Files | src/components/ui/table.tsx; new src/components/shared/data-table.tsx; jobs/leads/tasks/permits/vendors list pages; the 8 raw `<table>` files |
| Effort | XL |
| Depends on | T-10, T-11 |

**Current:** 1 of 38 tables sorts; sticky headers and phone layout differ; 8 raw tables.

**Expected:** One DataTable: column sort (URL-kept), sticky header, row actions menu, selection for bulk actions, empty and loading states, phone card layout below 640 px.

**Implementation:** Build on the existing `ui/table` + `@tanstack/react-table` (headless, MIT; already compatible with react-query — compare with hand-rolled sort first); server-side sort params where lists page.

**Backend dependencies:** sort params on `/api/jobs`, `/api/leads`, `/api/tasks` · **Frontend:** URL state hooks · **Design system:** Table, DropdownMenu, Checkbox, EmptyState

**Security:** Sort keys from an allow-list (no raw column names to Prisma).

**Acceptance:** Jobs, Leads and Tasks sort by every visible column, keep the sort in the URL, and render as cards at 400 px.

**Tests:** Query builder tests for the sort allow-list; browser checks per list.

## T-16 — PageHeader on the remaining 33 pages; dialog and sheet sizes

| | |
|---|---|
| Category | Design system |
| Priority | P3 · score 57 |
| Phase | B |
| Module | 33 pages, 94 dialog files |
| Source | UI audit |
| Files | src/components/shared/page-header.tsx; the 33 pages without it; src/components/ui/dialog.tsx, sheet.tsx |
| Effort | M |
| Depends on | T-09 |

**Current:** Two title styles; dialog widths set per call.

**Expected:** Every page: PageHeader (title, one-line purpose, actions right, breadcrumbs on records). Dialogs: `size` sm / md / lg / full-on-phone; forms longer than one screen use a Sheet.

**Implementation:** Add `size` to DialogContent; migrate pages with their Phase C/D screens.

**Backend dependencies:** none · **Frontend:** none · **Design system:** PageHeader, Dialog, Sheet

**Security:** none

**Acceptance:** 54/87 → 87/87 (excluding public pages, which keep their own header); no dialog with a hand-set width.

**Tests:** Screenshot pass.

## T-17 — Touch targets ≥ 44 px on phones

| | |
|---|---|
| Category | Accessibility |
| Priority | P3 · score 67 |
| Phase | B |
| Module | Global |
| Source | UI audit (31 / 54 small controls), axe target-size |
| Files | src/components/ui/button.tsx, input.tsx, select.tsx, checkbox.tsx |
| Effort | S |
| Depends on | T-09 |

**Current:** Controls 28–32 px tall at 400 px.

**Expected:** Below `sm`, interactive controls are ≥ 44 px tall (Apple / Google guidance); desktop density unchanged.

**Implementation:** Responsive height classes in the primitives (`h-11 sm:h-8` etc.).

**Backend dependencies:** none · **Frontend:** none · **Design system:** Component sizes

**Security:** none

**Acceptance:** The phone check in the regression script counts 0 controls under 44 px on New Lead and the task dialog.

**Tests:** Regression phone check.

## T-18 — Task sheet: Done / Undo button; read-only values on phone rows

| | |
|---|---|
| Category | Workflow |
| Priority | P3 · score 76 |
| Phase | C |
| Module | Tasks |
| Source | workflow analysis §1 |
| Files | src/components/tasks/task-detail-sheet.tsx; src/components/tasks/task-card.tsx; src/app/(dashboard)/tasks/page.tsx |
| Effort | M |
| Depends on | T-11, T-14 |

**Current:** Completing an ordinary task is a five-way dropdown; on a phone each row carries four editable controls.

**Expected:** A Done button with Undo in the toast (as workflow rows); on phones a row shows title, due, assignee, priority as text and opens the sheet.

**Implementation:** Reuse the workflow row's Done/Undo mutation; `md:` breakpoint switch in the card.

**Backend dependencies:** none · **Frontend:** T-15 (list) · **Design system:** Button, StatusBadge

**Security:** none (same `taskRightsFor`)

**Acceptance:** Done in two taps on a phone; Undo restores the prior status; a mis-tap on a phone row cannot change a value.

**Tests:** Browser flow `task` extended.

## T-19 — Dashboard: act-first layout

| | |
|---|---|
| Category | UI/UX |
| Priority | P3 · score 67 |
| Phase | C |
| Module | Dashboard |
| Source | UI audit |
| Files | src/app/(dashboard)/page.tsx; src/components/dashboard/* |
| Effort | M |
| Depends on | T-10 |

**Current:** Six $0 / 0 owner tiles and the business-development strip push Needs attention and My tasks below the fold at 1440 × 900.

**Expected:** Needs attention, Today and My tasks first; owner tiles compact (one row, hidden when all zero, "Nothing to report"); business development collapsible.

**Implementation:** Reorder; compact tile variant; persist collapsed sections per user (localStorage).

**Backend dependencies:** none · **Frontend:** none · **Design system:** Card, StatTile

**Security:** none

**Acceptance:** At 1440 × 900 Needs attention and My tasks are visible without scrolling for ADMIN and SALES_REP.

**Tests:** Screenshot pass.

## T-20 — New Lead: check required fields in the browser; close address suggestions on blur

| | |
|---|---|
| Category | Workflow |
| Priority | P3 · score 57 |
| Phase | C |
| Module | Leads |
| Source | workflow analysis §3 |
| Files | src/app/(dashboard)/leads/new/page.tsx; src/app/(dashboard)/leads/[id]/edit/page.tsx; src/components/shared/address-autofill-fields.tsx |
| Effort | S |
| Depends on | — |

**Current:** Empty submit round-trips to the server (400) before errors show; the address suggestions stay open over the next field.

**Expected:** Errors show instantly from the shared lead schema; suggestions close on blur and Escape.

**Implementation:** `zodResolver(createLeadSchema)` (the form already uses react-hook-form); blur handler in the address field.

**Backend dependencies:** none · **Frontend:** none · **Design system:** Field

**Security:** Server validation unchanged (still authoritative).

**Acceptance:** Empty submit makes no request and shows the 5 required-field messages.

**Tests:** Browser flow `lead` checks no POST on empty submit.

## T-21 — Searchable pickers where people type record names

| | |
|---|---|
| Category | Forms |
| Priority | P3 · score 66 |
| Phase | D |
| Module | Workflows, Violations, Budget, Field, Partners |
| Source | form census |
| Files | src/components/workflows/apply-workflow-dialog.tsx, reconcile-dialog.tsx; src/components/violations/case-dialogs.tsx, intake/intake-form.tsx, items-panel.tsx; src/components/jobs/budget-panel.tsx; src/components/jobs/field-assignments-panel.tsx; src/components/partners/bid-form-dialog.tsx |
| Effort | L |
| Depends on | T-12 |

**Current:** Jurisdiction (4 forms), budget category (3), field-assignment person (typed email), bid address (5 fields) and responsible trade are typed by hand.

**Expected:** Jurisdiction picker from the Jurisdiction records (free text kept as "Other"); budget category combobox from the job's categories; user picker with "invite by email"; `AddressAutofillFields` on bids; trade picker from the partners trade list.

**Implementation:** A generic `RecordCombobox` on `ui/command` (as `JobPicker`), with `/api/jurisdictions/options`, `/api/jobs/[id]/budget/categories`, trades options routes.

**Backend dependencies:** three small read routes with role guards · **Frontend:** T-12 Field · **Design system:** Combobox

**Security:** Option routes use the same read guards as their parent records.

**Acceptance:** Each field offers matching records after 1 typed character; saving stores the record id where the model has one (jurisdiction) and the text otherwise.

**Tests:** Route guard tests; component tests; browser checks on two forms.

## T-22 — Permit page: type label in the title, scrollable tabs

| | |
|---|---|
| Category | UI/UX |
| Priority | P3 · score 53 |
| Phase | D |
| Module | Permits |
| Source | D-09 |
| Files | src/app/(dashboard)/permits/[id]/page.tsx |
| Effort | S |
| Depends on | — |

**Current:** Title "BUILDING"; 13 tabs wrap to 3 rows at 400 px.

**Expected:** Title from the permit type's label; one scrollable tab row (the job page's pattern).

**Implementation:** Label lookup via T-14 registry or the type catalog; reuse the job page's tab list classes.

**Backend dependencies:** none · **Frontend:** none · **Design system:** Tabs, StatusBadge

**Security:** none

**Acceptance:** Title shows "Building permit — <address>"; tabs one row at 400 px.

**Tests:** Screenshot pass.

## T-23 — Refusals say who may do it

| | |
|---|---|
| Category | UI/UX |
| Priority | P3 · score 54 |
| Phase | D |
| Module | API (change orders, tasks bulk / delete, reports) |
| Source | workflow analysis |
| Files | src/app/api/change-orders/[id]/decision/route.ts; src/app/api/tasks/bulk/route.ts; src/app/api/tasks/[id]/route.ts (DELETE); src/app/api/reports/financials/route.ts |
| Effort | S |
| Depends on | — |

**Current:** These answer a bare "Forbidden".

**Expected:** "Only an admin or a manager can approve change orders." (as expense review already does).

**Implementation:** A `forbidden(message)` helper used by these routes.

**Backend dependencies:** these routes · **Frontend:** none · **Design system:** toast

**Security:** Message names the role list only; no record data.

**Acceptance:** Each answers 403 with a sentence naming the roles.

**Tests:** Route tests.

## T-24 — Admin screens: row action menus and named controls

| | |
|---|---|
| Category | UI/UX |
| Priority | P3 · score 41 |
| Phase | D |
| Module | Admin (follow-up rules, job task templates, message templates) |
| Source | UI audit (200 unnamed icon buttons) |
| Files | src/app/(dashboard)/admin/follow-up-rules/page.tsx; src/app/(dashboard)/admin/job-task-templates/page.tsx; src/app/(dashboard)/admin/templates/page.tsx |
| Effort | M |
| Depends on | T-13, T-15 |

**Current:** Rows of unnamed pencil / bin / arrow icon buttons with native confirms.

**Expected:** DataTable rows with a ⋯ menu (Edit, Duplicate, Move, Delete with ConfirmDialog).

**Implementation:** Apply T-15 and T-13 to the three screens.

**Backend dependencies:** none · **Frontend:** none · **Design system:** DataTable, DropdownMenu, ConfirmDialog

**Security:** none

**Acceptance:** axe clean on the three screens.

**Tests:** axe pass.

## T-25 — Money in one place: crew payments reachable from Money

| | |
|---|---|
| Category | Navigation |
| Priority | P3 · score 54 |
| Phase | D |
| Module | Job page |
| Source | workflow analysis §4 |
| Files | src/components/jobs/job-overview.tsx; the job page's Money tab nav |
| Effort | S |
| Depends on | — |

**Current:** Crew pay lives under Field → Labor, change orders and expenses under Money.

**Expected:** Money → "Crew contracts & payments" sub-tab (the same panel, mounted in both places) or a link row on Money's overview.

**Implementation:** Mount the labor panel under Money as well; keep Field → Labor for field roles.

**Backend dependencies:** none · **Frontend:** none · **Design system:** Tabs

**Security:** Panel already checks `jobMoneyView`.

**Acceptance:** From Money, crew payments are one click away; field roles unchanged.

**Tests:** Browser check.

## T-26 — Saved filters and search on the main lists

| | |
|---|---|
| Category | Usability |
| Priority | — · score 58 |
| Phase | E |
| Module | Jobs, Leads, Tasks |
| Source | — |
| Files | src/lib/lists/*; list pages |
| Effort | L |
| Depends on | T-15 |

**Current:** Filters live in the URL only.

**Expected:** Name and save a filter set per user; ⌘K finds saved views.

**Implementation:** `UserSavedView` table (additive migration); toolbar menu.

**Backend dependencies:** migration + CRUD routes (own rows only) · **Frontend:** T-15 · **Design system:** DataTable toolbar

**Security:** Views store filter params only; visibility still enforced by the list routes.

**Acceptance:** A saved view restores the same rows after reload.

**Tests:** Route tests; browser check.

## T-27 — Regression suite in the repo: smoke, workflows, axe, refusals

| | |
|---|---|
| Category | Quality |
| Priority | — · score 63 |
| Phase | F |
| Module | Testing |
| Source | test strategy |
| Files | new scripts/qa/ (from the audit's smoke.mjs, wf.mjs, neg-rep.sh, select3.mjs, axe.mjs, counts.sh); package.json scripts |
| Effort | L |
| Depends on | — |

**Current:** The audit's browser and refusal checks live in a session scratchpad.

**Expected:** `npm run qa:smoke`, `qa:flows`, `qa:axe`, `qa:roles` against a dev server, with dump / restore around write flows and a summary table; run after every phase.

**Implementation:** Move the scripts, read paths from env, keep playwright-core + the cached Chromium (no new runtime dependency); fixtures created and removed by the scripts.

**Backend dependencies:** none · **Frontend:** none · **Design system:** none

**Security:** Refuses to run unless the database URL is localhost.

**Acceptance:** One command reproduces this audit's tables; a run leaves exact row counts unchanged.

**Tests:** It is the test.
