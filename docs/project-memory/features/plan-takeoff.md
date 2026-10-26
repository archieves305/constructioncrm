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
(log `takeoff-tick.log`, first run `{"jobs":0}`).

**Click-through fault, 2026-10-09 — "Failed to fetch" on the Plan takeoff
tab.** The nginx block was written as `location /api/plan-sets/ { … }`; a
prefix location ending in a slash makes nginx answer the slash-less
`/api/plan-sets?leadId=…` with a 301 to `/api/plan-sets/?leadId=…`, Next's
trailing-slash rule sends a 308 back, and the browser reports the loop as
"Failed to fetch". Nothing reached the app. Fixed on the droplet: `location ~
^/api/plan-sets/[^/]+/documents$ { … }` (a regex matches only the upload
route and carries no trailing-slash behaviour); `nginx -t`, reload, the origin
answers 307 again; the edge served the old 301 for a few more minutes for the
URLs already visited, then cleared. Lesson: never a slash-terminated prefix
`location` in front of a Next route; curl the slash-less path at the origin
and at the edge after any vhost change.

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

**Deployed 2026-10-09 as `c18e8f5`** (BUILD_ID `JyubG__VqAsj4BvpIQTie`, migration applied with the sequence and
the three CHECKs, smoke 307 ×2, journal clean, backup
`postgres-2026-10-09-042406.dump`). No operator items.

## M3 — AI-assisted roofing (built + dev-QA'd 2026-10-14 on `takeoff-m3`, not deployed)

Started 2026-10-09 (code written, one real dev run, nothing committed), finished
2026-10-14: committed, `main` merged in, migration renamed to sort after the
partner migrations, checked, dialog added, QA'd.

**Schema** (migration `20261028120000_plan_ai_calls` — renamed from
`20261022…`, which would have sorted before `20261023–27` already on prod; the
dev `_prisma_migrations` row was renamed by SQL): `PlanAiCall` (purpose,
prompt version, model that answered, input hash = cache key, token counts,
cost, structured output — never the prompt or reasoning; CHECK cost ≥ 0),
`PlanJob.takeoffId` for `ANALYZE_TAKEOFF` jobs.

**Library**: `ai/client.ts` (one client, 120 s, 2 retries; no key → 503),
`ai/calls.ts` `runAiCall` (cache by hash, per-takeoff cap `TAKEOFF_AI_MAX_USD`,
`client.beta.messages.parse` + `betaZodOutputFormat`, effort high,
**`fallbacks: "default"`** with `server-side-fallback-2026-07-01`, priced on
`res.model`; refusal / max_tokens / schema miss / API error each recorded as a
FAILED row), `ai/pricing.ts` (Opus 5.5 $4 / $20, cache read $0.20, write $5),
`ai/candidates.ts` (labels by regex, longest 1,500 segments as `s{i}`, 220 in
the prompt; image ≤ 2,000 px long edge — A-10 goes at 57 dpi), `ai/prompts.ts`
(`roof-specs-1`, `roof-regions-1`), `ai/schemas.ts`, `roofing/analyze.ts`
(pure: polygons px → pt, snapped; parapet = named segments merged face-to-face
then joined; drains = points at their labels; the model never returns a
number), `roofing/specs-run.ts` / `regions-run.ts`, `pipeline/analyze-plan.ts`
(specs step + one regions step per roof plan), `specs.ts` (`assemblyInForce`:
a person's choice over the plans' reading, both kept).

