# Customer contracts (estimate → agreement → e-signature)

_Built 2026-09-25 in three stages on the `contracts` branch
(`.claude/worktrees/contracts`), from the plan in
`~/.claude/plans/when-a-lead-is-sprightly-scone.md`._

## What it is

A job's **Money → Estimates** tab hosts the same estimates panel the lead
has (roofing calculator + template estimates), with a status pill and a
Mark sent / accepted / declined menu. From an **accepted** estimate the
office generates a **customer contract**: a frozen, fully-merged agreement
(scope from the estimate's line items, price recomputed with the
estimator's own functions, payment schedule, the published template's
articles) rendered to PDF. **Money → Contract** sends it to the customer
with a private 30-day link; the customer reads, types their name, draws a
signature and ticks an ESIGN-style consent on `/sign/[token]`; the signed
PDF (signature page + certificate page) is stored, the job's contract
amount and deposit are set from it, and both sides get a copy.

## Where things live

| Concern | Path |
|---|---|
| Schema | `CustomerContract`, `ContractTemplate`, `ContractTemplateVersion`, `GeneratedDocument.customerContractId`; migration `20261003120000_customer_contracts` (CHECK: exactly one of `estimate_id` / `roof_estimate_id`) |
| Pure logic | `src/lib/customer-contracts/{merge,schedule,snapshot,state,status,access,template-content,preview}.ts` |
| Orchestration | `service.ts` (list/get/create/regenerate/delete/void), `sign-service.ts` (send/resend/sign/decline/`getContractForSigning`), `templates.ts` (versioning + seeder), `email.ts` |
| PDF | `src/lib/pdf/customer-contract.tsx` |
| Seed | `prisma/seeds/contract-templates/residential-construction.ts`, `prisma/seed-contract-templates.ts` (called from `prisma/seed.ts`; hash pinned in `seed-specs.test.ts`) |
| Office routes | `GET/POST /api/jobs/[id]/contracts`; `/api/customer-contracts/[id]` (GET, DELETE) + `/send`, `/resend`, `/regenerate`, `/void`, `/pdf?kind=`, `/documents`, `/sign-link`; `GET /api/contract-templates` |
| Admin routes | `/api/admin/contract-templates[/[id]][/versions][/merge-fields]`, `/api/admin/contract-template-versions/[vid][/publish|/archive|/preview]` |
| Public routes | `/sign/[token]` (page), `/api/sign/[token]` (GET summary, POST sign), `/api/sign/[token]/pdf`, `/api/sign/[token]/decline` — all in `PUBLIC_PREFIXES`, rate-limited |
| UI | `components/jobs/contract-panel.tsx`, `components/estimates/generate-contract-dialog.tsx`, `components/customer-contracts/*` (hooks, admin editor), `components/jobs/pricing-panel.tsx` (locked under a signed contract), `app/(dashboard)/admin/contract-templates/**` |
| Estimate status | `src/lib/estimates/estimate-status.ts`, `PATCH /api/leads/[id]/template-estimates/[estimateId]` `{status}` |

## Rules

- **One source estimate per contract**, enforced by the DB CHECK. Template
  estimates must be ACCEPTED to generate; roofing estimates have no status
  and can always generate. Unselected optional lines are dropped; selected
  ones are included and marked "(selected option)".
- **The snapshot is the contract.** Articles are stored already merged; the
  signed PDF is re-rendered from the stored snapshot plus the signature —
  never from live data. Office and public PDF routes serve the **stored
  bytes**, so `unsignedPdfSha256` (taken at send) identifies exactly what
  the customer saw; it is printed on the certificate with `sha256(token)`.
- **Single use.** Signing flips `status` with a conditional
  `updateMany({ where: { id, status: "SENT" } })`; count 0 → `already_signed`.
  Resend rotates the token (old link → 404); decline and void null it.
- **At most one SENT and one SIGNED contract per job.** A draft cannot be
  sent while another is out or signed (`sent_exists` / `signed_exists`).
- **Money on sign** (`computeMoneyEffects`, pure, tested):
  - FIXED_PRICE: `Job.contractAmount = signed total + Σ approved change
    orders`; `depositRequired` = the schedule's first stage.
  - COST_PLUS / OWNED_REHAB: contract amount left alone (rollup recompute
    would clobber it); noted in `moneyApplyNote`.
  - PROGRESS billing: base SOV line created or updated to the signed total;
    **skipped** (with an office task) when applications were already
    issued or there are several base lines. `sendContract` refuses
    outright on a PROGRESS job with issued applications.
  - `recomputeJobBalance` afterwards; the Pricing card locks the amount.
- **Void of a SIGNED contract** (ADMIN/MANAGER only) decrements the job's
  contract amount by the signed total (change orders stay) and never
  touches the SOV; refuses when applications are issued. Signed PDFs,
  signature PNGs and File rows are never deleted.
- **Templates**: a PUBLISHED version is immutable (contracts pin it). Edit
  = new DRAFT → save (problems reported, not blocking) → publish
  (validation blocks: title, article keys, schedule sums to 100, consent
  text, only catalogued `{{merge.fields}}`). The seeder pins v1 by hash and
  throws `SeedVersionInUseError` if the spec changes while a contract
  references it — bump `CONTRACT_TEMPLATE_VERSION`.
- **Roles** (explicit lists in `access.ts`): manage = ADMIN, MANAGER,
  OFFICE_STAFF, SALES_REP; void a signed one = ADMIN, MANAGER; view adds
  READ_ONLY; templates manage = ADMIN, view = ADMIN, MANAGER, OFFICE_STAFF.
- **Auto-task** `contract.sent` (3 business days, sales rep) closes on sign
  (COMPLETED) or decline (CANCELLED); disable via `TASK_AUTO_RULES_DISABLED`.
- **Emails** go through `renderEmailLayout` with `escapeHtml` on every
  dynamic string; PDF attached; reply-to = sender. Signed: customer gets
  the signed copy, sender gets an internal note. Declined: internal note.

## Ops

```bash
# Seed / re-seed the default template (idempotent; run on prod after deploy)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-contract-templates.ts"'
# Dev only: purge QA contracts/estimates and reset the template to v1
npx tsx scripts/qa-cleanup-contracts.ts
```

Public links are built from `APP_BASE_URL` (falls back to `NEXTAUTH_URL`).
The default template's articles are sensible residential defaults, not
legal advice; Florida-specific notices (Ch. 713 lien notice, Ch. 489
disclosures) belong in Richard's edit under Admin → Contract Templates.

## Known gaps / follow-ups

- `File.uploadedByUserId` is required, so the customer-signed PDF's File
  row is attributed to the contract's creator; the signer is on the
  contract row and the audit event.
- The deposit task created at Won still quotes 50% of the lead's estimated
  value; the signed schedule's deposit lands on `Job.depositRequired` but
  the open task's text is not rewritten.
- `middleware.ts` is deprecated in Next 16 (`proxy.ts`); the public prefix
  list lives there until that chore.
- Rate limits are per-process (single droplet).
