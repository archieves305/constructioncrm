# AI plan takeoff → supplier RFQ (roofing + plumbing)

Plan approved 2026-10-08 (`~/.claude/plans/harmonic-churning-stearns.md`); full
design: `CAREYOS_PLAN_TAKEOFF_STAGE1_DESIGN.md` at the repo root. Shape: code
extracts and measures, Claude only labels by picking ids of things code drew, a
person approves every row, the RFQ is a File. Milestones M0 (PoCs) → M1 plan
sets + sheet index + viewer → M2 calibration + manual tools → M3 AI roofing →
M4 AI plumbing → M5 materials + review + validation → M6 RFQ exports.

Test set: `3310 NE 37 st/3310 NE 37th - Full Plan Set A+G+P (1).pdf` at the
repo root (untracked; 34 vector sheets, 35 × 23 in, 20 MB). macOS refused this
session every read of that file after the first hour (even Richard's `cp`
through the session shell); the copy came from Terminal.app. Keep a copy named
`planset.pdf` in the session scratchpad when working on it.

## M0 — proofs of concept (run 2026-10-08, nothing in the repo or database)

| # | Proof | Result |
|---|---|---|
| M0.1 | `@napi-rs/canvas` under the `knuco` service sandbox on the droplet (`systemd-run` with `NoNewPrivileges`, `ProtectSystem=full`, `ProtectHome`, `PrivateTmp`, the unit's env file) | Loads from `/opt/knuco/node_modules` (0.1.100, linux-x64-gnu binary already in the lockfile). 11 A4 pages at 144 dpi in 3.2 s, peak RSS 277 MB. No apt package needed; test files removed afterwards. |
| M0.2 | Geometry fidelity (segments drawn back over the render, CTM tracked through save/restore/transform and form XObjects, curves flattened) | A-10: 5,706 segments; P-02: 21,470. No form XObjects, no curves, one image (the logo) on these sheets — everything is plain paths, so the extraction is complete for this set. **Pipe runs are dash-dot fragments:** within 150 pt of one label, 2,386 segments, 869 under 1 pt, 752 of 1–3 pt, and the same wall segment repeated 10×. A chain merge (dedupe, sub-0.5 pt dots kept as bridges, collinear within 1.2 pt, gaps ≤ 9 pt) turns 21,470 segments into 5,990 chains in 24 ms and the 4" sanitary main into one 897 pt (49.9 ft) chain. |
| M0.3 pipes | Claude Opus 5.5 picks ids on 144 dpi tiles around 10 parsed `SAN.` labels on P-02 | With raw segments as candidates: wrong (1 of 40 picked, 0–20 LF, mostly LOW — the candidates did not cover the pipes, as the model itself said). With **chains** as candidates: the right heavy line in 10/10 tiles (two checked visually), 2.5–8.7 s and $0.01–0.02 per tile, $0.13 for ten. Chains run past the label's own run (a 3" label's chain also covers the 4" part), so **code must split chains at label boundaries and junctions** before measuring — deterministic M4 work. |
| M0.3 roof | Text-only spec call (A-10, A-08, A-13, A-15 lines with ids) + image call on A-10 with 220 segment ids and the label ids | Specs: assembly = cementitious waterproofing (quoted from A-15) with ten items listed as not specified (product/NOA, thickness, layer order, insulation type, cover board, parapet flashing/coping, drain sizes, uplift, terminations) — the honest answer. Regions: 8 fields, **every vertex snapped** (36/36), all 16 parapet ids valid, drains 9 + 2 scuppers by text id, crickets 0, material not named on A-10; 31 s. Code measured 2,867 SF (−7 % against ~3,090 SF inside the parapets — the gaps are the beam strips between fields) and 391 LF of parapet. Earlier image-only call for comparison: 2,942 SF with unsnapped vertices, $0.12. **Total roof area should come from the parapet outline (code); regions are for slope and drain attribution.** |
| M0.4 | Tick timing: text + geometry + 72 dpi render for all 34 pages, 144 dpi for the 12 trade sheets | 35 s total, 1.0 s per page average (max 3.3 s), so ≥ 39 pages per 40 s tick. Heap peaks at 115 MB on the heaviest page (94k segments) and the whole loop completes under a 512 MB heap cap, **but RSS climbs to 2.3 GB across pages** even with forced GC and the document reopened per page (allocator retention). Decision: extraction and rendering run in a short-lived child process per tick (`child_process.fork`, exits when the budget is spent) so the Next process never carries it. |

Pictures: `plan-takeoff/m0-roof-regions-ids.png` (dashed = regions from ids,
black = parapet ids, circles = drains) and `plan-takeoff/m0-pipe-tile-chain.png`.

**M0 verdict:** the id-picking design is confirmed for both trades. Two
deterministic additions go into the design: chain merging + splitting at labels
and junctions (`geometry/segments.ts`), and total roof area from the parapet
outline with regions used for attribution (`roofing/metrics.ts`). One execution
change: the pipeline step runs in a forked child process.

## M1 — plan sets, sheet index, viewer (built + dev-QA'd 2026-10-08 on `takeoff-m1`)

**Schema** (migration `20261020120000_plan_sets`, 5 tables, no data change):
`PlanSet` (lead, job?, name) → `PlanDocument` (the PDF as a `File` of category
`PLAN_SET`, kind FULL_SET / PARTIAL / ADDENDUM / REVISION, label, revision,
sha256, page count, status UPLOADED / INDEXING / INDEXED / FAILED) →
`PlanSheet` per page (size, the index in force — number, title, discipline,
scale text, revision — beside `detected` JSON and a confidence, `isRaster`,
text / geometry / render storage keys, `scaleSource` NONE / AUTO /
AUTO_VERIFIED / MANUAL with `ptPerFt`, `supersededBySheetId`). `PlanJob` +
`PlanJobStep` (sequence, step key, dependsOn, attempts, lock) drive the work.

**Extraction** runs in `src/lib/takeoff/pdf/extract-worker.mjs`, a plain JS
file forked by path (`worker-client.ts`, `execFile`, 120 s timeout) so pdf.js
and the canvas never live in the Next process: positioned text, raw drawn
segments (transform tracked through forms, curves flattened), 72 dpi PNG;
144 dpi is rendered on first request (`sheet-cache.ts`). Artefacts live under
`UPLOADS_DIR/plans/<documentId>/`.

**Index** is pure TS under `sheets/`: `sheet-list.ts` (the cover sheet's
table, rows matched on the baseline), `title-block.ts` (right strip / bottom
band; number under "SHEET NO.", title after "SHEET:"), `discipline.ts` (prefix
map, title keywords settle G), `scale.ts` (`1/4" = 1'-0"` → 18 pt/ft, `1" =
20'`, `1:100`, NTS), `classify.ts` (title block checked against the list).
Tested on text fixtures captured from the real set
(`src/lib/takeoff/__fixtures__/*.text.json`).

**Pipeline** (`pipeline/plan.ts` pure, `runner.ts`, `handlers.ts`): steps
`inventory` → `page.N` → `classify` → `scale`; a tick claims one runnable
step with `FOR UPDATE SKIP LOCKED`, runs it inside a 40 s budget, retries a
failure up to 3 times, reclaims locks older than 3 min, caps running steps at
2 across the app. The browser polls `POST /api/takeoff-jobs/[id]/tick` every
1.5 s while the job is live; `POST /api/cron/takeoff-tick` sweeps abandoned
jobs (one per call). A step's output is idempotent (upserts, `skipDuplicates`).

**Routes** (`route-guards.ts`: lead guard + `access.ts` role lists — edit =
ADMIN / MANAGER / OFFICE_STAFF / SALES_REP on own leads, delete = ADMIN /
MANAGER): `GET|POST /api/plan-sets`, `GET|PATCH|DELETE /api/plan-sets/[id]`,
`POST …/documents` (multipart, 95 MB, sha256 dedupe → 409, `%PDF-` check),
`GET …/sheets`, `GET|PATCH /api/plan-sheets/[id]`, `GET …/render?dpi=72|144`,
`GET …/text`, `GET …/geometry`, `GET /api/takeoff-jobs/[id]` + `tick` /
`retry` / `cancel`, `POST /api/cron/takeoff-tick`.

**UI**: `PlanTakeoffPanel` on the lead's **Plan takeoff** tab and the job's
Money → Plan takeoff (plan sets, documents with live progress, drag-drop
uploader with an XHR progress bar, `SheetIndexTable` with inline number /
title / scale edits and a discipline select, delete for ADMIN / MANAGER);
`/plans/[planSetId]?sheet=` (rail · `PlanViewer` · details). `PlanViewer`
= server PNG under a CSS transform (`use-pan-zoom.ts`: pointer events, pinch,
non-passive wheel zoom about the cursor, double-click, `F` `+` `-`), 72 dpi
first and 144 dpi faded in past 1.1× device pixels, an SVG overlay in sheet
points ready for M2. Phone: single column, read-only viewer.

**Config**: `experimental.proxyClientMaxBodySize: "100mb"` in `next.config.ts`
(the SSO middleware buffers bodies at 10 MB by default — found in QA);
`@napi-rs/canvas` 0.1.100 declared and server-external.

**Dev QA**: API 35/35 (upload 0.8 s; the 34-sheet set indexed in 2 ticks /
44 s; every sheet numbered and titled, scales as printed, 0 raster; 72 / 144
renders 390 / 853 KB, 144 lazy in 0.9 s then cached; text 195 items, geometry
5,706 segments on A-10; corrections and detected-vs-corrected; NTS → NONE;
supersedes inside the set only; duplicate PDF 409; not-a-PDF 400; cron 403 /
200). Headless Chromium 19/19 at 1280 and 400 px: hub with 34 rows and
thumbnails, inline title edit, viewer 72 → 144 on zoom, rail click changes
`?sheet=`, details follow, phone single column with no sideways scroll, zero
console errors. SALES_REP: QA lead 404 on list / set / render, delete 403.
QA sets deleted through the API (derived folder and PDF removed). Fixed in
QA: the middleware body cap; a refit loop when the sheet size object was
rebuilt each render; React's passive `onWheel` (native listener now).
**Not exercised**: a scanned set (`isRaster` path), a set over 25 MB on prod
(nginx), the cron sweeper on a live job, a SALES_REP creating a set on a
lead of their own (no dev lead is assigned to the rep).

**Deployed 2026-10-08 as `d2fa4d0`** (BUILD_ID `jZogc4PvvnFSYj7gxiyS0`,
migration applied, smoke 307 ×2, journal clean, backup
`postgres-2026-10-09-034839.dump`). Operator items done: nginx `location
/api/plan-sets/ { client_max_body_size 100M; proxy_read_timeout 120s; }` on
the CRM vhost (backup `/root/crm.careyos.com.bak-20261008-takeoff`),
`/home/knuco/crm-cron/takeoff-tick.sh` on the `knuco` crontab every minute
(log `takeoff-tick.log`, first run `{"jobs":0}`). Prod has no plan sets yet;
Richard's click-through is the first real upload (the 20 MB set exercises the
nginx block and the worker under the service for the first time).

