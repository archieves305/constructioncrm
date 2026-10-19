# Construction CRM — Prioritized MVP Roadmap (2026-10-19)

Built from the evidence in the other six documents of this audit. Each MVP is
one stage-sized piece of work that ships, is QA'd on dev and is checked on prod
before the next, the way the CRM has been built so far.

## 1. Scoring model

Seven factors, each scored 1–10:

| Factor | Weight | Direction |
|---|---|---|
| Business impact (I) | 25% | higher is better |
| User pain (P) | 15% | higher is better |
| Frequency of use (F) | 15% | higher is better |
| Revenue / cost saving (R) | 15% | higher is better |
| Technical risk (T) | 10% | **inverted**: 10 − T counts |
| Effort (E) | 10% | **inverted**: 10 − E counts |
| Dependency readiness (D) | 10% | higher is better |

**Score** = 0.25·I + 0.15·P + 0.15·F + 0.15·R + 0.10·(10−T) + 0.10·(10−E) + 0.10·D, out of 10.

**Security and money-integrity items (MVP 0) are ranked ahead of everything,
whatever their score.** They are defects in a live system.

**Assumptions.** These are not measured facts.
- Seven office users, plus field crews.
- Prod volume (2026-10-19):
  - 48 leads, 20 of them in the last 30 days.
  - 27 jobs, 19 of them open.
  - 4 permits and 4 violation cases.
  - 61 expenses and 11 crew payments in 30 days.
  - 69 active tasks overdue.
- Average residential job about $15–40k. That is inferred from the roof estimates and the job list, not computed.
- Dollar benefits are orders of magnitude to rank work, not forecasts.
- Effort is in focused build sessions (one session ≈ one stage as built so far, including dev QA).

## 2. Ranked list

| Rank | MVP | I | P | F | R | T | E | D | Score | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.1 | Close the permit-assistant SSRF gap | 9 | 3 | 3 | 1 | 2 | 1 | 10 | **forced** | ½ session |
| 0.2 | Close record-level read gaps + route guard tests | 8 | 3 | 5 | 1 | 3 | 4 | 10 | **forced** | 1 |
| 0.3 | Money changes locked and audited | 8 | 4 | 5 | 4 | 3 | 4 | 10 | **forced** | 1–2 |
| 0.4 | Operator switches (SPF, role defaults, vendor directory) | 8 | 6 | 8 | 5 | 1 | 1 | 9 | **forced** | owner hours |
| 1 | Estimate drives the job (price, cost baseline, budget) | 9 | 8 | 7 | 8 | 4 | 5 | 8 | **7.60** | 2 |
| 2 | Owner command center (finish the attention dashboard) | 9 | 8 | 9 | 6 | 2 | 3 | 9 | **8.10** | 1–2 |
| 3 | Overdue work control (by person, unowned steps, clean-up) | 8 | 9 | 9 | 5 | 2 | 3 | 9 | **7.85** | 1 |
| 4 | Lead follow-up worklist + intake parity | 7 | 7 | 9 | 7 | 2 | 3 | 9 | **7.60** | 1 |
| 5 | One estimate system, roofing estimate from measurements | 8 | 8 | 7 | 8 | 5 | 6 | 7 | **7.05** | 2–3 |
| 6 | Proposal send, view and accept online | 7 | 6 | 7 | 8 | 3 | 4 | 8 | **7.00** | 1–2 |
| 7 | Navigation and complexity cut | 6 | 7 | 9 | 3 | 2 | 3 | 10 | **6.85** | 1 |
| 8 | Budget overrun + profit alerts | 7 | 5 | 6 | 7 | 2 | 2 | 8 | **6.85** | 1 |
| 9 | Crew / sub scheduling (durations, lanes, conflicts) | 6 | 6 | 6 | 5 | 4 | 5 | 7 | **5.85** | 2 |
| 10 | Takeoff → estimate (M5) then plumbing AI (M4) | 7 | 5 | 3 | 7 | 6 | 7 | 7 | **5.40** | 3–4 |
| 11 | Punch list, closeout, warranty | 5 | 5 | 4 | 4 | 2 | 4 | 8 | **5.40** | 1–2 |
| 12 | Customer portal + online payment (Stripe) | 6 | 4 | 5 | 7 | 6 | 7 | 5 | **5.10** | 3 |
| 13 | Sub bid packages + comparison | 5 | 3 | 2 | 6 | 4 | 6 | 6 | **4.50** | 2–3 |
| 14 | QuickBooks sync beyond expenses | 4 | 4 | 4 | 4 | 5 | 5 | 5 | **4.30** | 2 |

