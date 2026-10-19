# Construction CRM — Executive Summary (2026-10-19)

## Bottom line

The CRM is broad and mostly well built. 37 pages were checked at desktop and
phone width as five roles with no page errors (two pages fail only when
reached by typed URL without access). 1,897 automated tests pass. Most
modules have explicit access rules, and the money controls are better than
most commercial tools.

**Its weakness is not missing modules. It is that the pieces do not hand
data to each other, and that much of what is built is idle.**
- Estimates do not set the job's price or cost; every prod job price was
  typed by hand, and 0 customer contracts have ever been used.
- Roof measurements do not reach estimates.
- 69 tasks are overdue and nobody owns 15 open workflow steps.
- Email automations wait on one DNS record.

Before any of that, there are **three security and money-integrity repairs**,
one of them a live server-side request forgery gap.

**Overall maturity: 6.7 / 10** (mean of the module scores). Strong engines, weak joins, low adoption
outside the office core.

## Module scorecard

**Dimensions (each 1–10):**

| Code | Dimension |
|---|---|
| Comp | Functional completeness |
| Rel | Reliability |
| UX | User experience |
| Integ | Workflow integration |
| Auto | Automation maturity |
| Data | Data integrity |
| Rep | Reporting |
| Mob | Mobile |
| Scal | Scalability |
| Use | Business usefulness |

**Rules:**
- "—" means not tested (Scal was not load-tested anywhere; it is scored only where the code shows a clear limit).
- Maturity = the mean of the scored dimensions.

| Module | Comp | Rel | UX | Integ | Auto | Data | Rep | Mob | Scal | Use | Maturity | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Leads + pipeline | 7 | 8 | 6 | 5 | 4 | 5 | 5 | 8 | — | 8 | 6.2 | High (MVP 4) |
| Nurture / follow-ups | 8 | 7 | 7 | 6 | 3 (off) | 7 | 5 | — | — | 3 (off) | 5.8 | Ops (SPF) |
| GC partnerships + bids | 9 | 8 | 7 | 6 | 7 | 8 | 8 | 8 | — | 4 (idle) | 7.2 | Low |
| Estimating (both systems) | 5 | 7 | 5 | 3 | 3 | 4 | 3 | 7 | — | 6 | 4.8 | **Top (MVP 1, 5)** |
| Contracts / e-sign | 8 | 8 | 7 | 6 | 7 | 9 | 5 | 8 | — | 2 (unused) | 6.7 | Ruling |
| Roofing library | 7 | 8 | 6 | 2 | 6 | 8 | 3 | — | — | 3 | 5.4 | High (MVP 5) |
| Plan takeoff M1–M3 | 6 | 8 | 7 | 3 | 7 | 8 | 4 | 6 | — | 3 | 5.8 | Later (MVP 10) |
| Jobs + Overview | 8 | 8 | 7 | 6 | 7 | 6 | 6 | 8 | — | 9 | 7.2 | MVP 2 |
| Workflows | 9 | 9 | 7 | 8 | 8 | 9 | 7 | 8 | 7 | 7 | 7.9 | Keep |
| Tasks + calendar | 8 | 9 | 8 | 8 | 7 | 8 | 5 | 8 | 7 | 7 | 7.5 | MVP 3 |
| Field + daily logs | 8 | 8 | 8 | 7 | 6 | 8 | 6 | 9 | — | 2 (1 log / 30 d) | 6.9 | Ruling |
| Job cost + budgets | 7 | 8 | 6 | 5 | 6 | 6 | 6 | 7 | 6 | 8 | 6.5 | MVP 1, 8 |
| Billing (lump + G702) | 8 | 8 | 7 | 7 | 6 | 6 | 6 | 7 | 6 | 9 | 7.0 | MVP 0.3 |
| Expenses + cc-allocator | 8 | 8 | 7 | 8 | 8 | 6 | 6 | 7 | — | 9 | 7.4 | MVP 0.3 |
| Labor contracts + payments | 8 | 8 | 6 | 7 | 6 | 7 | 6 | 7 | — | 8 | 7.0 | MVP 0.3 |
| Vendors + compliance | 8 | 8 | 7 | 7 | 7 | 8 | 5 | 7 | — | 2 (empty) | 6.6 | Ops |
| Permits (core) | 8 | 7 | 6 | 8 | 7 | 7 | 6 | 7 | — | 7 | 7.0 | MVP 7 |
| Permit Intelligence | 9 | 6 (SSRF) | 6 | 7 | 8 | 8 | 7 | 7 | — | 4 (4 permits) | 6.9 | **MVP 0.1** |
| Code violations | 9 | 8 | 7 | 7 | 7 | 9 | 3 | 7 | — | 3 (4 cases) | 6.7 | Keep, hide depth |
| Notifications + digests | 8 | 8 | 7 | 8 | 8 | 8 | 6 | — | 7 | 7 | 7.4 | Keep |
| Dashboard + reports | 6 | 8 | 7 | 6 | 6 | 6 | 5 | 8 | — | 7 | 6.6 | **MVP 2** |
| Documents / files | 8 | 7 | 8 | 7 | 6 | 7 | 4 | 8 | 5 (local disk) | 8 | 6.8 | Backups |
| Access control | 7 | 7 | — | — | — | 5 | — | — | — | 9 | 7.0 | **MVP 0.2** |