**Routes / UI**: `POST /api/takeoffs/[id]/analyze` `{ planSheetIds? }` (edit
role on the lead; 503 no key, 409 running, 400 sheet outside the set); the job
is ticked by the existing tick route and cron sweeper. Workspace: **Analyze
with AI** opens `AnalyzeDialog` (the takeoff's roof plans ticked, the rest of
the set behind "Show the other sheets", "read before" marks; a picked sheet
becomes a roof plan, `selectedBy: user`), progress pill, "AI $x" spend, toast
on finish; `SpecsCard` (assembly on the plans or "Assembly not specified",
deck / insulation / parapet / slopes / drainage, not-specified list, "Choose an
assembly" stored as the person's choice); AI rows are dashed proposals with
"AI proposal — measured by code from the lines the model named".

**Results on 3310 (dev)**: specs — assembly **null**, 7 items not specified,
"ROOF TILES" in a colours note correctly dismissed ($0.21). A-10 — 8 fields
2,848 SF, parapet 220 LF, 7 primary + 2 emergency drains + 2 scuppers, every
vertex snapped ($0.11, 30 s). Checked by overlaying the polygons on the 144 dpi
render: each field follows its drawn drain field; the gaps between fields are
walls between roof levels (32.75′ vs 41.17′ spot elevations), not missed roof;
the parapet encloses 61.9 × 52.4 ft = 3,246 SF (the dimension envelope), fields
sit ~7″ inside it. Every drain matches its tag. A-09 re-run through the new
beta + fallbacks path: same answer (408 SF, 2 scuppers), $0.07, 18 s. Whole
takeoff so far $0.51.

**Found and handled**: the set draws the main roof twice (A-10 whole; A-08 +
A-09 in parts) and all three were analysed → the dialog. **M5 must still
guard totals**: a material list that sums a metric across several roof plans
double-counts unless one sheet's rows are excluded — put it on the validation
checklist. Also fixed: dialog body overflowed at 400 px (grid child needed
`min-w-0`).

**Gate**: typecheck clean, lint 5/22, 1741 tests, build clean. Dev QA:
headless Chromium 8/8 at 1440 and 400 px (dialog, overlap note, read-before,
other sheets, run one sheet, progress, finished toast, no page errors); API:
foreign sheet 400, empty list 400, no body 400, `{}` 202, second start 409,
missing takeoff 404, SALES_REP off the lead 404 on analyze / read / tick; a
four-step all-cached job finishes in one tick with no new spend.
**Not exercised**: a refusal or a fallback actually firing, the cost cap
tripping, a scanned or uncalibrated roof plan through the run, the 503 with the
key unset (`isAiConfigured` only).

**Deploy needs**: `ANTHROPIC_API_KEY` in `/etc/knuco/env` (Richard's ruling —
without it the button is disabled and the route answers 503; manual tools
unaffected). Migration carried.

## 2026-10-19 — M3 moved onto the shared AI layer (on `main`, deploy carries a migration)

`main` (Permit Intelligence) merged into `takeoff-m3`; the M3 call layer was
retired in favour of `src/lib/ai`, as the permit design asked:
- `src/lib/takeoff/ai/{client,calls,hash,pricing}.ts` deleted; `specs-run.ts`
  and `regions-run.ts` call `runAiCall` with `subjectType: "takeoff"`,
  `subjectId` = the takeoff. Spend shows under Admin → AI Usage; the cap is
  the shared `AI_MAX_USD_PER_SUBJECT` (5) and the monthly one.
  `TAKEOFF_AI_MODEL` / `TAKEOFF_AI_MAX_USD` are gone.
- The drawings' text goes in through `untrustedDocument` (the specs lines and
  the regions call's text items); prompt versions `roof-specs-2` /
  `roof-regions-2`.
- `PlanAiCall` and migration `20261028120000_plan_ai_calls` dropped (never on
  prod). New migration `20261108120000_takeoff_analyze_jobs` carries only
  `plan_jobs.takeoff_id` + index + FK. Dev: the old table and its migration
  row removed, the new one resolved, diff clean (apart from the known
  `search_vector` default).
- "Read before" now comes from the takeoff's finished, not-skipped
  `regions.<sheetId>` steps; the call count and spend from `ai_calls`.

Gate: typecheck clean, lint 5/22, 1897 tests, build clean. Dev QA with real
calls: A-10 alone, specs $0.21 (assembly null, 7 not specified, 8 sheets) +
regions $0.13 (8 fields 2,807 SF, parapet 218 LF, 7 + 2 drains + 2 scuppers,
22 proposals) = $0.34, both rows `subject_type takeoff`; the same run again
made no call and spent nothing; foreign sheet 400; headless Chromium at 1440
and 400 px: "AI $0.34", dialog shows "read before" on the three roof plans,
no page errors, no horizontal scroll.

## 2026-10-09 — "Choose a PDF" did nothing (fixed on `main`)

The uploader cleared the input's value before `take()` read the live
`FileList`, so a file chosen through the picker was dropped on the floor; a
dragged file worked. Found on Richard's prod click-through, reproduced through
the real input in Chrome, fixed by snapshotting with `Array.from` before the
clear. Lesson: a file input's `files` is live — copy it before `value = ""`,
and QA the picker path (`setInputFiles`), not only drag-and-drop.

## 2026-10-26 — A roofing takeoff priced as an estimate (built + dev-QA'd on `takeoff-to-estimate`, deploy carries a migration)

Until now nothing read a takeoff's measurements; the roofing estimate started
only from a Roofr report. Now a roofing takeoff becomes an ordinary
`RoofMeasurement` (`source PLAN_TAKEOFF`, `takeoffId`), so "Add roofing section
from measurement" in the estimate builder prices it with the same engine, rules
and price book. Migration `20261111120000_roof_measurement_from_takeoff`
(enum value + nullable FK, SET NULL).

- Pure `roofing/to-measurement.ts`: counts only rows a person has looked at
  (REVIEWED / MODIFIED / APPROVED, or drawn by hand), on the ticked sheets;
  `parseSlope` reads the plans' slope text (`1/4" / 1'-0"`, `1 3/4" / 1'-0"`,
  `4/12`, `2%`); a plan's horizontal area grows by its pitch into a pitch band
  (low-slope never rounds into a steep band); an area with no slope takes the
  person's pitch; eave / rake / ridge / hip / valley → their LF fields, parapet
  + roof-to-wall → `flashingLf`, penetration + vent + curb → `penetrations`,
  skylight → `skylights`, cricket → area. Drains, scuppers, gutters and
  downspouts are listed as "not priced by a takeoff rule". Nothing measured =
  null.