**Why this order.**
- The command center (2) scores above "estimate drives the job" (1).
- It is listed second because it reads the numbers MVP 1 makes correct. Projected profit is only as good as the cost baseline.
- If the two are built in the other order, the dashboard will show confidently wrong margins.

---

## MVP 0 — Critical repairs and stabilisation

### 0.1 Close the permit-assistant SSRF gap
1. **Business problem:** the permit document assistant (on prod) fetches links found in uploaded documents. Its private-address guard can be bypassed.
2. **Current behaviour:** `lib/permit-intel/web-fetch.ts:49-66` `isBlockedAddress` matches only dotted `::ffff:a.b.c.d`. `[::ffff:a9fe:a9fe]` (= 169.254.169.254, the droplet metadata service), `[::ffff:7f00:1]` (localhost), `[::7f00:1]` and `[2002:…]` pass both `urlProblem` and the connect-time check. IP literals skip DNS. Verified 2026-10-19 by running the module's functions.
3. **Proposed:** refuse every IP-literal host in links that came from documents or pages. Canonicalise IPv6 (`net.BlockList` with the IPv4-mapped / compatible / 6to4 / NAT64 ranges) for the connect-time check.
4. **Reuse:** `safeLookup`, `urlProblem`, `mayFollow` (`links.ts`).
5. **Frontend:** none.
6. **Backend:** `web-fetch.ts`, `links.ts`.
7. **Database:** none.
8. **Integrations:** none.
9. **Dependencies:** none.
10. **Effort:** ½ session.
11. **Complexity:** low.
12. **Operational benefit:** removes a live server-side request forgery path.
13. **Financial:** risk avoidance.
14. **Risks:** blocking a legitimate department site that is served by bare IP (rare).
15. **Acceptance:** every form above refused, with a test per form; real Town of Palm Beach run unchanged.
16. **Testing:** unit tests on `isBlockedAddress` / `urlProblem`; one dev assistant run.
17. **Success metric:** 0 private-range fetches in `permit_assist_fetches`.
18. **Interim (optional, today):** hide the assistant until fixed. 2 runs on prod so far.

### 0.2 Close record-level read gaps + route guard tests
1. **Business problem:** some routes load a record by id with no role or scope check.
2. **Current:**
   - `api/invoices/[id]/pdf`, `api/payments/[id]/receipt`: any signed-in user can fetch any invoice or receipt.
   - `api/leads/contact-lookup`: every lead's name, phone and email, to any role.
   - `api/jobs/[id]/field-assignments` GET: field users' emails for any job.
   - `door-knock-routes/*`, `canvassing/properties/*/refresh` (paid Zylow calls).
   - `api/reviews` GET, `api/intake` GET, `api/reports/response-times`, `api/reports?type=conversions`, `api/admin/follow-up-rules` GET.
   - Job money reads (`/overview`, `/cost-summary`, `/budget`, `/labor-contracts`) reach CREW_LEAD and MARKETING on their jobs.