## M2 — calibration + manual tools (built + dev-QA'd 2026-10-09 on `takeoff-m2`)

**Schema** (migration `20261021120000_takeoffs_measurements`): `Takeoff`
(number `TK-nnnn` from a Postgres sequence, lead, job?, plan set, one trade,
status, `pinnedDocumentIds` → `stale`), `TakeoffSheet` (which sheets, with a
role, proposed by `sheets/relevance.ts` and replaceable), `TakeoffMeasurement`
(sheet, kind AREA / LENGTH / COUNT, `metricKey` from `metrics.ts`, label,
attributes, geometry in sheet points, the `ptPerFt` it was measured with,
`valueRaw` + unit, `previousValue`, origin, confidence, `TakeoffReviewStatus`
— the plain name is taken by customer reviews — evidence, reviewed by / at).
CHECKs: value ≥ 0, unit in LF / SF / EA, a length or area carries its scale.

**Pure geometry** (`geometry/*`, tested on fixtures from the real set):
`dimensions.ts` (`16'-8 11/16"` ↔ feet, dimension strings on a page),
`segments.ts` (`buildChains`: dedupe, dots as bridges, collinear within 1.2 pt,
gaps ≤ 9 pt — the 4" sanitary main becomes one chain), `calibrate.ts`
(`matchDimensionLines` against raw long segments preferring the longest line
under the text; `verifyScale`: median of the matched ratios, 5 % outlier
filter twice, VERIFIED when ≥ 3 matches scatter ≤ 6 % and the median is within
3 % of the printed scale, DISAGREES beyond that, PRINTED_ONLY with nothing to
check; `manualCalibration`), `measure.ts` (shoelace, lengths, snapping with
endpoint-before-segment priority, confidence from the snapped share),
`snap.ts` (grid index, agrees with brute force on 200 probes),
`measurement-value.ts` (the one place a number comes from, client and server).
On A-10: 40 of 45 dimension strings matched, median 1.5 % over the printed
18 pt/ft, spread 4.5 % → VERIFIED.

**Service + routes**: `takeoff-service.ts` (create with proposed sheets,
measurements with the value computed from the sheet's calibration — a length
or area on an uncalibrated sheet is refused, counts always work; geometry
edits recompute and keep the first replaced value, an AI row edited becomes
MODIFIED; recompute as an explicit action; calibrate auto / confirm / manual /
clear, measurements untouched until Recompute; delete). Routes: `GET|POST
/api/takeoffs`, `GET|PATCH|DELETE /api/takeoffs/[id]`, `PUT …/sheets`,
`GET|POST …/measurements`, `POST …/measurements/recompute`, `PATCH|DELETE
/api/takeoff-measurements/[id]` (approving needs an office role), `POST
/api/plan-sheets/[id]/calibrate`, `GET /api/plan-sheets/[id]/segments`
(chains for snapping). A plan set with takeoffs refuses deletion (409).

**UI**: trade cards on the hub (start / open a takeoff per trade);
`/takeoff/[takeoffId]` workspace — rail of the takeoff's sheets (or all),
`PlanViewer` with the SVG overlay (`shapes.tsx`: dashed proposals, solid
reviewed, labels that keep their size, vertex handles), `DrawToolbar` (V A L
C K, snap S), `use-drawing.ts` (taps add snapped vertices, Enter / double-click
finish, Backspace, Esc, live readout), `LabelPopover` (type by trade, pipe
size, label), `CalibrateDialog` (auto with the verification shown; manual
from two clicks + a typed distance), the calibration block (Auto calibrate /
Confirm printed scale / Calibrate by hand / Recompute when the scale moved),
`MeasurementList` grouped by type with totals, `MeasurementInspector`
(type, label, approve / mark reviewed / exclude / needs clarification / delete,
"was …"). Phone: viewer + list, no drawing.

**Dev QA**: API 37/37 (sheet proposals per trade; refusal on an uncalibrated
sheet; 20 × 10 ft = 200 SF, 30 + 10 ft = 40 LF at 18 pt/ft; auto calibrate
VERIFIED at 18 with 35 matches; geometry edit → previous value kept; manual
calibration 36 pt/ft leaves values until Recompute, which changes 2 of 2;
clarification note; type change only within the kind; chains for P-02 3,740
of 5,988; takeoff counts by status; plan set with takeoffs 409). Headless
Chromium 22/22 at 1280 and 400 px: trade cards, draw a run with the live
readout and label it, a count, inspector exclude / include, auto calibrate
with the verification text, manual calibrate dialog, Recompute changes the
value, rail with all 34 sheets, phone read-only, zero console errors. Fixed in
QA: the gas sheet proposed as "schedule"; parent setState from inside a view
updater (render-phase update); the inspector's label stuck to the first
selection. QA data deleted through the API.
**Not exercised**: vertex dragging in the browser (unit-level only), a scanned
sheet, SALES_REP on these routes (same guard as M1).

**Deploy carries a migration** (sequence + three CHECKs hand-written). No
operator items.

## Next: M3 — AI-assisted roofing

`@anthropic-ai/sdk`, `ANTHROPIC_API_KEY` / `TAKEOFF_AI_MODEL` /
`TAKEOFF_AI_MAX_USD` in env, `PlanAiCall` (migration), `ai/*` (specs from
text with line ids; roof regions from the 144 dpi render with candidate loops
and label ids), the analyze job steps, AI rows as dashed proposals.
