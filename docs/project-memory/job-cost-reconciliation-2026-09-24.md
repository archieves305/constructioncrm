# Job-cost reconciliation against cc-allocator — findings, 2026-09-24

_Read-only pressure test, prod data as of 2026-09-24 ~20:20 ET. CRM
`job_expenses` and cc-allocator `Transaction` (card) + `BankTxn` (bank)
dumped over ssh and diffed offline. **Richard ruled the same evening and
Phase 1 was built, deployed (`3e8b211`) and applied — see "Outcome" at the
end.**_

## Populations

| Side | Rows | Notes |
|---|---|---|
| CRM `job_expenses` | 448, all APPROVED | 348 from cc-allocator ($336,882.91) · 99 manual ($472,809.01) · 1 payroll ($900) |
| cc-allocator card `Transaction` | 5,161 | 279 linked to a CRM job, 253 record a CRM expense id |
| cc-allocator `BankTxn` | 16,795 | 102 linked to a CRM job, 97 record a CRM expense id |

11 CRM jobs carry allocator rows. cc-allocator posts with
`externalId = <txn.id>` (card) or `bank:<id>` (bank).

## 1. Agrees (347 rows)

Every posting cc-allocator recorded and the CRM still holds matches on
amount, job, expense type and date (254/254 card dates equal `txnDate`).
The only drift is the `billable` flag: 98 card rows on JOB-00003 (owned
rehab) plus one on a fixed-price job and two bank rows were sent
`billable=false` and stored `true`. On an owned rehab the flag moves no
money; cosmetic, worth a note on the reconciliation page.

## 2. cc-allocator believes it posted; the CRM has nothing — 3 rows, $25,584.10

| Payee | Amount | Job | Date | cc-allocator id → CRM expense id |
|---|---:|---|---|---|
| BNW Construction | 14,029.76 | JOB-00011 | 2026-07-07 | `cmrf8hvy30hia…` → `cmrfb17s9…` |
| BNW Construction | 10,524.74 | JOB-00010 | 2026-07-22 | `cmrzd0kxs008i…` → `cms3yvfoq…` |
| Roberto Rodriguez | 1,029.60 | JOB-00006 | 2026-06-05 | `cmrf8hvxx0hfx…` → `cms42iz84…` |

No CRM row exists by external id or by id, so they were deleted after
posting (ADMIN-only). **Expense deletes are not audited** — `audit_events`
has zero `JobExpense` rows — so who and why is unknowable. cc-allocator
will never retry: it holds a `crmExpenseId`. If the deletions were not
deliberate, job costs on those three jobs are understated by this much.

## 3. Linked to a job, never posted

**Card — 26 rows.** 23 are credits/returns totalling **−$7,580.00**
(JOB-00003 ×15, JOB-00002 ×5, JOB-00014 ×2, JOB-00005 ×1): 21 were
rejected by the CRM with `400 Too small: expected number to be >0`, 2 not
yet attempted. The intake route refuses negative amounts, so **refunds
never reach job costing** and those jobs' costs are overstated by up to
$7,580. The 3 positives ($389.56) are in flight or failed on
cc-allocator's side (Home Depot $13.89 FAILED, ACI Miami-Dade $164.79
SUGGESTED, Home Depot $210.88 APPROVED).

**Bank — 5 rows, $16,443.75.** BNW Construction $11,694.15 (JOB-00010,
2026-07-02) is POSTED to QBO with the CRM leg never requested (`postCrm`
off). Three are APPROVED and waiting for the worker: Roberto Rodriguez
$3,135.60 (JOB-00009, 05-22), Roberto Rodriguez $432.00 (JOB-00006,
06-05), Sikaffy & Bogran $750.00 (JOB-00006, 06-12). One NEEDS_ASSIGNMENT:
Roberto Rodriguez $432.00 (JOB-00006, 05-22).

## 4. Manual row twinned by an allocator row — 20 pairs, $16,502.96

Same job, same amount, same day; one row manual, one from cc-allocator.
The 2026-08-03 count was 12 / $9,166.20; **8 more pairs have appeared
since**, because in 19 of 20 the manual row was entered first and nothing
compares an incoming posting with what is already there.

| Job | Pairs | $ | Manual side | Source | Reading |
|---|---:|---:|---|---|---|
| JOB-00003 (owned rehab) | 10 | 6,911.99 | Richard, 2026-04-23, Home Depot | card | duplicates; inflate the rehab's cost rollup, no customer owes it |
| JOB-00009 | 4 | 6,026.90 | Elizabeth, 2026-08-07, subcontractor ACH | bank (posted 08-17) | duplicates — checks entered by hand, then the bank feed |
| JOB-00002 | 3 | 2,228.00 | Richard ×1 (April), Erica ×2 (July), Home Depot | card | duplicates |
| JOB-00004 | 2 | 904.07 | Erica, 2026-07-13, Home Depot | card | duplicates |
| JOB-00006 | 1 | 432.00 | Elizabeth, "Roberto Rodriguez" vs bank "Richard Perez" | bank | **probably genuine** — different payees; the bank's own Roberto Rodriguez $432 for that day is still queued (class 3) and will be the real twin when it posts |

