# Route inventory — KNU Construction CRM (web)

Generated 2026-11-09 from `src/app/**/page.tsx` (87 pages) and a headless-Chromium load of every page on the dev server at 1440 and 400 px, once per role.

**Cell legend:** `ok` = loaded at both widths with no page error, no failed API call, no sideways overflow · `→ /x` = redirected · `api 403` = an API call was refused (expected when the role may not see it) · `not run` = no record id on dev.

Roles run: ADMIN, SALES_REP, CREW_LEAD, READ_ONLY. Record pages (person, partner, permit, vendor, violation case) were loaded as ADMIN with throw-away records; other roles saw them too.

| Route | Kind | API calls | ADMIN | SALES_REP | CREW_LEAD | READ_ONLY | Notes |
|---|---|---:|---|---|---|---|---|
| `/` | office | 4 | ok | api 403 | → /field | ok | Asks for the owner summary on every load; refused (403) for non-owner roles (D-11). |
| `/action/[token]` | public | 0 | ok | ok | ok | not run |  |
| `/admin/ai-usage` | office | 1 | ok | → /, api 403 | not run | not run |  |
| `/admin/canvassing-settings` | office | 1 | ok | → /, api 403 | not run | not run |  |
| `/admin/contract-templates` | office | 8 | ok | → /, api 403 | not run | not run |  |
| `/admin/contract-templates/[id]` | office | 0 | ok | → /, api 403 | not run | not run |  |
| `/admin/follow-up-rules` | office | 4 | ok | → /, api 403 | not run | not run | 90 icon buttons with no accessible name; native confirm() on delete. |
| `/admin/job-cost-reconciliation` | office | 4 | ok | → /, api 403 | not run | not run |  |
| `/admin/job-task-templates` | office | 4 | ok | → /, api 403 | not run | not run | 52 icon buttons with no accessible name; native confirm(). |
| `/admin/notifications` | office | 3 | ok | → /, api 403 | not run | not run |  |
| `/admin/nurture` | office | 8 | ok | → /, api 403 | not run | not run |  |
| `/admin/partners` | office | 20 | ok | → /, api 403 | not run | not run |  |
| `/admin/permits` | office | 10 | ok | → /, api 403 | not run | not run |  |
| `/admin/permits/forms/[id]` | office | 6 | ok | → /, api 403 | not run | not run |  |
| `/admin/phones` | office | 3 | ok | → /, api 403 | not run | not run |  |
| `/admin/roofing` | office | 8 | ok | → /, api 403 | not run | not run |  |
| `/admin/settings` | office | 10 | ok | → /, api 403 | not run | not run |  |
| `/admin/templates` | office | 4 | ok | → /, api 403 | not run | not run | 58 icon buttons with no accessible name; native confirm(). |
| `/admin/users` | office | 3 | ok | → /, api 403 | not run | not run |  |
| `/admin/workflow-role-defaults` | office | 17 | ok | → /, api 403 | not run | not run |  |
| `/admin/workflow-templates` | office | 1 | ok | → /, api 403 | not run | not run |  |
| `/admin/workflow-templates/[id]` | office | 0 | ok | → /, api 403 | not run | not run |  |
| `/attention/[key]` | office | 2 | ok | ok | not run | ok |  |
| `/calendar` | office | 0 | ok | ok | → /field | ok |  |
| `/canvassing` | office | 3 | ok | ok | not run | api 403 |  |
| `/canvassing/[id]` | office | 5 | ok | ok | not run | ok | Missing route → "Loading route…" forever (D-03). |
| `/canvassing/properties` | office | 5 | ok | ok | not run | ok |  |
| `/canvassing/prospects` | office | 5 | ok | ok | not run | ok |  |
| `/co/[token]` | public | 0 | ok | ok | ok | not run |  |
| `/collections` | office | 2 | ok | ok | not run | ok |  |
| `/crew-submissions` | office | 3 | ok | ok | not run | api 403 |  |
| `/crews` | office | 3 | ok | ok | not run | ok |  |
| `/field` | field | 2 | ok | → /, api 403 | ok | not run |  |
| `/field-logs` | office | 2 | ok | api 403 | → /field | not run | Refused for SALES_REP → loading placeholders forever (D-04). |
| `/field/day` | field | 6 | ok | → /, api 403 | ok | not run |  |
| `/field/jobs/[jobId]/daily/[date]` | field | 11 | api 404 | → /, api 403 | api 403 | not run | Refused (crew lead off the job) → loading placeholders forever (D-04). |
| `/field/jobs/[jobId]/logs` | field | 6 | ok | → /, api 403 | api 403 | not run | Refused → crashes: "logs.map is not a function" (D-01). |
| `/field/tasks` | field | 4 | ok | → /, api 403 | ok | not run |  |
| `/field/tasks/[taskId]` | field | 8 | ok | → /, api 403 | api 403 | not run | Missing or refused task → loading placeholders forever (D-03). |
| `/g/[token]` | public | 0 | ok | ok | ok | not run | Bilingual invalid-link page; no heading element. |
| `/jobs` | office | 21 | ok | ok | → /field | ok |  |
| `/jobs/[id]` | office | 95 | ok | ok | → /field | ok |  |
| `/jobs/[id]/daily-logs/[date]` | office | 4 | api 404 | api 404 | not run | api 404 | Day with no log → loading placeholders forever (D-03). |
| `/leads` | office | 10 | ok | ok | → /field | ok |  |
| `/leads/[id]` | office | 25 | ok | api 404 | not run | ok |  |
| `/leads/[id]/edit` | office | 4 | ok | api 404 | not run | ok |  |
| `/leads/new` | office | 5 | ok | ok | not run | ok |  |
| `/login` | auth | 0 | → https://app.careyo | → https://app.careyo | not run | not run |  |
| `/notifications` | office | 3 | ok | ok | not run | ok |  |
| `/partners` | office | 20 | ok | ok | not run | ok |  |
| `/partners/[id]` | office | 28 | ok | ok | not run | ok | Clear not-found state (good pattern). Only list in the CRM that sorts (partners list). |
| `/partners/analytics` | office | 20 | ok | api 403 | not run | ok | Refused for SALES_REP but shows empty figures, reads as "no data" (D-05). |
| `/partners/bids` | office | 24 | ok | ok | not run | ok |  |
| `/partners/contacts` | office | 22 | ok | ok | not run | ok |  |
| `/partners/intake` | office | 22 | ok | ok | not run | api 403 |  |
| `/partners/qualifications` | office | 23 | ok | ok | not run | ok |  |
| `/partners/vault` | office | 23 | ok | ok | not run | ok |  |
| `/permits` | office | 8 | ok | ok | not run | ok |  |
| `/permits/[id]` | office | 32 | ok | ok | not run | ok | Title is the raw type code ("BUILDING"); 13 tabs wrap to 3 rows on a phone (U-04). |
| `/permits/library` | office | 6 | ok | ok | not run | ok |  |
| `/permits/products` | office | 1 | ok | ok | not run | ok |  |
| `/permits/products/[id]` | office | 3 | ok | ok | not run | ok |  |
| `/personnel` | office | 2 | ok | api 403 | not run | ok | Refused for SALES_REP → loading placeholders forever, "Add person" still shown (D-04). |
| `/personnel/[id]` | office | 5 | ok | api 403 | not run | ok | Missing person → loading placeholders forever (D-03). |
| `/pipeline` | office (server) | 0 | → /leads | → /leads | not run | → /leads | Redirects to /leads?view=board (kept for old links). |
| `/plans/[planSetId]` | office | 6 | api 500 | error text, api 404 | not run | api 500 | Missing source PDF → sheet render 500 instead of 410 (D-02). |
| `/production` | office (server) | 0 | → /jobs | → /jobs | not run | → /jobs | Redirects to /jobs?view=board (kept for old links). |
| `/referrals` | office | 3 | ok | api 403 | not run | api 403 | Refused for SALES_REP → loading placeholders forever (D-04). |
| `/reports` | office | 1 | ok | api 403 | not run | ok |  |
| `/reports/labor` | office | 3 | ok | api 403 | not run | api 403 | Clear refusal message for SALES_REP (good pattern). |
| `/reports/labor/payroll` | office | 2 | ok | api 403 | not run | api 403 |  |
| `/response-dashboard` | office | 1 | ok | api 403 | not run | api 403 | Refused for SALES_REP but shows zeros (D-05). |
| `/schedule` | office (server) | 0 | → /calendar | → /calendar | not run | → /calendar | Redirects to /calendar (kept for old links). |
| `/settings/lists` | office | 1 | ok | ok | not run | ok |  |
| `/settings/notifications` | office | 1 | ok | ok | not run | ok |  |
| `/sign/[token]` | public | 0 | ok | ok | ok | not run |  |
| `/takeoff/[takeoffId]` | office | 15 | api 500 | error text, api 404 | not run | api 500 | Same sheet render 500 (D-02). |
| `/tasks` | office | 13 | ok | ok | → /field | ok |  |
| `/vendors` | office | 7 | ok | api 403 | not run | ok | Refused for SALES_REP but shows an empty directory (D-05). Directory empty on prod. |
| `/vendors/[id]` | office | 7 | ok | api 403 | not run | ok |  |
| `/violations` | office | 6 | ok | ok | not run | ok |  |
| `/violations/[id]` | office | 30 | ok | error text, api 403 | not run | ok | Clear refusal / not-found message (good pattern). |
| `/violations/hearings` | office | 1 | ok | ok | not run | ok |  |
| `/violations/inspections` | office | 1 | ok | ok | not run | ok |  |
| `/violations/list` | office | 10 | ok | ok | not run | ok |  |
| `/violations/new` | office | 3 | ok | ok | not run | ok |  |
| `/violations/templates` | office | 1 | ok | api 403 | not run | api 403 |  |
