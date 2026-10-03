# Roofing estimator inside the CRM

Plan: "Roofing Estimator → Construction CRM Integration Plan"
(https://claude.ai/code/artifact/8b95fb53-2275-421e-a4ed-842fa7919005),
approved 2026-10-03. Decision: **native CRM module, engine as a pure library**.
roofing.careyos.com (`~/roofestimator`, `/var/www/roof-estimator`, pm2
`roof-estimator`, port 3109) keeps running untouched until its data is
imported, then is frozen and redirected.

## P0 — integration foundation

| Item | State |
| --- | --- |
| 0.1 Estimator under version control | Done 2026-10-03: `~/roofestimator` matched the server copy (75 files by checksum), `git init`, baseline `e0adbff`, local only, no remote. |
| 0.2 Parser + takeoff engine as a library | On prod (`79e4e19`). |
| 0.3 Measurements as structured data | On prod (`79e4e19`). |
| 0.5 Roofing estimate feeds the cost baseline | On prod (`79e4e19`). |
| 0.4 Rules and price book | On prod (`ac2a1d8`). `RoofSystem` deferred to P1 (nothing reads it yet). |
| 0.6 Import the estimator's data | Script built (Stage C), not deployed, not run on prod. |

## Stage A (built + dev-QA'd 2026-10-03 on `roofing-p0`)

**Library — `src/lib/roofing/`.** `parsing/` and `engine/` import nothing from
Prisma, Next or the rest of the CRM (plain objects in and out).
- `types.ts` (own `RoofType` union — SHINGLE / TILE / METAL), `round.ts`,
  `address.ts`.
- `parsing/roofr.ts` (`parseRoofrText`, `parseRoofrPdf`), `parsing/pdf.ts`
  (pdfjs-dist 4.10.38, the estimator's version; `serverExternalPackages` in
  `next.config.ts`), `parsing/waste-table.ts`.
- `engine/engine.ts` (`generateEstimate`), `engine/defaults.ts`
  (`DEFAULT_RULES`).
- Not ported: `estimate/rules.ts` (database rule resolution — rewritten in
  0.4, where the "inactive rule falls back to the code default" defect is
  fixed), calibration (`compare.ts`, P2).

**Roofr's recommended waste.** The estimator never captured it: the report
prints a row of options and the word "Recommended" above one of them, and
flattening the page to text loses which. `recommendedWasteFromItems` reads it
from glyph positions (the option whose centre is nearest the marker's). On 22
real reports the column varies (2nd on most; last — 24%, 35% — on small or
complex roofs; first — 0% — on an all-flat roof). It is stored beside the
measurement (`reportWastePct`, `reportWasteOptions`) and shown as a suggestion.
**It is never put into `suggestedWastePct` or applied by the engine**: Roofr
bases it on asphalt shingles and the takeoff coefficients were calibrated
without it. Whether to use it is a pricing decision for P1.

**Tests.** The estimator's 30 tests came across unchanged and pass. Added:
waste table (5), exact money (per roof type: line total = quantity × unit cost
to the cent, subtotal = sum of lines, whole units never fractional; a
30-square shingle roof pinned at $5,860; an unpriced material is a $0 line
with a warning), measurement rules (13). All 23 Roofr PDFs in
`~/roofestimator/estimates` parse inside the CRM at confidence 0.84–0.91; one
(2425 NE 22nd Ter) has no waste table.

**Measurements — `RoofMeasurement`** (migration
`20261018120000_roof_measurements`; also `FileCategory.MEASUREMENT_REPORT`).
Belongs to the lead and, when there is one, the job (explicit, or the lead's
only job). Columns for every takeoff field plus skylights / chimneys / stories;
`pitchBands`, `fieldConfidence`, `overrides`, `rawExtract`, `warnings` as JSON;
`reviewedAt` / `reviewedByUserId`. Floats (not money).
- `measurements.ts` (pure): `columnsFromParse` (unread = null, never 0),
  `valueProblem`, `applyEdits` (keeps the FIRST replaced value so the report's
  reading is never lost; restoring it clears the override), `reviewState`
  (missing squares / eaves / rakes always; low parse or field confidence until
  corrected or marked reviewed), `toEngineMeasurements`.
- `service.ts`: `createFromReport` (parse → store the PDF as a file on the
  lead/job → row; an unreadable report is still kept with an empty measurement),
  `createManual`, `updateMeasurement`, `deleteMeasurement` (the report file
  stays). Every write audited (`roof_measurement`).
- Routes: `GET|POST /api/leads/[id]/roof-measurements` (multipart PDF or JSON),
  `PATCH|DELETE /api/roof-measurements/[id]`. `guardLead` read / write; delete
  is office roles or the person who added it.
- UI: `components/roofing/roof-measurements-panel.tsx` on the lead's Roofr tab
  and the job's Money → Estimates tab.

**Cost baseline.** `signedEstimateCost` (`lib/jobs/cost-summary.ts`) reads the
cost behind a signed contract from either kind of estimate; `job-cost.ts` no
longer filters `estimateId: { not: null }`, so a job signed from a roofing
estimate gets an estimated cost without a typed budget.

**Dev QA.** API 25/25 with a real report (upload, values, bands, waste 6%,
file on the job under Measurement reports, corrections and override history,
four validation 400s, another lead's job 400, non-PDF 400, deletes; the file
survives). Headless Chromium on the lead page at 1280 and the job page at
400 px: upload, edit, refusal toast, "was 306.08 ft", by-hand entry flagged
"Missing: eaves, rakes", no sideways scroll, no console errors. Dev DB restored
from a dump. **Not exercised:** a SALES_REP session (the guard is `guardLead`,
tested in Foundation); PDF parsing under the production server (it runs from
`node_modules` at run time — check on prod after deploy).

**Deployed 2026-10-03 as `79e4e19`** (BUILD_ID `HfCtieXEwvKgJaManWLme`,
migration applied — 85, journal clean, backup
`postgres-2026-10-03-230418.dump`). A real report parsed on the droplet with
the deployed code via `tsx` (0.91, 31.6 sq, waste 6%, nothing written). The
parse inside the running server is proven by the first upload in the UI.

## Stage B (built + dev-QA'd 2026-10-03 on `roofing-price-book`)

Migration `20261019120000_roof_price_book`: `RoofRule`, `RoofMaterialItem`,
`RoofMaterialPrice`.

- **Rules are code; the table holds the company's changes.** `RoofRule` is one
  row per changed rule (`key`, `value`, `active`). `engine/resolve.ts`
  (pure): `ruleRows` (defaults with changes laid over, for the admin page),
  `resolveRules` (**a rule switched off is left out** — the estimator fell
  back to the code default, so a rule could not be switched off),
  `ruleValueProblem` (no zero coverage, waste is a fraction ≤ 0.50).
- **Price book.** `RoofMaterialItem` (category = what ties it to a rule, roof
  type or any, unit, optional vendor, `isPreferred`, never deleted — switched
  off). `RoofMaterialPrice` is append-only (`Decimal(12,4)`): the current
  price is the latest row effective today or earlier; the rest is the history.
  One table instead of the plan's price + history pair. **A price takes effect
  on a day** (stored at noon UTC, compared by date in the office zone); two
  prices for one day → the later entry wins. Found in QA: comparing instants
  made a same-day price from the date picker lose to the earlier one.
  `pricedCatalog` orders the catalog so the engine's first match is: this roof
  type → preferred → priced → name. No price in force = $0 line with a warning.
  Prices older than 90 days are marked.
- `price-book.ts` (service; `loadEngineInputs`, `previewTakeoff` — writes
  nothing), `access.ts` (`canManageRoofPricing` = ADMIN / MANAGER for every
  `/api/roofing/*` route, read and write, until "who sees cost" is ruled).
- Routes: `GET|POST /api/roofing/materials`, `PATCH …/[id]`,
  `POST …/[id]/prices`, `GET /api/roofing/rules`, `PUT|DELETE …/rules/[key]`,
  `GET /api/roofing/measurements`, `POST /api/roofing/takeoff-preview`.
- UI: `/admin/roofing` — Price book · Takeoff rules · Try a takeoff; sidebar
  entry under Admin → Finance.
- **Not built:** `RoofSystem` (a named system choosing materials per category
  belongs with the estimate builder, P1); a rules snapshot on an estimate
  (P1); editing a rule's label, kind or metric (code only).

Dev QA: API 26/26 on a real report (empty book → lines at $0 with warnings;
preferred item used; one preferred per category and roof; future price waits;
same-day price wins; switched-off item and switched-off rule both drop out;
changed rule moves the quantity; four 400s, two 404s; tile takeoff runs);
headless Chromium 10/10 at 1280 and 400 px, no console errors; QA rows
removed. Gate: typecheck clean, lint 5/22, 1517 tests (+15), build clean.
**Not exercised:** a non-admin session against the routes (the role function
is unit-tested). Deployed 2026-10-03 as `ac2a1d8` (BUILD_ID `Sm73Z7jwQy_iEWRSA7K2T`, migration applied — 86). The price book starts empty
on prod; Stage C imports the estimator's 40 materials (seed placeholders —
prices need checking).

## Stage C — the import (built + dev-QA'd 2026-10-03 on `roofing-import`)

`scripts/import-roof-estimator-2026-10.ts` — dry run by default, `--yes`
applies, idempotent. It reads the estimator's database through a read-only
session (`ROOF_SOURCE_DATABASE_URL`) and its PDFs (`ROOF_SOURCE_STORAGE_DIR`)
and never writes there. Planning is pure: `src/lib/roofing/import-plan.ts`.

- **Materials + prices** → price book, source `import`; a supplier is linked
  only when a vendor of the same name exists (else blank, and listed).
  Already here = same name, category and roof type.
- **Rules** → a `RoofRule` only where the estimator's number differs from the
  code or the rule is off; unknown keys are listed and ignored.
- **Roofr reports** → the PDF is parsed again by this app (so it gets pitch
  bands and Roofr's waste) and stored through `createFromReport` on the lead
  at the same address; values a person typed in the estimator are carried
  over as corrections; where the estimator's stored reading differs from the
  fresh parse, both are printed and this app's reading is kept.
- **Address match** (`matchProperty`): same street after normalising AND same
  5-digit zip (or, with a zip missing on either side, same city). Unmatched,
  two leads at one address, no PDF, or a missing PDF → HELD and listed.
- **Not imported:** roof jobs, material lists and supplier invoices (no home
  until the estimate builder / calibration, P1–P2). Counted in the output.

Dev QA against a throw-away estimator database built from the estimator's own
schema and seed (40 materials / 40 prices / 43 rules / 2 suppliers — the same
counts as prod, so prod's catalog is the seed) plus two test reports: dry run
wrote nothing; `--yes` created 40 + 40, saved 2 rule changes, imported 1
report with 2 typed corrections (the report's own reading kept as
`previous`), held 4; second run 0 / 0 / skip. Dev rows and the throw-away
database removed. Gate: typecheck clean, lint 5/22, 1525 tests (+8), build
clean. **Not exercised:** the real estimator database and its storage folder
(first done by the prod dry run), and whether `knuco` can read them.

## Still open (Richard)

Who sees cost and margin; labor basis; price source; when a budget is seeded
from an estimate; who reviews the flow; an ABC Supply API account.
