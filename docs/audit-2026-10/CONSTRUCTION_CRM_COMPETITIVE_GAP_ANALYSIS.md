# Construction CRM — Competitive Gap Analysis (2026-10-19)

How the KNU CRM compares with Buildertrend, Procore, JobTread, Builder Prime,
Contractor Foreman, Jobber, ServiceTitan and Houzz Pro, for one business: a
Florida multi-trade contractor with about seven office users. The work spans
homeowner roofing and remodels, code-violation remediation and commercial
subcontracting to GCs.

**Method.** The competitor columns come from web research on 2026-10-19,
using vendor product, help and pricing pages plus third-party reviews (sources
at the end). Grades marked **\*** are **provisional**: they rest on general
knowledge or a biased source (a competitor or vendor blog), not the vendor's
own page. Buildertrend's and Houzz Pro's pricing pages could not be read (403
/ 404). The KNU column comes from this audit's code review and prod data
(see `CONSTRUCTION_CRM_FEATURE_INVENTORY.md`). No mobile app store ratings
were researched.

Grades: **S** strong · **B** basic · **N** none · **?** unknown.

## 1. Capability comparison

| Capability | KNU CRM | Buildertrend | Procore | JobTread | Builder Prime | Contractor Foreman | Jobber | ServiceTitan | Houzz Pro |
|---|---|---|---|---|---|---|---|---|---|
| CRM / lead pipeline | **S** (stages, boards, Mine/All, sources, canvassing) | S | N\* | S | S | B | B | S\* | B |
| Automated follow-up / nurture | **B** (engine built, **sending off** on prod) | S | N\* | ? | S (email+SMS) | ? | B | B | ? |
| Estimating | **B** (two parallel systems, no price book outside roofing) | S | B\* | S | B | S | B | S (roofing) | B |
| Takeoff (incl. AI) | **B** (plan takeoff M1–M3, roofing AI; ends at measurements) | S\* | B\* | S (AI) | B (by integration) | S (AI assist) | N | S (EagleView etc.) | B |
| Proposals + e-signature | **B** (e-signed contract; no proposal send / view tracking) | S | B\* | S | S | S | S | S | S |
| Change orders | **S** (token approval, SOV / invoice) | S\* | S\* | S | ? | S | N\* | ? | S |
| Scheduling / Gantt / dispatch | **B** (calendar + People dispatch; no Gantt, no crew lanes) | S\* | S\* | B | S | S | S | S\* | B |
| Task management | **S** (one task model, workflows, dependencies, digests) | S\* | S\* | S | B\* | S\* | B | B\* | B\* |
| Daily logs + field app | **S** (field mode, logs, signatures, PDF package) | S | S | S | B | S | B | B\* | S |
| Subs / vendors + COI | **B** (directory + documents + expiry; **directory empty on prod**) | B | B | B | B | ? | N | ? | ? |
| Bids: inviting subs / comparing | **N** | S | S | B | N\* | S | N | N\* | B\* |
| Bids: answering GC invitations | **S** (intake, go / no-go score, submissions, award → job) | N\* | B | N\* | N\* | N\* | N | N\* | N\* |
| Job costing / budgets | **S** (one cost calculation, commitments, twin guards) | S\* | S\* | S | S | S | B | B\* | S |
| Progress billing / AIA / retainage | **S** (G702 / G703, retainage release) | ? | S | S | N\* | S | N | ? | ? |
| Accounting integration | **B** (QBO CSV export; cc-allocator for bank / card) | S | S\* | S | S | S | S | S | S |
| Customer portal + online pay | **N** | S | N\* | S | ? | S | S | B\* | S |
| Permit tracking | **S+** (record, corrections, forms, NOA checks, preflight) | ? | ? | ? | ? | S | N | ? | ? |
| Code-violation cases | **S** | N\* | N\* | N\* | N\* | N\* | N | N\* | N\* |
| GC relationship / prequal | **S** (accounts, health, vault, package) | N\* | B\* | N\* | N\* | N\* | N | N\* | N\* |
| Reporting / dashboards | **B** (attention rows, collections, funnel; no owner P&L view) | S\* | S\* | S\* | S | S | B–S | S\* | B\* |
| AI | **S** (permit reading, NOA, forms, roofing takeoff; capped + audited) | B\* | S | S | B | B | B | ? | B |
| Two-way SMS | **N** (Twilio not configured) | ? | ? | ? | S (paid) | ? | S | S\* | ? |
| Mobile | **B** (responsive web; no native app) | good\* | good\* | good\* | field app | ?\* | good\* | good\* | ?\* |

**Price points** (for build-vs-buy context, as of 2026-10):
- **Published:**
  - JobTread: $199/mo + $20 per user.
  - Builder Prime: $300/mo + $60 per office user.
  - Contractor Foreman: $49–$399/mo.
  - Jobber: $21–$371/mo.
- **Third-party estimates, provisional:**
  - Buildertrend: about $339–$1,099/mo plus onboarding.
  - Procore: about $15–30k/yr at $10–50M volume.
  - ServiceTitan: about $245–$700 per tech per month plus setup.
  - Houzz Pro: quotes conflict.

## 2. What KNU already does competitively

