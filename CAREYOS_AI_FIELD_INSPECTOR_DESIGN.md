# AI Field Inspector — Assessment and Plan

_2026-11-25 · status: **approved; Phase 1 built on `field-inspector` (not deployed)** — notes in `docs/project-memory/features/field-inspector.md`_

Source brief: "Claude Code Master Development Prompt — AI Field Inspector & Work
Acceptance System" (pasted 2026-11-25). This document answers its §33 list. It is
written against the code on `main` (`25112cd`) and the CRM's own records. Section
numbers in brackets refer to the brief.

---

## 1. Executive summary

The brief describes **capture → analyze → identify → correct → reinspect → approve →
authorize payment**. Most of the parts it needs already exist in the CRM. They exist
as separate pieces and have never been joined:

| Brief needs | Already in the CRM |
|---|---|
| Phone capture, offline, retries | KNU Field outbox (SQLite, Idempotency-Key, background upload), 2,000 px JPEG with EXIF time |
| Rooms / areas | `JobArea` (name, floor, unit) |
| Before / after photos | `File.phase` BEFORE / DURING / AFTER |
| Punch list | `FieldIssue` type `PUNCH` → an ordinary task, status synced both ways |
| AI with images, structured output, cost caps | `runAiCall` (`src/lib/ai`) — takes image blocks, zod schema, per-subject + monthly caps, `AiCall` ledger, cache by input hash |
| Contractor access without an account | `GuestLink` / `GuestSubmission` (`src/lib/guest`) — hashed token, expiry, revoke, English / Spanish, nothing takes effect until the office accepts |
| SMS | Twilio provider wired (`src/lib/services/notifications/twilio-provider.ts`), used for lead alerts and follow-ups; guest links are copied by hand today |
| Push / in-app | `notify()` → bell, digest, Expo push |
| Payment gate | `LaborContractTask.inspectionRequired` / `inspectionStatus` (PENDING / PASSED / FAILED / NA) / `approvedBy`; `isApprovedForPayment()` = complete and passed |
| Payment requests → accountant → CC Allocator | `LaborPaymentRequest` → accountant task → `LaborPayment` linked to CC Allocator's bank line |
| Buildium | Not in the CRM: CareyOS Work owns Buildium and already hands work to KNU ("Send to KNU") and copies KNU photos back |

What is genuinely new: an **inspection record**, **AI findings with boxes drawn on a
photo**, **human review of findings**, a **correction loop** (reinspect one finding
against its original photo), and an **inspection → contract-line → payment-request
link**. The defect library, quality profiles, scoring, scorecards and the knowledge
repository follow later.

**Recommendation.** Build in six phases. Phase 1 is the phone inspection with AI
findings and human review, which then raises ordinary punch items. Contractor texting
and the payment gate come after the AI has been checked on KNU's own photos. Phase 1
is about 8–10 working days.

**Reality check.** The prod usage measured on 2026-11-08 shows 4 active people in 30
days, no field reporting, and one phone registered. No crew has been sending photos.
So the first user of this module is the owner or a PM walking a property, not a crew.
Phase 1 is designed for that person.

---

## 2. Existing architecture assessment [§2, deliverables 2–3]

- **App:** Next.js 16.2.3 App Router + Prisma / Postgres, one droplet, systemd `knuco`,
  `crm.careyos.com`. One company (KNU). There is no tenant or company column anywhere.
  `Organization` means a GC account, not a tenant.
- **Mobile:** KNU Field (Expo SDK 58, `mobile/`). It is a thin client of `/api/*` with
  Bearer tokens. Screens already include photo, problem, issue, quick add, the
  **permit** inspections (`JobPermitInspection` — the government inspection, a
  different thing), crew day, log, files and owner summary. It has an outbox and an
  offline cache.
- **Auth / roles:** CareyOS SSO. `RoleName` = ADMIN, MANAGER, SALES_REP, OFFICE_STAFF,
  MARKETING, READ_ONLY, CREW_LEAD, CREW_MEMBER. Guards in `lib/access/records.ts`
  (`guardJob`, `guardJobMoney`), field access in `lib/labor/permissions.ts`.
  Crew redaction is in `lib/access/crew-redact.ts`. `route-guards.test.ts` fails on any
  session-only handler.