- **Default sheets never double-count**: the sheet with the largest reviewed
  roof area plus the sheets with no roof area; ticking two roof-area sheets
  warns (3310: A-08 + A-09 vs A-10).
- `roofMeasurementFromTakeoff` (takeoff-service) + `createFromPlans` (roofing
  service; a new row every time — a section may pin an earlier one).
  `POST /api/takeoffs/[id]/roof-measurement` (`?preview=1` writes nothing; edit
  role on the lead; non-roofing 400; no reviewed area 409). Audited on the
  takeoff and the measurement.
- UI: **Use for an estimate…** in the workspace header → dialog (sheets, the
  pitch, warnings, values, not priced, left out) → toast with "Open estimates";
  the Roofr tab shows "From plans · TK-nnnn" linking back.
- `reviewState` no longer asks for eaves / rakes on an all-low-slope roof
  (Roofr flat roofs too).

Dev QA on TK-0003 (3310): before review 409 and "No reviewed roof area"; A-10
approved → 2,807.56 SF at 0/12, 218.46 LF flashing, 7 + 2 drains and 2
scuppers listed; all three sheets → 5,929 SF with the overlap warning; foreign
sheet 400, pitch 99 400; created "Plans · TK-0003" (28.08 sq); the roof
section from it: low-slope labor 28.1 sq × $160 = $4,496, membrane materials
$0 (dev price book empty); headless Chromium 17/17 at 1440 / 400 px; SALES_REP
off the lead 404. Dev DB restored. Gate: typecheck clean, lint 5/22, 1943
tests, build clean.
