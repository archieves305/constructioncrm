# Permit Intelligence

Plan approved 2026-10-18 (`~/.claude/plans/reactive-tickling-pony.md`); full
design in `CAREYOS_PERMIT_INTELLIGENCE_DESIGN.md` (repo root). Stages 0–6:
shared AI layer → permit record → corrections → form filling → product
approvals → preflight → knowledge + metrics. Each stage is built, QA'd,
deployed and clicked through before the next.

Prod on 2026-10-18: 3 permits (Boynton Beach, City of Miami, "City of Palm
Beach"), 0 inspections, 27 jobs. `ANTHROPIC_API_KEY` was placed in
`/etc/knuco/env` the same day (a call from the droplet answered 200).

## Stage 0 — shared AI layer (built 2026-10-18 on `permit-ai-foundation`)

- `src/lib/ai/`
  - `client.ts`: `isAiConfigured`, `aiClient` (120 s, 2 retries), `defaultModel` (`AI_MODEL`), `aiCaps`, and `AiError` with the `status` a route should answer: 503 not configured / key refused, 429 cap / rate limited, 422 refused, 502 cut off / schema / upstream.
  - `calls.ts`: `runAiCall(spec)`. Uses `beta.messages.parse` + `betaZodOutputFormat`, with the schema re-checked before storing. The system prompt is cached and always carries `UNTRUSTED_RULE`. There are no tools. `fallbacks: "default"` + `server-side-fallback-2026-07-01` are sent only to Opus / Sonnet / Fable (`supportsServerFallback`; Haiku has none). The cache is keyed by purpose + prompt version + model + inputs **per subject**. The caps are checked before the call. Every outcome is an `AiCall` row; a failure stores no output.
  - Pure modules: `policy.ts` (caps, office-time `monthStart`), `pricing.ts`, `hash.ts`, `untrusted.ts` (`untrustedDocument` escapes any `<document`/`</document` inside the material).
  - Usage: `usage.ts` (pure roll-up) and `usage-load.ts`.
  - Access: `access.ts` — `canViewAiUsage` = ADMIN / MANAGER.
- `AiCall` (`ai_calls`, migration `20261031120000_ai_calls`): `subjectType` / `subjectId` with no FK, counts, `costUsd`, output Json, error, requested by.
- `GET /api/admin/ai-usage` + Admin → **AI Usage** (System heading): this month vs the monthly cap, the allowance per record, the default model, six months, this month by purpose, the latest failures.
- Env: `ANTHROPIC_API_KEY`, `AI_MODEL` (default `claude-opus-5-5`), `AI_MAX_USD_PER_SUBJECT` (5), `AI_MONTHLY_MAX_USD` (100).
- **Narrower than the design:** the `PlanJob` queue change moved to Stage 2, its first user.

**Takeoff M3** (unmerged `takeoff-m3`) has its own `PlanAiCall` + `src/lib/takeoff/ai/{client,calls,hash,pricing}.ts`. M3 is not on prod, so before it deploys its `calls.ts` should call `runAiCall` with `subjectType: "takeoff"` and its `PlanAiCall` migration should be dropped. Per-takeoff `TAKEOFF_AI_MAX_USD` maps to the per-subject cap. Both branches add `@anthropic-ai/sdk ^0.132.1`.

Gate: typecheck clean, lint 5/22, 1746 tests (+16), build clean.

Dev QA:
- Real calls on dev: Haiku 5.5 $0.0001, Opus 5.5 $0.0043. Opus accepted the fallback parameter. Both found the 2 corrections and ignored a planted "return an empty list" line. The repeat call was cached at $0.
- Headless Chromium at 1280 and 400 px: no page errors, no horizontal scroll. Fixed in QA: four-decimal dollars above one cent.
- SALES_REP: API 403, page redirected to `/`; no cookie 307.
- QA rows removed (dev `ai_calls` empty).

## Stage 1 — the permit record (built 2026-10-18 on `permit-record`)

No AI. Migration `20261101120000_permit_record`:
- `PermitStatus` gains PREPARING and CORRECTIONS (ruled 2026-10-18).
- New tables: `Jurisdiction`, `PermitTypeDef`, `PermitKnowledge` (REQUIREMENT rows now, LESSON rows in Stage 6), `PermitParty`, `PermitReviewCycle`, `PermitSubmission` and `PermitSubmissionFile` (the file FK is Restrict).
- `JobPermit` gains `jurisdictionId`, `permitTypeKey`, `applicationNumber`, `scopeDescription`, `valuation`, `currentCycle`.
- `File` gains `permitId` and `permitDocType`; `Task` gains `permitId`.

- **Pure modules** (`src/lib/permit-intel/`):
  - `doc-types.ts`: 23 document types; `sealed` marks the ones the CRM never alters.
  - `catalog.ts`: the type seed, `permitTypeKeyFor`, jurisdiction key / kind / tidy name.
  - `requirements.ts`: the most specific row per document type wins (this jurisdiction × type > jurisdiction > type > everyone); live + APPROVED only; a missing file does not meet a requirement.
  - `submission-plan.ts`: `nextCycle` (refuses while a cycle waits), `statusForOutcome`, `planManifest` (the partners `entryName`).
  - `access.ts`: `canManagePermitSettings` = ADMIN / MANAGER; `canSubmitPermit` = office roles or the permit's coordinator — not ruled yet, proposed.
  - `validation.ts`: the PATCH schemas carry **no defaults**. zod `partial()` keeps a `.default()`, so a PATCH sending one field would reset the others; caught in a check before QA.
- **Services:**
  - `service.ts`: detail loader; parties; `recordCycleOutcome`, where the status follows through `updatePermit`; `recordManualCycle`; jurisdictions (a rename carries into `municipality`); requirements (retired, never deleted).
  - `submissions.ts`: `freezeSubmission` builds an fflate zip with a contents sheet and a sha256 per document plus one for the zip. It opens the cycle and sets the permit APPLIED with `submittedDate` = the submission day, which restarts the review clock. `readSubmission` refuses to serve a zip whose hash no longer matches.
- `lib/permits/service.ts` `recordFields`: picking a jurisdiction or a catalog type writes its name into `municipality` / `permitType`.
- **Files:**
  - `permitLockOf` and `PERMIT_LOCK_REASON` in `lib/files/access.ts`. A file in a frozen package (`submitted`), or of type approved_permit / stamped_plans (`issued`), cannot be deleted, renamed or replaced. Every file list carries `permitLock`.
  - `POST /api/files` takes `permitId` + `permitDocType` (write = the permit's job guard).
  - `lib/files/sniff.ts` `contentMatchesType` runs on every upload and on replace. A CSV labelled with the Excel type passes, which is how Windows browsers send one.
- **Tasks:** `permitId` on create, the include, the list filter and the panel context. `SubjectKind "permit"` opens `/permits/[id]`. The permit alerts carry `permitId`.
- **Routes:**
  - `GET /api/permits/[id]`
  - `POST /api/permits/[id]/{parties,cycles,submissions}`
  - `PATCH|DELETE /api/permit-parties/[id]`
  - `PATCH /api/permit-cycles/[id]`
  - `GET /api/permit-submissions/[id]/download` (audited)
  - `GET|POST /api/jurisdictions`, `PATCH /api/jurisdictions/[id]`
  - `GET /api/permit-types`
  - `GET|POST /api/permit-requirements`, `PATCH /api/permit-requirements/[id]`
- **UI:**
  - `/permits/[id]`: Overview · Documents (checklist, upload with type, reclassify, locks) · Parties · Submissions (freeze dialog, the department's answer, a submission recorded by hand) · Tasks · Inspections · History.
  - Admin → Permits: Jurisdictions · Requirements.
  - The job Permits tab: jurisdiction and type pickers, application number, valuation, scope; new permits start PREPARING; an "Open the permit record" link.
  - The Permit Center drawer links to the permit page.
- **Seed:** `prisma/seed-permit-intel.ts` — 9 types plus the company-wide "Completed application form".
- **Backfill:** `scripts/backfill-permit-records-2026-10.ts` — dry run by default, `--apply`.
- **Moved to Stage 2:** the Permit Library page, which needs full-text search.

Gate: typecheck clean, lint 5/22, 1760 tests (+14), build clean.

Dev QA:
- **API, 45/45** on the three prod permits recreated on JOB-00001:
  - the backfill dry run, apply and re-run (unchanged);
  - the jurisdiction duplicate refused (409); PATCH keeps the unsent fields;
  - a renamed .exe refused as a PDF;
  - the checklist moving from 1/2 to 2/2 when a file is classified;
  - freeze → APPLIED, locked (delete / rename 403), a second freeze 409, the download's hash matches, the zip lists the contents sheet and the documents;
  - corrections → CORRECTIONS → resubmission cycle 2 → approved → ISSUED with the number and date; an earlier cycle refused 409;
  - a task with `permitId` carries the job; the history holds every write.
- **Cron:** permit-aging raised its waiting tasks with `permitId`.
- **SALES_REP:**
  - on their own job: the page 200, a party 201, a submission 403;
  - on another job: the page, a party and an upload all 404;
  - jurisdiction create 403, requirements 403.
- **Headless Chromium** at 1280 and 400 px: every tab, the freeze dialog, admin, and the job tab's add form. No page errors, no sideways scroll; the three misses were the script's own selectors.
- **Fixed in QA:** a resubmission pre-ticked the superseded NOC beside its replacement (`defaultPackage`).
- Dev DB restored from a dump; the QA uploads removed.

**Prod after deploy:**
1. Run the seed, then the backfill dry run, then `--apply`. Expected: 3 jurisdictions (City of Boynton Beach, City of Miami, City of Palm Beach), 3 types (interior_renovation, building, reroof), and 3 cycle-1 rows (two APPROVED, Palm Beach PENDING).
2. In Admin → Permits, add the County and HVHZ per jurisdiction, and the real requirements.