- **Properties:** there is no Property model. The address lives on the Lead. KNU's own
  flips and rentals are `Job.jobType OWNED_REHAB` + `ownedPurpose FLIP | RENTAL`, with
  `isRentalTurnover` and `priorTenantName` already present.
- **Contractors:**
  - `Vendor` (SUBCONTRACTOR / SUPPLIER);
  - `Crew` (phone, foreman, language, trades, optional vendor);
  - `Personnel`;
  - `LaborContract` (crew or typed label);
  - `LaborContractTask` (a contract line with room, description and inspection fields).
- **Files:** local disk under `UPLOADS_DIR`, backed up nightly. Phones and the web
  **downscale to 2,000 px JPEG before upload; the full-size original is not kept.**
  `File` carries `takenAt`, `phase`, `sha256` and many owner links. It has no
  `fieldIssueId`: an issue's photos are Files on the issue's task.
- **Background work:** Next `after()` (permit readings, proposals) plus a claimed tick
  queue only for plan takeoff (`PlanJob`, `SKIP LOCKED`, 40 s budget, cron every
  minute). There is no generic queue. A permit reading that was cut off restarts on
  the next page load.
- **AI:** `runAiCall` (`src/lib/ai/calls.ts`) — structured output, cached system
  prompt, server-side fallback, untrusted-document framing, caps of
  `AI_MAX_USD_PER_SUBJECT` $5 and `AI_MONTHLY_MAX_USD` $100. The monthly cap is shared
  by permits, takeoff, bids and the phone voice drafts. Known limit: the
  structured-output grammar refuses more than 16 nullable fields, so schemas stay flat
  (PlanHub 1b lesson).
- **Notifications:** `notify()` (bell + digests + push). There is no SMS channel in
  `notify()`.
- **Audit:** `AuditEvent` via `recordAudit`; per-record activity on tasks.

## 3. Gap analysis [deliverable 4]

| Area | Reuse as is | Extend | New |
|---|---|---|---|
| Capture | outbox, `preparePhoto`, EXIF, `File.phase` | `/api/files` takes `inspectionId` + `inspectionAreaId` | inspection screens |
| Record | `JobArea`, `Job`, `LaborContract`, `Crew`, `Vendor` | — | `Inspection`, `InspectionArea`, `InspectionPhoto` |
| AI | `runAiCall`, pricing, `AiCall`, fallback | image-size helper, inspector cap | prompts, schemas, analysis runs with claim + stale restart |
| Findings | — | — | `InspectionFinding` with boxes, kind, severity, review state, frozen AI output |
| Annotation | — | — | SVG overlay (the takeoff viewer pattern) on web and phone |
| Punch | `FieldIssue PUNCH` → task | `FieldIssue.inspectionFindingId` | — |
| Contractor | `GuestLink`, `GuestSubmission`, Twilio | new purpose `CORRECTIONS` (several rounds per link) | correction page, SMS send button |
| Reinspect | — | — | targeted compare call (original box + new photo) |
| Payment | `LaborContractTask.inspectionStatus`, `LaborPaymentRequest`, CC Allocator crew endpoint | set the line's status from an accepted inspection; show it on the request and to CC Allocator | override with reason |
| Turnover / Buildium | Work's "Send to KNU" + photo copy back; `isRentalTurnover` | inspection summary back to Work | rent-ready checklist |
| Standards | — | — | quality profiles, defect library, scoring, scorecards (later phases) |

## 4. Architectural conflicts and concerns [deliverable 6]

1. **Every field record needs a job.** `FieldIssue`, `FieldPhoto`, `JobArea` and
   `GuestLink` all require `jobId`. A Quick Inspection (and an Equifirst rental that
   is only a Buildium item) has none. **Proposal:** `Inspection.jobId` is optional;
   an inspection without a job keeps an address and can be attached to a job later.
   Punch items, guest links and payment effects need a job, so they are offered only
   once one is attached.
2. **No originals.** Only the 2,000 px copy exists. That copy happens to fit the
   current models' high-resolution budget (2,576 px edge, 4,784 visual tokens): a 4:3
   2,000 × 1,500 photo is sent unchanged, so the boxes the model returns map 1:1 onto
   the stored photo. A square 2,000 × 2,000 is resized by the API (5,184 tokens), and
   the boxes are then rescaled with the documented resize rule. **Recommend keeping
   2,000 px** and not storing full originals (ruling 4).