1. **Answering GC invitations.** Intake, go / no-go scoring, versioned submissions, award → progress-billed job, relationship health, prequalification vault and package. No product in the set is a subcontractor's tool for this. This is KNU's strategic edge for commercial work.
2. **Florida permit intelligence.** Correction letters read by AI, jurisdiction forms filled (including flat scans), FL Product Approval / Miami-Dade NOA checks with HVHZ flags, preflight, lessons. Only Contractor Foreman advertises even basic permit tracking (provisional: absence of evidence).
3. **Code-violation remediation cases.** Deadlines, hearings, fines and agency confirmation. No competitor showed this.
4. **Commercial-sub money controls.** G702 / G703 with retainage release, commitments, the crew-payment double-count guard, and cc-allocator reconciliation. Homeowner-focused tools (Jobber, Builder Prime, ServiceTitan, Houzz) lack AIA billing.
5. **One record across homeowner and commercial work.** The market splits: homeowner tools lack AIA billing and GC tools lack a homeowner CRM. KNU covers both.

## 3. Where competitors are substantially better

| Gap | Who does it well | Why it matters to KNU |
|---|---|---|
| Customer portal with online payment | JobTread, Jobber, Buildertrend, Houzz, Contractor Foreman | Faster deposits and draws. Prod shows 6 open jobs sitting in "Deposit Needed". |
| Proposal send and view tracking, good / better / best, follow-up on unsold estimates | Jobber, ServiceTitan, Buildertrend | Prod: 7 leads at "Estimate Sent". Estimates are never emailed from the CRM, so the CRM can't see whether one was opened. |
| Inviting subs and comparing their bids | Procore, Buildertrend, Contractor Foreman | Needed as soon as KNU prices commercial scopes it does not self-perform. |
| Gantt / crew resource scheduling | Buildertrend, Contractor Foreman, Builder Prime | Crew assignments have one day and no duration; double-booking is invisible. |
| Estimating cost libraries | ServiceTitan (roofing), JobTread, Contractor Foreman | Only roofing has a price book, and it is not connected to estimates. |
| Two-way SMS | Jobber, Builder Prime | Homeowners answer texts faster than email. |
| Native mobile app | most | Field mode is responsive web. It works, but offline use and camera flow are weaker. |

## 4. What KNU should not build

- **A general ledger or AP / AR accounting.** Keep QuickBooks / cc-allocator as the books; push to them.
- **Card / ACH processing or consumer financing.** Integrate Stripe (or the bank's processor) and Wisetack-type financing.
- **Roof measurement.** EagleView, Hover, GAF QuickMeasure and Roofr are the inputs; the CRM already reads Roofr reports.
- **SMS carrier infrastructure.** Twilio (already wired in code, not configured).
- **Generic area / count takeoff for homeowner work.** Roofr / EagleView cover it. Plan takeoff is only worth continuing for commercial plan sets where it feeds trade rules and supplier RFQs (M4–M6).
- **COI document reading.** Expiry tracking is enough; extraction and verification can be bought (Ressio, TradeGuard) if volume grows.

## 5. Where KNU can differentiate (build here)

1. **Commercial subcontractor loop end to end:** GC invitation → takeoff → estimate → submission → award → progress billing. Most of it exists; the missing joints are **takeoff → estimate** and **estimate → budget / cost baseline** (see roadmap MVP 2).
2. **Florida permit and product-approval expertise** captured as reusable records: jurisdictions, requirements, lessons. Already built; it needs use (prod has 4 permits).
3. **Code-violation remediation for property owners.** A niche no tool serves. Volume is the question (4 cases on prod).

## 6. Integrate rather than build

| Need | Integrate with |
|---|---|
| Payments + financing | Stripe / Wisetack (or the bank's processor) |
| Accounting | QuickBooks Online (export exists) / cc-allocator |
| Measurements | Roofr (done), EagleView / Hover if used |
| SMS | Twilio (code present; account and number not configured) |
| E-signature | Keep in-house (already built, audited, hash-pinned) |

## Sources

1. Contractor Foreman pricing — https://contractorforeman.com/pricing/
2. JobTread pricing — https://www.jobtread.com/pricing
3. Jobber pricing — https://www.getjobber.com/pricing/
4. Procore bid management — https://www.procore.com/bid-management
5. Procore pricing (third party) — https://projul.com/blog/procore-pricing-analysis-2026/ ; https://www.getonecrew.com/post/procore-pricing ; https://costbench.com/software/construction-management/procore
6. Builder Prime pricing — https://www.builderprime.com/pricing
7. Buildertrend CRM / email — https://buildertrend.com/sales-process/construction-crm/ ; https://buildertrend.com/sales-process/email-marketing-software/
8. Buildertrend bidding — https://buildertrend.com/?p=69169 ; https://www.newsfilecorp.com/release/316422
9. Buildertrend pricing (third party) — https://downtobid.com/blog/buildertrend-pricing ; https://projul.com/blog/buildertrend-pricing-analysis-2026/
10. Houzz Pro — https://pro.houzz.com/pro ; https://www.capterra.com/p/199689/Houzz-Pro/pricing/
11. ServiceTitan pricing (third party) — https://www.getonecrew.com/post/servicetitan-pricing ; https://schedulingkit.com/pricing-guides/servicetitan-pricing
12. ServiceTitan roofing — https://www.servicetitan.com/roofing ; https://help.servicetitan.com/docs/roofing-and-exteriors-home
13. JobTread AI / takeoff — https://www.jobtread.com/integrations/ai ; https://jobtread.com/news/jobtread-unveils-a-game-changing-on-screen-takeoff-feature
14. Procore AI — https://www.procore.com/ai
15. Procore COI (vendor-biased) — https://billyforinsurance.com/resources/how-to-track-cois-in-procore/
16. Procore Bid Board — https://v2.support.procore.com/en-gb/product-manuals/bid-board-company/faq-or-troubleshooting
17. Procore retainage — https://support.procore.com/faq/how-do-i-set-and-release-retainage-on-a-subcontractor-invoice-in-procore