## Top 10 strengths

1. **The workflow engine.** Composed templates, gates, catch-up, and a
   migration that deletes nothing. 32 test files. It actually runs jobs: 57
   steps were completed in 30 days.
2. **One job cost calculation** (`computeCostSummary`). Approved-only, with
   commitments and the crew-payment double-count guard.
3. **AIA G702 / G703 progress billing with retainage release.** The commercial
   sub's core money tool, rare in homeowner CRMs.
4. **GC bid handling from the subcontractor's side:** intake, go / no-go,
   submissions, award → progress-billed job. No competitor in the benchmark
   does this.
5. **Florida permit intelligence:** correction letters read for you, forms
   filled, NOA / HVHZ checks, frozen packages.
6. **cc-allocator integration:** idempotent intake, twin holds,
   reconciliation page.
7. **Notification digests:** live on prod (76 sent), with an instant off
   switch.
8. **Task model:** one date axis, calendar with People / dispatch view,
   overlays.
9. **AI done safely:** no tools, schema-checked, caps, a ledger, a person
   confirms everything ($0.56 spent in total).
10. **Deploy discipline:** backups, rollback, smoke test, journal scan. Stable
    pages at every width.

## Top 10 weaknesses

1. **SSRF gap in the permit assistant's link fetcher** (live; IPv6-mapped
   addresses bypass the guard). Verified.
2. **Record-level read gaps:**
   - any invoice PDF or receipt by id
   - every lead's contact details via the lookup
   - field users' emails by job
   - margins visible to crew leads and marketing
3. **Money changes without lock or audit:**
   - approved expenses editable by grant holders
   - invoices editable after sent / paid
   - a change-order double-approval race
   - budget import wipes allocations
4. **The estimate does not drive the job:** the price is retyped at Won (or
   $0); the cost baseline is read live from an editable estimate and misses
   chosen options; no budget from the estimate.
5. **Two estimate systems:**
   - the roofing one has no status and a lump material cost;
   - the other has no prices, no cost split and no plumbing template;
   - the roofing engine and price book produce no proposals.
6. **Overdue debt:** 69 active tasks overdue, 15 unowned steps, 0 workflow
   role defaults; one person carries 32.
7. **Owner visibility gaps:** no pipeline value, no list of outstanding
   estimates, no jobs-over-budget or delayed-jobs row, no overdue-by-person.
8. **Idle modules:**
   - 0 customer contracts
   - 0 vendors
   - 1 daily log in 30 days
   - 2 GC accounts
   - 4 permits
   - 4 violation cases
   - nurture off
9. **Navigation sprawl:** 45 sidebar entries; three places to edit a permit;
   three different "late" rules.
10. **No route-level tests.** Access regressions can't be caught. Files live
    on one droplet with no off-box copy.

## Top 10 recommended improvements (in order)

1. Close the SSRF gap (MVP 0.1).
2. Close the read gaps, and add route guard tests (0.2).
3. Lock and audit money changes (0.3).
4. Owner switches: SPF, workflow role defaults, vendor directory (0.4).
5. The estimate drives the job's price, cost baseline and budget (MVP 1).
6. Owner command center: finish the attention dashboard (MVP 2).
7. Overdue work control: by person, unowned fallback, clean-up (MVP 3).
8. Lead call list + one lead-create path + phone normalisation (MVP 4).
9. One estimate system, roofing from measurements (MVP 5).
10. Proposal send, view and accept online (MVP 6).

## Five highest-value quick wins (≤ 1 day each)

