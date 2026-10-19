# Construction CRM — End-to-End Workflow Audit (2026-10-19)

Five KNU scenarios, traced through the code and checked against what prod shows
people actually doing.

**Legend:**
- ✅ supported end to end
- ⚠️ supported, with re-keying or a manual step
- ❌ break: data does not flow, or the step does not exist

**Evidence** labels are as in the inventory: C code, T tests, D dev page sweep,
P prod counts.

**Not done:** a click-by-click run of each scenario creating records on dev.
Pages and APIs for every step were swept for errors (D), and each transition
was traced in code (C). Live-only transitions (e-sign, email, AI) are covered
by earlier dev QA recorded in the feature notes, not re-run today.

---

## Workflow 1 — Residential roofing

Lead → inspection → measurements → estimate → proposal → contract → permit →
material order → install → inspection → invoice → closeout

| # | Step | Where | State | What happens / breaks |
|---|---|---|---|---|
| 1 | Lead | `/leads/new`, phone routing (off) | ✅ | Duplicate warning only; phone formats not normalised |
| 2 | Inspection appointment | Stage "Appointment Scheduled" + a task | ⚠️ | No appointment object; a task with a time on the calendar is the stand-in |
| 3 | Measurements | Lead → Roofr tab (`RoofMeasurement`) | ✅ | Roofr PDF parsed, corrections kept |
| 4 | Estimate | Lead → Estimates → roofing estimate | ❌ | **Squares re-typed by hand**. Material is one lump number. The price book and rules engine are not used (C `estimates-panel.tsx`; `previewTakeoff` admin-only) |
| 5 | Proposal | Estimate PDF (`lib/pdf/estimate.tsx`) | ⚠️ | Downloaded and emailed by hand. "Mark sent" is manual; no view tracking. `RoofEstimate` has no status at all |
| 6 | Lead → Won → job | Stage move → `createJobFromLead` | ❌ | **Job price = hand-typed `estimatedJobValue`**, not the estimate. A blank value gives a $0 job with no deposit step (C `services/jobs.ts:62-80`) |
| 7 | Contract | Job → Money → Contract → Generate / Send / Sign | ⚠️ | Works (T), but P shows **0 contracts ever**. The estimate → contract → job-price path has never run on prod |
| 8 | Permit | Job → Permits / `/permits/[id]` | ✅ | Workflow step + permit record + alerts |
| 9 | Material order | — | ❌ | No PO, no supplier order. A commitment can record the promise (P: 0 vendors to attach it to) |
| 10 | Install | Crew assignment install date + workflow steps | ⚠️ | One-day install; no duration; double-booking unflagged |
| 11 | Final inspection | Permit inspection result → workflow step | ✅ | A failure raises a correction task (no owner when the job has no PM) |
| 12 | Invoice | Job → Money → Invoices (lump sum) | ⚠️ | Typed by hand; editable after SENT / PAID with no audit |
| 13 | Closeout | Workflow `close_job` checklist | ⚠️ | Warranty, lien release and closeout docs are ticks; no warranty record |

**Duplicate entry:** squares (Roofr → estimate), price (estimate → lead value →
job), invoice amounts.

**Biggest fix:** the estimate drives the job. That means a roofing estimate
section generated from the measurement and price book, and the job price and
cost baseline taken from the accepted estimate at Won.

## Workflow 2 — Commercial plumbing (KNU as sub to a GC)

GC opportunity → bid invitation → plans review → takeoff → estimate → bid
submission → award → subcontract → permit → construction → progress billing →
closeout

| # | Step | Where | State | What happens / breaks |
|---|---|---|---|---|
| 1 | GC opportunity / account | `/partners` | ✅ | P: 2 accounts |
| 2 | Bid invitation | Bid intake (paste) or Log a bid → GC_BID lead | ✅ | Inbound email off until `MAILERSEND_INBOUND_SECRET` |
| 3 | Plans review | Plan takeoff → upload set → sheet index | ✅ | M1 (T, D) |
| 4 | Quantity takeoff | Plan takeoff workspace | ⚠️ | Manual tools + AI for **roofing only**. **Plumbing AI (M4) not built** |
| 5 | Estimate | Sectioned estimate | ❌ | **No plumbing template**; templates carry no prices; takeoff quantities do not flow in |
| 6 | Sub pricing (if KNU subs out scope) | — | ❌ | No outbound sub bid package or comparison |
| 7 | Bid submission | Lead → Bid tab → Record submission | ⚠️ | Versioned and snapshotted, but **the price is typed by hand**; not checked against the linked estimate |
| 8 | Award → job | Close → Awarded → `createJobFromLead` | ⚠️ | Progress billing, 10% retainage, no deposit ✅. **No cost baseline** carried from the submission |
| 9 | Subcontract | — | ⚠️ | Vault / package covers prequalification; the GC's subcontract is filed as a document. No clause tracking |
| 10 | Permit | Permit record | ✅ | Usually the GC's permit; sub permits are supported |
| 11 | Construction | Workflow, daily logs, crews | ⚠️ | P: daily logs barely used (1 in 30 days) |
| 12 | Progress billing | G702 / G703, SOV, retainage | ✅ | Strong (JOB-00009 history) |
| 13 | Closeout | Retainage release application + `close_job` | ✅ | — |

