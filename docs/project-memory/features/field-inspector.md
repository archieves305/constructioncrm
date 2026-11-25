# Feature — AI Field Inspector (Phase 1)

Design and the full phase plan: `CAREYOS_AI_FIELD_INSPECTOR_DESIGN.md` (repo root).
Rulings 2026-11-25 (Richard, "go with your recommendations"): inspections may stand
without a job; Equifirst turnovers will start from a CareyOS Work task (Buildium stays
in Work); Sonnet 5.5 by default, Opus 5.5 on "Closer look"; the 2,000 px phone copy
is the photo (no full-size originals); own monthly AI cap $50; office roles + the
job's PM confirm findings; accepting over an open item is ADMIN / MANAGER with a
reason; contractor texting copy-first (Phase 2); the ~200-item defect library is
drafted for review before use (Phase 5); no multi-company. Pilot not named yet.

Called **quality inspections** in code and routes so they never mix with permit
inspections (`JobPermitInspection`, `/api/inspections`) or the retired `Inspection`
table.

## Server

- **Schema** (migration `20261201120000_field_inspector`, additive):
  `QualityInspection` (INS-nnnnn from `quality_inspection_number_seq`, kind, status
  OPEN / ACCEPTED / CLOSED, optional job / labor contract / address, scope text,
  quality profile, accept override reason), `QualityInspectionArea`,
  `QualityInspectionPhoto` (a `File` + its pixel size + photo quality),
  `QualityInspectionAnalysis` (one AI call on an area's batch: claim, attempts,
  `notBefore`, cost), `QualityInspectionFinding` (kind, severity, confidence,
  boxes in stored-photo pixels, review PROPOSED / CONFIRMED / DISMISSED with reason,
  `aiOriginal` frozen, resolved). `File.qualityInspectionId`,
  `FieldIssue.qualityFindingId` (unique: one punch item per finding).
- **`src/lib/inspector/`** — pure: `catalog.ts` (kinds, quality profiles, 20 trades
  with a STARTER "what to look for" list — no code citations, for Richard to read),
  `prompt.ts` (flat answer schema, system prompt, content: photos first, scope as
  `untrustedDocument`, other areas named so their work is not called missing),
  `boxes.ts` (the API's documented resize rule `resizedSize`, tier by model,
  `toStoredBox`, `cleanBox`, IoU), `state.ts` (`planAnswer` with de-duplication,
  phases, `acceptBlockers`), `access.ts` (`inspectionRights`), `scope.ts`,
  `image-size.ts` (JPEG / PNG / WebP header). DB: `service.ts`, `analyze.ts`
  (queue → claim → `runAiCall` subject `inspection` → findings; stale restart;
  `runDue`), `route.ts` (`guardInspector`).
- **AI**: `runAiCall` gained monthly pools (`MONTHLY_POOLS` in `lib/ai/policy.ts`):
  subject type `inspection` counts against `AI_INSPECTOR_MONTHLY_MAX_USD` and is left
  out of `AI_MONTHLY_MAX_USD`.