3. **Proposed:**
   - Apply the existing guards (`guardJob`, `guardLead`, `guardProspect`, explicit role lists).
   - Add `canSeeJobMoney` (needs Richard's ruling, see §7) and strip money fields for roles outside it.
   - Make pages reached by URL that receive a 403 show an empty state, not a TypeError: `/referrals`, `/personnel`, `/field-logs` as SALES_REP (seen on dev).
4. **Reuse:** `lib/access/records.ts`, `lib/money/access.ts`, `lib/labor/permissions.ts` `canSeeLaborCosts`.
5. **Frontend:** empty states on 3 pages; the Overview hides money for non-money roles.
6. **Backend:** about 15 route handlers.
7. **Database:** none.
8. **Integrations:** none.
9. **Dependencies:** the ruling on who sees job money.
10. **Effort:** 1 session.
11. **Complexity:** low.
12. **Benefit:** customer contact and margins confined to the right people.
13. **Financial:** n/a.
14. **Risks:** a role losing a view it uses. Mitigate with a role matrix QA.
15. **Acceptance:** a route-guard test suite (new) calls each handler as each role and asserts 200 / 403 / 404.
16. **Testing:** first route-level tests in the repo (Vitest, calling handlers with a mocked session).
17. **Metric:** 0 session-only handlers in a guard scan.
18. **Note:** the suite is the lasting value. Today all 223 test files stop at `src/lib`.

### 0.3 Money changes locked and audited
1. **Business problem:** approved money can change silently.
2. **Current:**
   - Expense PATCH edits APPROVED rows for anyone holding the cost grant, with no audit (`api/expenses/[id]/route.ts`).
   - Lump-sum invoices are editable after SENT / PAID with no audit.
   - Change-order approval checks status outside the transaction, so two approvals can both apply (`services/change-orders.ts:236, 529`).
   - Budget import deletes every line and allocation with no audit.
   - Labor contract edits are unaudited.
   - Accepted estimates stay editable.
3. **Proposed:**
   - Editing an APPROVED expense needs a money role and writes an AuditEvent.
   - Invoices after SENT: amount locked unless voided and reissued; status changes audited.
   - CO decision as a conditional update (`where status = SENT`).
   - Budget import keeps allocations by line key and is audited.
   - Labor contract PATCH / DELETE audited.
   - An ACCEPTED estimate becomes read-only ("Revise" makes a copy).
4. **Reuse:** `recordAudit`, `lib/money/access.ts`.
5. **Frontend:** read-only states, a "Revise" button.
6. **Backend:** 6 routes / services.
7. **Database:** `Estimate.revisionOf` (nullable).
8. **Integrations:** none.
9. **Dependencies:** none.
10. **Effort:** 1–2 sessions.
11. **Complexity:** medium.
12. **Benefit:** books that can be trusted; disputes answerable.
13. **Financial:** avoids silent contract or invoice drift. Size unknown; P has 459 expenses and 29 invoices.
14. **Risks:** blocking a legitimate correction. Keep a void-and-reissue path.
15. **Acceptance:** each change listed above produces an AuditEvent; a double CO approval yields one invoice.
16. **Testing:** unit + concurrency test on the CO decision.
17. **Metric:** 100% of money mutations audited.
18. —

### 0.4 Operator switches (owner work, no code)

Delete the duplicate SPF TXT record (pending your GoDaddy sign-in). That
unblocks nurture, task escalations and violation escalations. Then:
- set Admin → Workflow Roles (P: 0 defaults, 15 unowned open steps);
- build the vendor directory from Vendors → Unmatched (P: 0 vendors);
- fill each jurisdiction's website.

**Acceptance:** one SPF record in DNS; nurture first day at 10 sends; 0
unowned active steps; Home Depot and the crews as vendors.

---

## MVP 1 — Estimate drives the job (rank 1)

1. **Business problem:** the price and cost of a job are retyped and drift.
2. **Current:**
   - Won creates the job at the hand-typed `estimatedJobValue` (or $0 with no deposit step) (`services/jobs.ts:62-80`).
   - The cost baseline reads the estimate live and leaves out chosen optional items (`services/job-cost.ts:63-71`, `generic-calc.ts:60`).
   - No budget lines come from the estimate.
   - Awarded GC bids have no cost baseline.
   - P: 0 customer contracts, so every job price on prod was typed by hand.
3. **Proposed:**
   - At Won (and at bid award), if an estimate is marked accepted:
     - the job price comes from its total;
     - a cost snapshot is stored on the job, including chosen options;
     - budget lines are created from its sections, at cost.
   - Change orders carry an optional cost that adds to the baseline.
   - Contract signing keeps working and overrides with the signed snapshot.
4. **Reuse:** `createJobFromLead` options, `customer-contracts/snapshot.ts` (already computes with options), `computeCostSummary`, `BudgetLine`.
5. **Frontend:** "Accepted estimate" pick in the Won dialog; budget panel "from estimate" badge; CO cost field.
6. **Backend:** `services/jobs.ts`, `job-cost.ts`, `partners/bids.ts` award, CO service.
7. **Database:** `Job.estimatedCostSnapshot` + `sourceEstimateId`; `ChangeOrder.estimatedCost`; `BudgetLine.source`.
8. **Integrations:** none.
9. **Dependencies:** 0.3 (accepted estimates locked).
10. **Effort:** 2 sessions.
11. **Complexity:** medium.
12. **Benefit:** no retyping of price; projected profit becomes true.
13. **Financial:** projected-margin errors surface before the job starts. Assumption: catching one mispriced $30k job a quarter pays for it.
14. **Risks:** jobs with no estimate keep today's behaviour; backfill not attempted.
15. **Acceptance:** a lead with an accepted estimate → Won → job price = estimate total, budget lines = sections, cost summary uses the snapshot; editing the estimate afterwards changes nothing on the job.
16. **Testing:** unit tests on the snapshot; dev click-through; one prod job checked by Richard.
17. **Metric:** share of new jobs created from an accepted estimate (target > 80% in 60 days).
18. —

## MVP 2 — Owner command center (rank 2)

1. **Business problem:** the owner cannot answer the daily questions in one place. 4 of 13 are answered on the dashboard today (UX audit §4).
2. **Current:** Needs Attention has 20 rows. Missing:
   - pipeline value
   - outstanding estimates (no list across leads)
   - jobs over budget
   - delayed jobs (health is computed per job only)
   - overdue by person
   - expected gross profit
   - new and uncontacted leads today
3. **Proposed:** add these as attention rows and owner tiles, each opening its list (same `where` for count and list). Plus a "Today" strip: new leads, uncontacted, estimates out, jobs at risk.
4. **Reuse:** `lib/attention/{rows,load}.ts`, `deriveJobHealth`, `getJobCostRows`, `computeFunnel`.
5. **Frontend:** dashboard owner strip; 6 new attention list pages (same component).
6. **Backend:** 6 row loaders; `/api/attention`.
7. **Database:** none (an index on `leads.next_follow_up_at` if slow).
8. **Integrations:** none.
9. **Dependencies:** MVP 1 for trustworthy profit numbers. The rows can ship first, with the profit rows labelled.
10. **Effort:** 1–2 sessions.
11. **Complexity:** low.
12. **Benefit:** the 60-second morning check becomes real.
13. **Financial:** indirect (faster intervention on late jobs and stale leads).
14. **Risks:** row overload. Show only rows with a count.
15. **Acceptance:** each of the 13 owner questions answered by one tile or row; count = list.
16. **Testing:** loader unit tests; dev sweep at 1440 / 400.
17. **Metric:** owner's time to answer the 13 questions < 60 s.
18. —

## MVP 3 — Overdue work control (rank 3)

1. **Problem:**
   - P: 69 active tasks overdue (32 on one person, 10 unassigned).
   - 15 open steps unowned; 0 workflow role defaults set.
   - The system raises more than the team closes.
2. **Current:** one "overdue tasks" total; no per-person view; no clean-up tool.
3. **Proposed:**
   - "Overdue by person" row and list.
   - An unowned-step fallback (role default → job PM → oldest admin, as the alerts already do).
   - A bulk "reschedule / close stale" action for managers.
   - A weekly overdue digest section per person.
4. **Reuse:** attention rows, `alerts` owner fallback pattern, `updateTask` (bulk), digest builder.
5. **Frontend:** list grouped by person; bulk bar on `/tasks`.
6. **Backend:** a bulk endpoint through `updateTask`; fallback in `workflows/roles.ts`.
7. **Database:** none.
8. **Integrations:** none.
9. **Dependencies:** 0.4 role defaults.
10. **Effort:** 1 session.
11. **Complexity:** low.
12. **Benefit:** a task list people trust again.
13. **Financial:** staff time.
14. **Risks:** mass closing hides real work. Every bulk close is audited and names a reason.
15. **Acceptance:** 0 unowned active steps; the overdue list per person matches `/tasks`.
16. **Testing:** unit; dev.
17. **Metric:** active overdue tasks below 20 within 30 days.
18. —

## MVP 4 — Lead follow-up worklist + intake parity (rank 4)

1. **Problem:** P: 20 open leads past their follow-up date, 19 never contacted. Duplicates are missed across phone formats. Some intake paths skip the lead event.
2. **Current:**
   - `/leads` has no due filter or sort.
   - Phone is not normalised.
   - The Outlook / Google Ads intake skips `emitLeadEvent`.
   - Prospect promote has no duplicate check and drops the knock score.
   - A SALES_REP can reassign a lead via PATCH with no history.
3. **Proposed:**
   - "Follow-up due" filter and sort plus a "Call list" view on `/leads`.
   - E.164 phone normalisation on every write path, with a one-time backfill (dry run first).
   - One `createLead` service used by manual, phone, email, prospect and bid entry (event, duplicate check, metrics).
   - Assignment only through the assign route.
4. **Reuse:** `api/leads/route.ts` create logic, `guardLeadCreate`, `emitLeadEvent`.
5. **Frontend:** filter / sort, call list.
6. **Backend:** `lib/leads/create.ts`, normaliser, the PATCH schema without `assignedUserId`.
7. **Database:** `leads.phone_normalized` + index.
8. **Integrations:** none.
9. **Dependencies:** none.
10. **Effort:** 1 session.
11. **Complexity:** low–medium.
12. **Benefit:** fewer lost leads.
13. **Financial (assumption):** one recovered $20k job a quarter at about a 30% gross margin ≈ $6k gross profit a quarter.
14. **Risks:** backfill merges nothing on its own; it only flags duplicates.
15. **Acceptance:** the same customer entered as "(305) 555-1212" and "+13055551212" is flagged; every intake path writes stage history and fires the event.
16. **Testing:** unit; dev.
17. **Metric:** leads uncontacted after 24 h → 0; overdue follow-ups < 5.
18. —

## MVP 5 — One estimate system; the roofing estimate from measurements (rank 5)

1. **Problem:** two estimate systems. Roofing squares are retyped and material is a lump guess. The price book and rules engine produce no proposals. The other templates carry no prices or cost split.
2. **Current:**
   - `RoofEstimate`: no status, lump material.
   - Sectioned `Estimate`: 4 unpriced templates.
   - The engine runs only in Admin → Try a takeoff.
3. **Proposed:**
   - The sectioned estimate gains a line cost type (labor / material / sub / equipment / other) and an overhead %.
   - "Add roofing section from measurement" runs the engine with the price book and writes lines.
   - New roofing work uses the sectioned estimate; `RoofEstimate` becomes read-only history.
   - The roofing import is applied (after the Pierce Drive duplicate is checked).
4. **Reuse:** `lib/roofing/engine`, `loadEngineInputs`, `priceInForce`, `generic-calc.ts`, both PDFs (keep the sectioned one).
5. **Frontend:** estimate dialog cost type column, "from measurement" action, label "Unit cost".
6. **Backend:** section generator; `generic-calc` cost-type subtotals.
7. **Database:** `EstimateLineItem.costType`, `Estimate.overheadPercent`.
8. **Integrations:** none.
9. **Dependencies:** MVP 1; the roofing P1 rulings still open (labor basis, price source, budget seeding).
10. **Effort:** 2–3 sessions.
11. **Complexity:** medium.
12. **Benefit:** a roofing estimate in minutes from a Roofr report.
13. **Financial (assumption):** 12 roof estimates on prod at about 30–45 min each of retyping.
14. **Risks:** price book empty until the import is applied.
15. **Acceptance:** a Roofr report → estimate with priced lines → accepted → job (MVP 1) with matching budget.
16. **Testing:** engine tests exist; generator tests; dev with the 23 real Roofr PDFs.
17. **Metric:** time from measurement to sent estimate.
18. —

## MVP 6 — Proposal send, view and accept online (rank 6)

1. **Problem:** P: 7 leads at Estimate Sent. Estimates are PDFs mailed by hand; KNU cannot see whether one was opened, and no estimate has ever been accepted online. The contract flow is built but unused (0 contracts).
2. **Current:** "Mark sent" manual; the contract needs an existing job.
3. **Proposed:** send the estimate from the CRM with a tokenised view page:
   - option checkboxes;
   - accept with e-signature on the estimate itself (the contract becomes optional);
   - view / accept events;
   - an unsold-estimate follow-up task at 3 and 7 days (nurture covers the long tail once SPF is fixed).

   Accepting moves the lead to Won through MVP 1.
4. **Reuse:** `/sign/[token]` signing service, `tracked-links`, auto-tasks `estimate.sent`, MailerSend.
5. **Frontend:** public estimate page; Send dialog; status timeline.
6. **Backend:** estimate token, accept service.
7. **Database:** `Estimate.publicToken`, `viewedAt`, `acceptedAt`, `acceptedBy*`.
8. **Integrations:** MailerSend (after SPF).
9. **Dependencies:** MVP 1, 0.4 (SPF), Richard's ruling on whether acceptance replaces the separate contract.
10. **Effort:** 1–2 sessions.
11. **Complexity:** medium.
12. **Benefit:** faster yes; visibility.
13. **Financial (assumption):** industry tools report faster acceptance with view tracking; not quantified here.
14. **Risks:** legal wording of acceptance. Reuse the contract template text.
15. **Acceptance:** a customer opens, picks options, signs; the lead → Won → job priced from the estimate.
16. **Testing:** dev end to end with a test inbox.
17. **Metric:** days from sent to accepted; % estimates viewed.
18. —

## MVP 7 — Navigation and complexity cut (rank 7)

1. **Problem:** 45 sidebar entries, idle modules in full view, three places to edit a permit.
2. **Proposed:**
   - Sidebar to about 15 entries: admin as one entry with its own index.
   - Hide or fold the idle parts (permit lessons and the flat-form path behind an admin "advanced" flag; violation hearings / inspections as list filters; Response Times and Referrals off until used).
   - Make the permit record the one edit surface; the job tab and drawer become summaries.
   - Delete orphaned code (inventory §"Orphaned").
3. **Reuse:** existing role lists.
4. **Database:** none.
5. **Effort:** 1 session.
6. **Risk:** someone loses a page they use. Keep the redirects.
7. **Acceptance:** each role's sidebar ≤ 15 items; no 404 on old URLs.
8. **Metric:** clicks to the five most common tasks (UX audit §3).

## MVP 8 — Budget overrun + profit alerts (rank 8)

1. **Proposed:**
   - An attention row "jobs over budget / margin below X%".
   - A digest line to the PM and owner when committed cost crosses the baseline.
   - A filter on Collections.
2. **Reuse:** `getJobCostRows`, digest builder.
3. **Dependencies:** MVP 1.
4. **Effort:** 1 session.
5. **Acceptance:** a job pushed over budget on dev raises one row and one digest line.

## MVP 9 — Crew / sub scheduling (rank 9)

1. **Proposed:**
   - Crew assignments with start + end.
   - Crew lanes in Calendar → People.
   - All-day overlap warnings per crew.
   - The get-ready task follows a superintendent change.
2. **Reuse:** `lib/calendar/{people,conflicts}.ts`, `install-run.ts`.
3. **Database:** `CrewAssignment.endDate`.
4. **Effort:** 2 sessions.

## MVP 10 — Takeoff → estimate (M5), then plumbing AI (M4) and RFQ (M6)

1. **Proposed:**
   - Reviewed takeoff measurements → estimate section through trade rules, with the double-count guard across sheets.
   - Then the plumbing analyser.
   - Then the supplier RFQ (needs vendors).
2. **Dependencies:** MVP 1 and 5; the vendor directory.
3. **Effort:** 3–4 sessions.
4. **Note:** only worth it while commercial bid volume grows (P: 1 bid).

## MVP 11 — Punch list, closeout, warranty

1. **Proposed:**
   - Punch items (FieldIssue type PUNCH with photo and owner).
   - A closeout checklist that checks for the documents.
   - A warranty record per job (start, term, manufacturer).
   - A warranty-expiring overlay.
2. **Effort:** 1–2 sessions.

## MVP 12 — Customer portal + online payment

1. **Proposed:** a tokenised job page for the customer (schedule, documents, invoices) with Stripe payment links on invoices and deposits.
2. **Integrations:** Stripe.
3. **Note:** integrate, never build processing. P: 6 jobs sit at Deposit Needed.
4. **Effort:** 3 sessions.

## MVP 13 — Sub bid packages + comparison

When KNU prices commercial scopes it subs out:
- scope package to vendors;
- responses captured;
- side-by-side comparison;
- award → commitment.

Effort 2–3 sessions. Build only on demand.

## MVP 14 — QuickBooks beyond expenses

Export (or API-sync) invoices, payments and labor payments; fill the
Account column from a cost-code map. Effort 2 sessions. Coordinate with
cc-allocator, which owns money that moved.

---

## 3. AI and automation opportunities

| Opportunity | Data available? | Approach | Value | Note |
|---|---|---|---|---|
| Stale-lead / follow-up nudges | Yes | Rules (exists, needs MVP 4) | High | Not AI |
| Lead scoring | Thin (48 leads) | Rules on source, service, response time | Medium | AI premature |
| Missed-communication detection | Partial (communications sparse: P 4 rows) | Rules once SMS / email are logged | Medium | Needs logging first |
| Roofing estimate from measurement | Yes | Deterministic engine (MVP 5) | High | Already built, unconnected |
| AI plan takeoff | Built for roofing (M3) | AI picks ids, code measures | Medium | Commercial volume low |
| Historical cost analysis | Thin | After MVP 1 + 5 build history | Later | — |
| Change-order detection from daily logs | Logs not used (1 in 30 days) | — | Low now | Field adoption first |
| Permit correction reading | Yes | AI (built, best AI ROI) | High per permit | Low volume |
| Project delay prediction | Health rules exist | Rules (health) → list (MVP 2) | Medium | Rules, not ML |
| Profitability alerts | After MVP 1 | Rules (MVP 8) | High | — |
| Daily project summary | Workflow + tasks yes | Template, no AI needed | Medium | Digest exists |

**Principle:** rules first. AI only where reading documents or drawings is the
work. Every AI output stays a proposal a person confirms, with the cap and
ledger in `src/lib/ai`.

## 4. Dependency-aware sequence for future sessions

```
0.1 SSRF ─┐
0.2 guards + route tests ─┤ (one week)
0.3 money locks + audit ──┘
0.4 SPF / role defaults / vendors (owner, in parallel)
        │
        ▼
MVP 1 estimate drives the job ──► MVP 2 command center ──► MVP 8 overrun alerts
        │                         MVP 3 overdue control (parallel with 2)
        │                         MVP 4 lead worklist (parallel)
        ▼
MVP 5 one estimate + roofing from measurement ──► MVP 6 proposal online
        │
        ▼
MVP 7 nav cut (any time after 0.x)   MVP 9 crew scheduling   MVP 11 punch / warranty
        │
        ▼
MVP 10 takeoff → estimate (M5 / M4 / M6)   MVP 12 portal + Stripe   MVP 13 sub bids   MVP 14 QBO
```

## 5. Keep unchanged (works well)

- The workflow engine.
- The single cost calculation.
- G702 / G703 billing.
- The crew-payment twin guard.
- Vendor matching and compliance.
- Notification digests.
- The AI layer.
- Permit corrections.
- Violations closure rules.
- GC bids and award.
- Deploy discipline.

## 6. Consolidate or remove

- `RoofEstimate` for new work (→ sectioned estimate).
- The FollowUpRule engine and admin: retired for permits; nurture + auto-tasks cover leads.
- The response-time dashboard.
- The referral and review POST routes.
- `getFinancialSummary`'s unused profit block.
- The Twilio placeholder.
- Permit lessons, flat forms and violation hearing / inspection pages: hide, don't delete.

## 7. Rulings needed before building

1. **Who sees a job's money** (contract, cost, profit, crew pay)? Proposed: ADMIN, MANAGER, OFFICE_STAFF, READ_ONLY, plus the job's PM; not CREW_LEAD or MARKETING; SALES_REP sees price, not cost.
2. **Is a separate customer contract still wanted** once an estimate can be accepted online (MVP 6)? P: 0 contracts have ever been used.
3. **Roofing P1 open items:** labor basis, price source, when a budget is seeded, ABC Supply account.
4. **Is the field expected to use daily logs?** If yes, adoption work. If no, stop building field features.