One more within 3 days: JOB-00006 $800.00, Octavio Obregon (manual,
06-12) vs Sikaffy & Bogran (bank, 06-15) — different payees, probably
genuine.

Correction to the August note: none of the pairs sits on a lump-sum
customer bill as billable. The ten "billable" rows are all on the owned
rehab, where the flag moves nothing; the fixed-price pairs are
non-billable cost rows. **Customer balances are not inflated; job costs
(and JOB-00003's rollup) are.** Backing out a confirmed pair means
deleting the manual row — `DELETE /api/expenses/[id]` already reverses any
contract increment cleanly; the review route is PENDING-only by design.

## 5. Clean

0 CRM allocator rows orphaned · 0 manual↔manual same-day duplicates ·
0 rows cc-allocator marked `duplicateOf` reached the CRM · 0 pending
(unsettled) card transactions posted.

## Dollars, both directions

| | Amount |
|---|---:|
| Likely overstated: 18–19 confirmed duplicates | 16,070.96 – 16,502.96 |
| Likely overstated: credits that never posted | 7,580.00 |
| Understated if the 3 deletions were mistakes | 25,584.10 |
| Not yet costed: bank rows queued / unflagged | 16,443.75 |

## Proposal — the smallest reconciliation that holds

**Phase 1, CRM only (no cc-allocator change):**

1. **Intake guard.** In `POST /api/integrations/cc-allocator/expense`, look
   for an APPROVED manual row on the same job with the same amount within
   ±3 days. If one exists, create the posting as **PENDING** with
   `reviewNote: "Possible duplicate of <id> (<vendor>, <date>)"`. PENDING
   moves no money, the review queue already surfaces it, and the reviewer
   either approves (two real charges) or deletes the manual twin. This is
   the control that would have stopped all 20 — pure function, tested,
   ~40 lines.
2. **Accept credits from the integration.** Allow a negative amount from
   cc-allocator (same type, negative). Every total is a sum, so nothing
   else changes; the UI shows it as a credit. Then replay the 23 stuck
   rows (cc-allocator retries on error, so a fix here may drain them on
   its own — confirm in its worker before assuming).
3. **Reconciliation page.** `GET /api/admin/job-cost-reconciliation`
   (explicit list: the job-cost approver roles) returning the manual↔
   allocator pairs (exact day and ±3 days, vendors side by side, who
   entered which, source card/bank) and the billable-flag drift; an admin
   page with **Confirm duplicate → delete manual row** (audited — add the
   missing `AuditEvent` on expense delete first) and **Keep both**
   (records a note so the pair stops appearing).

**Phase 2, needs cc-allocator:** an export of its CRM-linked postings
(id, crmJobId, crmExpenseId, amount, date, status, postCrm, lastCrmError)
so classes 2 and 3 show on the same page continuously instead of via the
SQL dump used here.

## Decisions needed from Richard before any mutation is built

1. Confirm the likely duplicates (JOB-00003 ×10, JOB-00009 ×4,
   JOB-00002 ×3, JOB-00004 ×2 — that is **19**, not the "18" this doc
   first said; the $16,070.96 was right — the JOB-00006 $432 and $800 look
   genuine).
2. The three deleted postings ($25,584.10): intended, or re-enter?
3. BNW Construction $11,694.15 on JOB-00010: should it be job-costed
   (flip `postCrm` in cc-allocator)?
4. Credits policy: accept negative postings from the card feed as
   described in Phase 1.2?

## Outcome (2026-09-24, same evening)

Richard: the listed pairs are duplicates; the three deletions were
intentional; BNW should be job-costed; accept credits.

- **Phase 1 shipped** (`3e8b211`, migration `20260926120000_expense_reconciliations`):
  intake guard (twin → PENDING with review note), credits accepted from the
  integration route, audited `deleteExpense`, `ExpenseReconciliation`,
  `GET/POST /api/admin/job-cost-reconciliation[/resolve]`, the **Cost
  Reconciliation** admin page.
- **19 duplicates removed, $16,070.96** (`scripts/reconcile-duplicate-expenses-2026-09-24.ts`
  through `resolvePair`, attributed to Richard): 19 `expense_delete` audit
  events, 19 DUPLICATE + 2 KEEP `expense_reconciliations` rows. JOB-00003's
  rollup recomputed itself.
- **23 credits posted, −$7,580.00**, and **BNW $11,694.15 on JOB-00010**
  posted, via two scripts run inside cc-allocator
  (`scripts/cc-allocator/`); cc-allocator now shows 0 CRM errors on
  credits. Gotcha: BullMQ keeps `crm-<id>` job ids, so a failed attempt has
  to be removed before a re-add does anything.
- **Not touched, by decision:** the three deleted postings ($25,584.10).
  The three APPROVED-awaiting-worker and one NEEDS_ASSIGNMENT bank rows
  ($4,749.60) are cc-allocator's normal queue; when the queued Roberto
  Rodriguez $432 (06-05) posts it will pair with the manual $432 on
  JOB-00006 and arrive PENDING.
- Prod after: 453 expenses (448 − 19 + 23 + 1), 0 pending.
