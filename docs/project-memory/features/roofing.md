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
| 0.2 Parser + takeoff engine as a library | Built (Stage A). |
| 0.3 Measurements as structured data | Built (Stage A). |
| 0.5 Roofing estimate feeds the cost baseline | Built (Stage A). |
| 0.4 Roof systems, rules, price book | Next (Stage B). |
| 0.6 Import the estimator's data | After 0.4 (Stage C). |

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

## Still open (Richard)

Who sees cost and margin; labor basis; price source; when a budget is seeded
from an estimate; who reviews the flow; an ABC Supply API account.