3. **Shared AI budget.** The $100 monthly cap is shared. Inspections should get their
   own monthly cap so a busy turnover week never blocks permit work.
4. **Background reliability.** `after()` work dies on a restart (every deploy). Each
   analysis is a row that is claimed, timed out and restarted by a minute cron, as
   the takeoff queue does.
5. **Crew and contractor data isolation.** A guest link today shows only the street,
   the crew name and part of the contract description. A correction link must show
   only that contractor's findings and photos: never other contractors' findings,
   amounts, the customer's or tenant's details, or unconfirmed AI findings.
6. **Photos of occupied homes** (turnovers, warranty calls) can show people,
   belongings and papers. The prompt tells the model not to describe people or read
   documents, and photos never leave the CRM except to the AI provider.
7. **Multi-company.** The brief assumes several companies. The CRM is KNU only, and
   Equifirst property management runs in CareyOS Work. **This plan does not add
   tenancy** (ruling 10).

## 5. Recommended architecture [deliverable 5]

```
Phone / web ──photos──▶ /api/files (inspectionId, areaId, idempotent)
                              │  File row (2,000 px) + InspectionPhoto
                              ▼
                     InspectionAnalysis row (QUEUED, one per area batch ≤ 6 photos)
                              │  claimed by after() at once, else by the minute cron
                              ▼
                     lib/inspector/analyze.ts ──▶ runAiCall (Sonnet 5.5, images + scope text)
                              │  zod-validated findings, per-photo quality, more-photo requests
                              ▼
                     InspectionFinding rows (PROPOSED, AI output frozen)
                              │  phone polls / push "analysis ready"
                              ▼
              Person reviews: confirm · edit · dismiss · add · move the box
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
     FieldIssue PUNCH → task       Phase 2: guest link CORRECTIONS → contractor
                                            correction photo → compare call → accept
                                                          │
                                   Phase 4: LaborContractTask.inspectionStatus PASSED
                                            → payment request shows "inspection passed"
                                            → CC Allocator crew-payments shows it
```