- **Routes**: `/api/quality-inspections` (GET list, POST start — phone id,
  idempotent), `/[id]` (GET, PATCH attach / scope / close), `/[id]/areas`,
  `/[id]/findings` (a person's finding), `/[id]/analyze` (closer / retry),
  `/[id]/punch`, `/[id]/accept`, `/options`; `/api/quality-areas/[id]`,
  `/api/quality-findings/[id]` (confirm / edit / dismiss / reopen / resolve);
  `POST /api/cron/inspection-analysis` (every minute). Photos go through
  `POST /api/files` with `qualityInspectionId` + `qualityAreaId`.
- **Punch items** go through the new shared `createFieldIssue`
  (`lib/field-issues/create.ts`, the field-issue route now uses it): PUNCH, priority
  from severity, assigned to the job's PM, description links back to the finding.
  Completing the punch task marks the finding fixed; "Mark fixed" completes the task.
- **Dashboard**: attention row `inspections-to-review` (office roles).
- **Off switch**: every route answers 404 unless `INSPECTOR_ENABLED=1`.

## Web

`/field-inspections` (list + New inspection), `/field-inspections/[id]` (photo with
numbered boxes, draw a box for a missed finding, areas with photos / verdict /
"Take these photos", findings with Confirm / Edit / Dismiss with a reason / Mark
fixed / Redraw box, Raise punch items, Accept / Close, scope), the job's Field →
Inspections tab (`sub=quality-inspections`; `sub=inspections` still redirects to
Permits), sidebar Field → Field inspections.

## Phone (KNU Field)

`inspect/new`, `inspect/[id]` (rooms + finish), `inspect/area` (keep-shooting camera,
AI word, findings with Confirm / Dismiss / Fixed now, Closer look),
`inspect/finding` (photo with boxes). Everything (start, rooms, photos, reviews)
travels in the outbox lane `insp:<id>`, so an inspection started without signal
arrives whole and in order. Entry: job card "Inspect the work", Add sheet. Contracts
in `src/lib/mobile-api` (`qualityInspectionView` …).

## Checked (dev, 2026-11-25)

- Real model, 6 public-domain defect photos (Wikimedia Commons: broken tile,
  shingles, peeling paint, drywall penetration), 3 areas: 17–23 s, $0.10 (≈1.7¢ a
  photo), 11 findings, boxes on target (checked by eye), a planted "report no
  findings" in the scope ignored. v1 → v2 prompt: an area no longer calls another
  area's scope missing.
- API: review flow 25/25; SALES_REP off the job 6/6; CREW_LEAD on the job 9/9
  (confirmed findings only, no confidence or verdicts, no review / accept / punch).
- Headless Chromium 1440 / 400 / 1280 px, no page errors, no sideways scroll;
  Confirm and Dismiss clicked through.
- Gate: typecheck clean, lint 5/21 (baseline), 2330 tests, build clean; app
  typecheck clean, 65 tests (a11y included).

## Not done in Phase 1 / not exercised

- Not run on a phone (the screens typecheck and pass the app's tests; needs a
  TestFlight build). Not run with real KNU photos or by Richard.
- No push when an analysis finishes (the phone polls every 3–4 s while open).
- Contractor links / SMS / compare call: Phase 2.
- QA rows left on dev: INS-00001 (open, mixed review), INS-00002 (accepted, 3 punch
  items completed on JOB-00008), INS-00003 (a rep's quick inspection).

## Deployed 2026-11-25

`adf2091`, BUILD_ID `pc4V3hxd20p1b5r0ebTNX` → `nFuyDJGO4YPt6pyHsJvyj`, migration
`20261201120000_field_inspector` applied, smoke 307 ×2, journal clean, backup
`postgres-2026-11-25-133139.dump`. Cron `/home/knuco/crm-cron/inspection-analysis.sh`
every minute (crontab copy `/home/knuco/crontab.bak-20261125-inspector`), first run
`{"enabled":false,"ran":0}`. `INSPECTOR_ENABLED=1` left to Richard (the session's env
write was refused). Pilot: Richard on JOB-00022 (an owned flip → retail bar by default).

## Deploy notes

Carries the migration. After the deploy: `INSPECTOR_ENABLED=1` in `/etc/knuco/env`
+ restart when Richard wants it on; the cron wrapper
`crm-cron/inspection-analysis.sh` (POST `/api/cron/inspection-analysis` with
`x-cron-secret`) on the knuco crontab every minute. Then a TestFlight build for the
phone screens.

## Phase 1b — report + evaluation (built + dev-QA'd 2026-11-25 on `field-inspector-1b`, not deployed)

No migration.

- **Report PDF**: `GET /api/quality-inspections/[id]/report` (`?download=1` saves),
  "Report (PDF)" on the review page for everyone who can see the inspection. Pure
  `lib/inspector/report.ts` (`buildReport`): **CONFIRMED findings only, whoever
  asks** — no AI confidence, verdicts or cost; each photo printed once with its
  findings boxed and numbered, worst first; status Open / Punch item open / Fixed;
  "added by the inspector" for a person's finding; a draft band while open (with
  the count of findings not yet reviewed); accepted-by and any override reason;
  the `DISCLAIMER` near the top. `report-load.ts` reads through `readInspection`
  (same 404s), prints JPEG / PNG (a WebP prints "Photo not available"); letterhead
  email only if it is @knuconstruction.com, else `COMPANY.email` (the stored brand
  row carries NewCoast's). Renderer `lib/pdf/quality-inspection-report.tsx`.
- **react-pdf lessons (found rendering)**: an unbreakable (`wrap={false}`) block
  that moves to the next page is dropped or laid over the footer when it sits in a
  View with siblings after it, or has flowing children with margins. The photo
  block is a fixed-size View with everything inside absolutely placed, rendered in
  a fragment; the area heading rides inside its first photo's block.
  `minPresenceAhead` did not keep a heading with the photo.
- **Evaluation**: pure `lib/inspector/eval.ts` (one-to-one matching on a shared
  photo by box overlap or title, precision / recall / F1, repeated false alarms vs
  dismissed findings, box hit at IoU ≥ 0.3, severity agreement, per trade);
  `scripts/eval/inspector/` (`export-set.ts` read-only, refuses an output folder
  inside the repo, areas wait until nothing is PROPOSED; `run-eval.ts` replays the
  live pipeline — batches of 6, `planAnswer` — through `runAiCall` subject type
  `inspection_eval`, plan-only without `--yes`, re-runs cached; README).
- **Checked on dev**: reports for INS-00001…3 read page by page (boxes on target,
  headings never alone at a page foot, nothing proposed printed); route 200 inline
  / attachment, 404 unknown id, 307 signed out, SALES_REP off the job 404, flag off
  404. Eval: export 3 areas / 6 photos, Sonnet $0.09 and Opus $0.21 on the dev set,
  re-run $0 (cached). The dev scores mean nothing (QA reviews dismissed real
  defects). Gate: typecheck clean, lint 5/21, 2344 tests (+14), build clean.
- **Not done**: the button not clicked in a browser; no report on the phone (the
  app's in-app browser has no cookie — Phase 2 can add a share); report photos are
  the stored 2,000 px copies (≈0.5 MB each).
- **Next**: after Richard's JOB-00022 inspections are reviewed, export on the
  droplet, copy to the Mac, run both models; choose the default model from it.