1. **Delete the duplicate SPF record.** Nurture, escalations and violation
   escalations become available.
2. **Set Admin → Workflow Roles.** The 15 unowned steps get owners.
3. **Fix the SSRF check, or hide the assistant until it is fixed.**
4. **Guard `invoices/[id]/pdf`, `payments/[id]/receipt` and
   `leads/contact-lookup`** with the existing helpers.
5. **Add a "Follow-up due" sort on `/leads`, plus a pipeline-value tile**
   (sum of open leads' `estimatedJobValue`).

## Critical risks

- **Security:** the SSRF path to the droplet metadata service. Record reads
  by id across roles.
- **Money:** silent changes to approved expenses and sent invoices; the
  change-order double-approval race; projected profit read from an editable
  estimate.
- **Data loss:** uploads only on the droplet (190 files already lost once).
- **Adoption:** features built faster than they are used. Each new module adds
  surface without adding work done.

## Recommended sequence

| Window | Work |
|---|---|
| **Days 1–30** | MVP 0.1–0.3 (one week). 0.4 by the owner. MVP 1 (estimate drives the job). MVP 3 (overdue control). Quick wins 1–5 |
| **Days 31–60** | MVP 2 (command center), MVP 4 (lead call list + intake), MVP 7 (navigation cut), MVP 8 (overrun alerts) |
| **Days 61–90** | MVP 5 (one estimate system, roofing from measurements), MVP 6 (proposal online). Then decide on MVP 10 (takeoff → estimate) by commercial bid volume |

**Expected impact (assumptions, not measurements):**
- No retyping of price or measurements.
- Trustworthy projected margins.
- Overdue tasks down from 69 to below 20.
- Uncontacted leads cleared daily.
- The owner's morning check in one screen.

## If only five improvements in 90 days

1. **Security and money integrity (MVP 0.1–0.3).** Existing features made
   safe; small effort.
2. **The estimate drives the job (MVP 1).** Improves existing features. It
   connects three modules that already work and makes every profit figure
   honest.
3. **Owner command center (MVP 2).** Extends the existing attention
   dashboard. Answers the 13 daily questions; the data is already there.
4. **Overdue work control + lead call list (MVP 3 + 4).** Improves existing
   features. Turns task and follow-up debt into short daily lists; recovers
   leads.
5. **One estimate system, roofing from measurements (MVP 5).** New wiring of
   existing engines. The fastest path from a Roofr report to a priced
   proposal, and the base for proposal-online (MVP 6) and commercial takeoff
   (MVP 10).

**Leave unchanged:**
- workflow engine
- cost calculation
- G702 billing
- crew-payment guard
- vendor compliance
- digests
- AI layer
- permit corrections
- violations rules
- GC bids
- deploy script

**Consolidate or hide:**
- the roofing estimate form (for new work)
- the FollowUpRule engine
- the response-time dashboard
- the referral / review POST routes
- permit lessons and flat forms (hide)
- violation hearing / inspection pages (filters)
- three permit edit surfaces → one
- 45 sidebar entries → about 15

## Rulings needed

1. **Who sees a job's money?** Proposed: office roles + READ_ONLY + the
   job's PM. Not crew leads or marketing; sales reps see price, not cost.
2. **Is the separate customer contract still wanted** if estimates can be
   accepted online?
3. **Roofing P1:** labor basis, price source, budget seeding, ABC Supply
   account.
4. **Should the field use daily logs?** If not, stop investing there.

## Documents

All in `docs/audit-2026-10/`:

| Document | Contents |
|---|---|
| `CONSTRUCTION_CRM_ARCHITECTURE_AUDIT.md` | Architecture, Mermaid diagram, tech debt |
| `CONSTRUCTION_CRM_FEATURE_INVENTORY.md` | Every feature with status and evidence |
| `CONSTRUCTION_CRM_WORKFLOW_AUDIT.md` | Five end-to-end scenarios |
| `CONSTRUCTION_CRM_UX_AUDIT.md` | Roles, sweep results, 60-second check |
| `CONSTRUCTION_CRM_COMPETITIVE_GAP_ANALYSIS.md` | Eight products compared, sourced |
| `CONSTRUCTION_CRM_MVP_ROADMAP.md` | Scored roadmap, 18-field specs, sequence |

**Testing limits:**
- No click-by-click end-to-end run creating records per scenario. The steps
  were traced in code and their pages swept.
- No load testing.
- Competitor grades marked \* are provisional.
- Prod was read only.