**Duplicate entry:** takeoff → estimate, estimate → bid amount, bid → budget.

**Biggest fixes:** takeoff → estimate lines (M5), and the submission's cost
snapshot → budget at award.

## Workflow 3 — Interior renovation

Lead → site visit → scope → estimate → proposal → contract → scheduling →
subs → construction → change orders → final payment

| # | Step | State | Notes |
|---|---|---|---|
| Lead, site visit | ✅ / ⚠️ | As in W1; the site visit is a task |
| Scope | ⚠️ | Free text on the lead / estimate sections; no structured scope |
| Estimate | ⚠️ | Interior template exists, but **no prices and no cost-type split**. The "Unit price" label invites double margin |
| Proposal | ⚠️ | PDF hides cost (good); no send / view tracking |
| Contract | ⚠️ | Built, never used on prod (0 contracts) |
| Scheduling | ⚠️ | Workflow steps on business-day offsets + calendar; no Gantt; crews one day |
| Sub coordination | ❌ | No sub directory on prod (0 vendors), no sub schedule lanes, no sub portal |
| Construction | ⚠️ | Workflow + tasks; daily logs unused |
| Change orders | ✅ | Token approval → invoice; crew CO linked |
| Final payment | ✅ | Payment → balance → workflow gate completes itself |

**Duplicate entry:** estimate total → lead value → job; CO price typed (not from
estimate lines).

## Workflow 4 — Code-violation remediation

Intake → deadlines → site inspection → scope → estimate → permit →
remediation → reinspection → closure

| # | Step | State | Notes |
|---|---|---|---|
| Intake | ✅ | Five-step intake on a lead (T, D) |
| Deadline tracking | ✅ | Deadlines, extensions, reminders (cron) |
| Site inspection | ✅ | Case workflow step |
| Scope / estimate | ⚠️ | The estimate lives on the **lead**, as for any job; no link from violation items to estimate lines |
| Permit | ✅ | Linked job's permit; expiries overlay |
| Remediation | ✅ | Linked job's workflow; `job-sync` mirrors completion |
| Reinspection | ✅ | Agency inspection record; FAIL reopens items |
| Closure | ✅ | Agency confirmation required; override audited |

**Gaps:** escalations are off (env); no reports (Stage 4, not needed at 4
cases); a violation case's tasks never carry the job, so they **do not show on
the job's Tasks tab**.

**Verdict:** the most complete workflow end to end, and the least used (P: 4
cases).

## Workflow 5 — GC relationship development

GC identification → contact research → qualification package → outreach →
follow-up → bid invitation → submission → award / loss → maintenance

| # | Step | State | Notes |
|---|---|---|---|
| Identification | ⚠️ | Accounts by hand; discovery (Phase 6) deferred |
| Contact research | ⚠️ | Contacts by hand; no enrichment |
| Qualification package | ✅ | Vault + checklist + zip package |
| Outreach | ⚠️ | Interactions are logged; the CRM never emails a GC (by design) |
| Follow-up | ✅ | Follow-up cron raises tasks per rule |
| Bid invitation → submission | ✅ / ⚠️ | As W2; price by hand |
| Award / loss | ✅ | Outcome + reasons; award → job |
| Relationship maintenance | ✅ | Health score, scorecard, analytics |

**Verdict:** complete in code, idle in use. P: 2 accounts, 1 contact, 1
interaction, 0 intakes. Coastal Choice scores 15 / Dormant because nothing has
been logged.

---

## Cross-workflow findings

1. **The estimate is not the source of truth.** In every workflow the price
   is retyped at least twice: estimate → `estimatedJobValue` → job →
   invoices / submission. The cost baseline is read live from an editable
   estimate, or missing.
2. **Contracts are built but unused.** P: 0 customer contracts. Either the
   flow does not fit how KNU sells, or it is not known. Ask before building on
   it.
3. **Field capture is thin.** 1 daily log in 30 days, against 57 workflow
   steps completed and 61 expenses. The office runs the jobs; the field does
   not use the CRM.
4. **Overdue task debt.** 69 active tasks are overdue (P), 32 of them on one
   person, and 15 open steps have no owner (no workflow role defaults set). The
   system generates more work than the team closes.
5. **Automations wait on one DNS fix.** Nurture, task escalations and
   violation escalations all wait on the duplicate SPF record.
6. **No material ordering anywhere.** Roofing and plumbing both need supplier
   orders; M6 (RFQ) and commitments are the closest pieces.

## Missing transitions (ranked)

| Transition | Today | Should be |
|---|---|---|
| Accepted estimate → job price + cost baseline | Hand-typed lead value; live estimate read | Snapshot at acceptance / Won |
| Roof measurement → roofing estimate | Re-typed | Generated section from the engine + price book |
| Takeoff measurements → estimate lines | None | M5 "approved takeoff → estimate section" |
| Bid submission cost → awarded job budget | None | Budget lines from the submission's estimate |
| Estimate lines → budget lines | None | One click at contract / Won |
| Failed inspection → owner when no PM | Unowned task | Fallback to coordinator → oldest admin (as alerts do) |
| Violation case tasks → linked job's task list | Not shown | Shown in the job's Tasks panel |