Design rules (these follow the CRM's existing rules):

- **The AI proposes; a person confirms.** A finding moves nothing (no punch item, no
  contractor message, no payment effect) until a person confirms it. This is the same
  rule as permit corrections and the document assistant.
- **One AI service:** `src/lib/inspector/` (pure `plan.ts` / `schema.ts` / `boxes.ts`
  with tests; DB in `analyze.ts`, `service.ts`). Screens call routes, never the model.
  A provider abstraction beyond `runAiCall` is **not** recommended: `runAiCall` is the
  seam, and adding a second provider later is a change in one file.
- **Insufficient evidence is never acceptance.** The schema's per-area verdict is
  `looks_complete | issues_found | cannot_tell`, and "cannot tell" asks for named
  extra photos.
- **Photos are evidence:** a stored photo is never changed; boxes are separate rows
  (in pixels of the stored photo) with who placed them.

## 6. Data model — Phase 1 (additive migration) [deliverable 6]

| Model | Key fields |
|---|---|
| `Inspection` | `number` INS-nnnnn (sequence), `kind` (enum below), `status` DRAFT / ANALYZING / REVIEW / CORRECTIONS / ACCEPTED / CLOSED, `jobId?`, `laborContractId?`, `crewId?`, `vendorId?`, `addressText?`, `scopeText?`, `qualityProfile` (string key, default `rental` / `retail` by job kind), `startedByUserId`, `acceptedByUserId?`, `acceptedAt?`, `closedAt?`, timestamps |
| `InspectionArea` | `inspectionId`, `jobAreaId?`, `name`, `trade?`, `sortOrder`, `verdict?` (looks_complete / issues_found / cannot_tell), `reviewedAt?` |
| `InspectionPhoto` | `inspectionId`, `areaId?`, `fileId` (the `File`), `role` ORIGINAL / CORRECTION / BEFORE, `findingId?` (for a correction photo), `width`, `height`, `quality` (ok / blurry / dark / too_far / null), `analysisId?` |
| `InspectionAnalysis` | `inspectionId`, `areaId?`, `photoIds` Json, `kind` AREA / COMPARE, `status` QUEUED / RUNNING / DONE / FAILED, `attempts`, `claimedAt?`, `aiCallId?`, `model`, `durationMs?`, `error?` |
| `InspectionFinding` | `inspectionId`, `areaId?`, `photoId?`, `relatedPhotoIds` Json, `source` AI / PERSON, `kind` OBSERVED / SUSPECTED / DOCUMENTATION / SCOPE / PHYSICAL_CHECK / CANNOT_DETERMINE, `trade`, `defectKey?`, `title`, `evidence`, `severity` CRITICAL / MAJOR / MINOR / COSMETIC, `confidence` (0–1, AI only), `recommendedAction`, `extraPhotoRequest?`, `boxes` Json `[{x1,y1,x2,y2,n}]` in stored-photo pixels (empty = unlocalized), `review` PROPOSED / CONFIRMED / EDITED / DISMISSED, `dismissReason?` (false positive / not this contractor / out of scope / duplicate / other), `reviewedByUserId?`, `duplicateOfId?`, `aiOriginal` Json (frozen), `fieldIssueId?` |
| `FieldIssue` | + `inspectionFindingId?` (unique) |
| `File` | + `inspectionId?` (so the Files tab and gallery show inspection photos) |

`kind` enum: TRADE, INTERIOR, EXTERIOR, TURNOVER, MAINTENANCE, COMPLETION, PROGRESS,
PRE_CONCEALMENT, WARRANTY, QUICK (brief §4). Phase 1 treats them all the same: the
kind only changes the prompt's emphasis and the defaults.

Later phases add: `DefectDefinition` (library), `QualityProfile` (rows replacing the
string key), `InspectionScopeItem` (scope verification), `InspectionTest` (functional
checks: smoke alarm, water, HVAC — a person ticks), `InspectionApproval` /
payment-override audit, and `ContractorQualityEvent` (scorecard facts). All tables
are additive; the rollback is to leave the tables unused (feature flag off).

## 7. API — Phase 1 [deliverable 7]

All routes are guarded with explicit role lists. Writes are `withIdempotency` (phone
outbox).

| Route | Does |
|---|---|
| `POST /api/quality-inspections` | create (phone-made id; job / contract / address optional) |
| `GET /api/quality-inspections?jobId=&status=&mine=` | list |
| `GET /api/quality-inspections/[id]` | inspection + areas + photos + findings + pending analyses (the phone polls this every 3 s while something is pending) |
| `PATCH /api/quality-inspections/[id]` | attach job / contract / crew, scope text, profile, status (accept / close) |
| `POST /api/quality-inspections/[id]/areas` · `PATCH …/areas/[areaId]` | rooms, trade, verdict |
| `POST /api/files` (+ `inspectionId`, `inspectionAreaId`, `role`) | photo upload, then queues the area's analysis (debounced: waits 8 s for more photos in the same area) |
| `POST /api/quality-inspections/[id]/analyze` | re-run an area, or "take a closer look" (Opus 5.5) |
| `POST /api/quality-findings` | a person adds a finding |
| `PATCH /api/quality-findings/[id]` | confirm / edit / dismiss / severity / boxes |
| `POST /api/quality-findings/punch` | confirmed findings → `FieldIssue PUNCH` + task (one per finding; duplicates refused) |
| `GET /api/quality-inspections/[id]/report.pdf` | Phase 1b: the report (react-pdf, like the change-order form) |
| `POST /api/cron/inspection-analysis` | claim stale / queued analyses (every minute, `CRON_SECRET`) |

Phase 2: `POST /api/quality-inspections/[id]/correction-link` (guest link purpose
`CORRECTIONS` + optional SMS), `/api/g/[token]` handles the new purpose, and
`POST /api/quality-findings/[id]/recheck` (compare call).

## 8. Screens [deliverables 8–9]

**Phone (KNU Field), Phase 1:**

1. **Today → "Inspect"** (and Quick add → Inspect). One tap opens a new inspection
   prefilled with the job you are on, or no job.
2. **Set-up sheet:** kind, contractor (from the job's labor contracts), quality
   profile, scope (pulled from the contract lines; editable). Everything is optional
   except the kind.
3. **Walk:** a list of areas (from `JobArea`; add a room by name). On an area: camera
   with "keep shooting", a strip of photos each showing uploading / analysing / done,
   and a count of findings.
4. **Area results:** findings ordered by severity. Each opens the photo with numbered
   boxes, the evidence, the action, Confirm / Edit / Dismiss, Draw a box, and
   "Retake" or "Take this extra photo" when the AI asked for one.
5. **Summary:** areas done / left, confirmed / proposed / dismissed, "Create punch
   items", "Accept the work" (refused while a CRITICAL finding or a "cannot tell" area
   is open, unless an ADMIN / MANAGER gives a reason).
6. **Inspection history** on the job card.

**Web, Phase 1:** `/field-inspections` (list with filters), `/field-inspections/[id]`
(full-size photos with the overlay, side by side, findings table, review), an
Inspections section on the job page (Field group), a dashboard attention row
"Inspections to review".

## 9. Workflows [deliverables 10–12]

**Field inspection (Phase 1).** The steps are numbered as in brief §5.

1. Start
2. Pick an area
3. Shoot
4. Each area's analysis runs while you keep shooting
5. Findings appear
6. Review
7. Create punch items (the contractor is told in person, or by the existing task /
   PM)
8. Accept or leave in CORRECTIONS

**Contractor correction (Phase 2).**

1. Confirmed findings are sent as a link (SMS from the CRM, or copy), showing only
   that contractor's confirmed findings with the boxed photo and the action.
2. The contractor can do any of:
   - acknowledge;
   - comment or dispute;
   - upload a correction photo per finding, then "ready for re-check".
3. Each correction photo gets a **compare call**: the original crop and box, the
   finding, and the new photo. The answer is `appears_fixed | not_fixed | cannot_tell`.
   It never reruns the whole inspection.
4. A person accepts, which closes the punch item, or sends it back.
5. Same-visit is measured from the times: finding confirmed → correction accepted,
   on the same day and before the inspector left (the inspection is still open).
6. The link stays open across rounds until the inspection is accepted or the link
   expires (48 hours, renewable).

**Payment (Phase 4).**

1. The payment request card shows the lines it covers. For each line it shows the
   inspection state (the line's `inspectionStatus`, set PASSED when an accepted
   inspection covers it, FAILED while confirmed findings are open) and any open
   punch items.
2. A recommendation is drawn from those states (brief §17's list).
3. **Nothing blocks a payment**: the recommendation is advice. An ADMIN / MANAGER
   "pay anyway" records a reason (audit).
4. The CC Allocator crew-payments endpoint gains the same state, so the bookkeeper
   sees "inspection passed" next to the bank line without asking.

## 10. Buildium and CC Allocator [deliverables 13–14]

- **Buildium.** The CRM does not talk to Buildium and should not start. CareyOS Work
  already owns the Buildium connector, sends maintenance work to KNU as CRM tasks
  ("Send to KNU") and copies KNU photos back onto the Buildium item. Turnover
  inspections (Phase 3) use that path:
  - an inspection can be started from a task that came from Work;
  - when it is accepted, Work receives its summary + photos through the existing
    task-status / files read-back;
  - Work decides what goes to Buildium (completion stays the Buildium assignee's or
    an Equifirst manager's, per the 2026-11-10 ruling).
  - Idempotency comes free: the Work task key is unique per item.
- **CC Allocator.** No change to who posts money. Phase 4 adds the inspection and
  payment-request state to `GET /api/integrations/cc-allocator/crew-payments`, so CC
  Allocator's crew-payment drawer can show it. That needs one small CC Allocator
  change (display only).

## 11. AI model strategy, schemas, prompts [deliverables 15–17]

- **Default:** Claude Sonnet 5.5 for area analysis and compare calls; it is half
  Opus's price and faster. **Escalation:** Claude Opus 5.5 on "Take a closer look",
  or automatically when an area returns a CRITICAL finding below 0.6 confidence.
  **Triage:** Claude Haiku 5.5 is a candidate for a cheap blur / darkness check, but
  only if measured worth it (the main call already reports photo quality). Model
  choice is a setting; the eval decides (§16).
- **Batching:** one call per area, ≤ 6 photos, each labelled `Photo 1:` …, images
  before the text. The system prompt (stable, cached) holds the rules, the trade's
  "what to look for" list and the quality profile. The user content holds the kind,
  area, trade, scope lines and the photos. Scope text is framed with
  `untrustedDocument`, and text inside photos is treated as data.
- **Prompt rules:**
  - report only what is visible, and say which photo and where;
  - "suspected" when unsure;
  - never treat a missing view as fine — ask for the photo;
  - never cite a code section, manufacturer figure or tolerance;
  - never describe people or read personal documents;
  - name a physical test where photos cannot tell (water, power, function,
    concealed work);
  - boxes in pixels of the image as sent.
- **Schema** (flat, for the grammar limit):
  - `area`: { `verdict`, `summary`, `photosNeeded[]` (string) };
  - `photos[]`: { `n`, `quality` };
  - `findings[]`: { `photo`, `alsoIn[]`, `title`, `evidence`, `kind`, `severity`,
    `confidence`, `trade`, `action`, `physicalCheck`, `box` [x1,y1,x2,y2] or [] }.
  Validated with zod by `runAiCall`, then boxes are clamped and rescaled
  (`boxes.ts`, the documented resize rule, tested). Duplicate findings across photos
  are merged by the model (`alsoIn`) and again in code by trade + title + overlapping
  photos.
- **Compare schema:** { `verdict`, `evidence`, `confidence`, `box` }.

## 12. Security and permissions [deliverable 18]

| Action | ADMIN / MANAGER | OFFICE_STAFF | Job's PM | SALES_REP | CREW_LEAD | CREW_MEMBER | READ_ONLY | Contractor (link) |
|---|---|---|---|---|---|---|---|---|
| Start inspection, upload photos | ✓ | ✓ | ✓ | own jobs | on the job | on the job | — | — |
| See AI findings (proposed) | ✓ | ✓ | ✓ | own jobs | — | — | ✓ | — |
| Confirm / dismiss / edit findings | ✓ | ✓ | ✓ | — | — | — | — | — |
| Create punch items | ✓ | ✓ | ✓ | — | — | — | — | — |
| Send correction link (Ph 2) | ✓ | ✓ | ✓ | — | — | — | — | — |
| See confirmed findings assigned to them | ✓ | ✓ | ✓ | own jobs | on the job | on the job | ✓ | own only |
| Upload correction photo / dispute | ✓ | ✓ | ✓ | — | on the job | on the job | — | own only |
| Accept a correction / the inspection | ✓ | ✓ | ✓ | — | — | — | — | — |
| Accept despite open critical / "cannot tell" | ✓ | — | — | — | — | — | — | — |
| Payment override (Ph 4) | ✓ | — | — | — | — | — | — | — |
| Templates, profiles, library (later) | ✓ | — | — | — | — | — | — | — |
| Contractor scorecards (Ph 5) | ✓ | ✓ | — | — | — | — | ✓ | — |

Other measures:

- Photos are served only through `/api/files/[id]` with `fileReadWhere`.
- Inspection photos follow the crew-visibility rule; findings are never crew-visible
  until confirmed.
- The correction link holds a hashed token, is scoped to one inspection + one
  contractor, expires and can be revoked.
- Every open and submit on a link is logged; Phase 2 adds IP + user agent, which the
  current guest links lack.
- Uploads are rate-limited and checked by content (`sniff.ts`).
- The model receives no names, amounts or contact details: only trade, area, scope
  text and photos.

## 13. AI cost [deliverable 19, §26]

The image cost comes from the API's own formula: a 2,000 × 1,500 photo = 72 × 54 =
**3,888 visual tokens**, sent unresized on the current models. Per area call of 6
photos ≈ 23 k input + ~3 k cached system + ~1.5 k output.

| | Sonnet 5.5 | Opus 5.5 | Haiku 5.5 |
|---|---|---|---|
| Per photo (in a 6-photo call) | ≈ 1.1¢ | ≈ 2.2¢ | ≈ 0.05¢ |
| Compare call (2 photos) | ≈ 2¢ | ≈ 4¢ | — |
| $250 handyman, 8 photos | ≈ $0.09 | ≈ $0.18 | |
| Turnover, 60 photos + 10 re-checks | ≈ $0.85 | ≈ $1.70 | |
| Kitchen / bath renovation, 150 photos | ≈ $1.70 | ≈ $3.40 | |
| A busy month: 40 inspections, 2,000 photos | ≈ $25 | ≈ $50 | |

These are estimates; Phase 1 records the real cost and time of every call (`AiCall`)
and the per-inspection total. Controls:

- an inspector monthly cap, its own setting (proposed $50);
- the existing $5 per-subject cap (one inspection);
- the cache by input hash, so the same photos are never analysed twice;
- duplicate photos skipped by `sha256`;
- re-checks look at one finding, not the area;
- 2,000 px kept, so defect detail is not traded away for cost.

**Latency target** 10–30 s per area call. This is not promised: Phase 1 measures it
and the phone shows each photo's state.

## 14. Roadmap [deliverable 20, §30 — adapted]

| Phase | What | Size |
|---|---|---|
| **1 — Inspect + review** | schema, `lib/inspector`, analysis queue, AI area call, findings + boxes, review on phone + web, punch items from confirmed findings, history, cost ledger, flag `INSPECTOR_ENABLED`; a starter "what to look for" list for ~12 trades (Richard reviews) | 8–10 days |
| **1b — Report + eval** | PDF report; an eval set from KNU's own photos with Richard's / a PM's verdicts; precision / recall per trade; choose Sonnet vs Opus default | 3 days + review time |
| **2 — Corrections** | guest purpose `CORRECTIONS` (multi-round), Twilio send, contractor page (EN / ES), compare call, same-visit timing, accept → punch closed, Accept → contract lines' `inspectionStatus` | 6–8 days |
| **3 — Walkthroughs, turnovers, scope** | guided room list, quality profiles as rows, scope items from contract lines / estimate lines / Work task text, rent-ready checklist with person-ticked functional tests, before / after / move-out comparison, start from a Work task, summary back to Work | 8–10 days |
| **4 — Payment** | inspection state on payment requests + the labor panel, the recommendation, override with reason, CC Allocator display | 4–5 days (+1 in CC Allocator) |
| **5 — Intelligence** | defect library (≈200 drafted, reviewed by Richard / PMs, versioned), contractor scorecards with sample sizes, defect trends, knowledge references (reuse the permit library's full-text + `PermitKnowledge` lesson pattern), feedback → eval | 8–12 days |
| **6 — Evaluate** | live video frames, voice prompts, room recognition — study only | — |

## 15. Phase 1 — file-by-file [deliverable 21]

- `prisma/schema.prisma` + migration `2026113…_field_inspector` (additive; sequence
  hand-written)
- `src/lib/inspector/`:
  - pure, with tests: `kinds.ts`, `trades.ts` (starter look-for lists), `schema.ts`
    (zod), `prompt.ts`, `boxes.ts` (resize / rescale / clamp / overlap), `dedupe.ts`,
    `state.ts` (statuses, accept rules), `access.ts` (role lists);
  - DB: `service.ts` (create / attach / areas / accept), `analyze.ts` (claim, call,
    write findings, stale restart), `punch.ts` (findings → `FieldIssue` through the
    existing service)
- `src/lib/ai/policy.ts`: per-purpose monthly cap (inspector pool)
- `src/app/api/quality-inspections/**`, `src/app/api/quality-findings/**`,
  `src/app/api/cron/inspection-analysis/route.ts`; `src/app/api/files/route.ts`
  (+ `inspectionId` / `areaId` / `role`)
- `src/app/api/jobs/[id]/field-issues/route.ts` logic moved to a shared
  `createFieldIssue` so `punch.ts` and the route share one path
- `src/app/(app)/inspections/page.tsx`, `[id]/page.tsx`;
  `src/components/inspector/*` (photo with overlay, findings list, review controls);
  the job page's Field group; `lib/attention/rows.ts` + `load.ts` row
  `inspections-to-review`
- `mobile/src/app/(app)/inspect/*` (new, walk, area, finding, summary),
  `mobile/src/lib/inspector.ts`, outbox kinds `inspection.create`,
  `inspection.area`, `finding.review`; photo upload reuses `file.upload` with the
  new fields; the contract test in `src/lib/mobile-api`
- `crm-cron/inspection-analysis.sh` + crontab line (droplet, after the deploy)
- `docs/project-memory/features/field-inspector.md`, CLAUDE.md §3 / §9

## 16. Testing and evaluation [deliverable 22, §31]

- **Unit (pure):** box rescale against the documented resize rule, dedupe, accept
  rules (critical / cannot-tell block), state transitions, access lists, prompt
  framing.
- **API scripts** (the `scripts/qa` pattern), covering brief §31 scenarios 1, 2, 4,
  10, 11, 13, 14, 15, 16, 18, 19 and 20 in Phase 1; 5, 6, 7 and 12 in Phase 2;
  3 and 17 in Phase 3; 8 and 9 in Phase 4.
- **Phone:** outbox offline / retry tests; a TestFlight build walk-through on a real
  job.
- **Eval (Phase 1b, before anything touches contractors or money):**
  1. 100–200 of KNU's own photos across trades, each with a person's list of real
     defects.
  2. Measure precision, recall, false positives / negatives, box hit rate (IoU ≥ 0.3),
     severity agreement, cost, time and review minutes.
  3. Run Sonnet vs Opus on the same set.
  4. Kept in `scripts/eval/inspector/` with the photos outside git.

## 17. Risks [deliverable 23]

| Risk | Mitigation |
|---|---|
| Nobody uses it (no field reporting today) | Owner / PM first; three taps to start; useful with zero set-up (no job needed) |
| False positives embarrass the PM in front of a contractor | Nothing reaches a contractor unconfirmed; dismiss reasons feed the eval |
| False negatives read as "approved" | "Cannot tell" is a verdict; acceptance is a person's act, never the AI's |
| Boxes off target | Documented resize rule, tested; person can move a box; unlocalized findings allowed |
| Restarts kill analyses | Claimed rows + minute cron restart |
| Cost creep | Own cap, cache, dedupe, per-call ledger, re-checks scoped to one finding |
| Contractor link leaks | One inspection + one contractor, confirmed findings only, no money, expiry, revoke, logged |
| SMS compliance | Business texting to subs needs Twilio A2P 10DLC registration; until then the link is copied as today |
| Legal weight of an "AI approval" | Every report and screen states it is a visual workmanship review, not a code inspection, engineering opinion or permit inspection |

## 18. Decisions for Richard [deliverable 24]

**Ruled 2026-11-25: 1–10 as recommended ("go with your recommendations"); 11: the pilot is Richard on JOB-00022.**

Naming change while building: routes and tables are `quality-*` (`/api/quality-inspections`, `/field-inspections`), never `/api/inspections`, which is the permit inspection.

1. **Inspections without a job** — allowed (address only, attach later)?
   *Recommend yes.*
2. **Equifirst rentals** — turnover inspections start from a Work task (Buildium
   stays in Work), not a new CRM property record? *Recommend yes.*
3. **Default model** — Sonnet 5.5 with Opus 5.5 on request / escalation, final
   choice after the eval? *Recommend yes.*
4. **Photo size** — keep the 2,000 px copy (fits the model unchanged) and do not
   store full-size originals? *Recommend yes.*
5. **AI budget** — a separate inspector cap, $50 / month to start? *Recommend yes.*
6. **Who confirms findings** — office roles + the job's PM (crew leads raise and
   photograph but do not confirm)? *Recommend yes.*
7. **Accepting with an open critical finding or "cannot tell" area** — ADMIN /
   MANAGER only, with a reason? *Recommend yes.*
8. **Contractor texting (Phase 2)** — send from the CRM by Twilio (after A2P
   registration), or keep copy-and-send? *Recommend copy first, Twilio when
   registered.*
9. **Defect library** — AI-drafted, ~200 items, reviewed by you / a PM before it is
   used in prompts (Phase 5); Phase 1 uses short per-trade look-for lists you read
   first. *Recommend yes.*
10. **Multi-company** — not in the CRM; Equifirst stays in Work. *Recommend yes.*
11. **Pilot** — which jobs and who: e.g. you on JOB-00022 (the open flip) and the next
    two crew completions. *Your pick.*
