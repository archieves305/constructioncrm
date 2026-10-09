# CareyOS Construction CRM — AI Plan Takeoff, Stage 1 Design

**Roofing + Plumbing takeoff → reviewed material list → supplier RFQ**

Prepared 2026-10-08 in plan mode. Plan approved the same day
(`~/.claude/plans/harmonic-churning-stearns.md`). Nothing in this document is
built yet; the proofs of concept it cites ran from a session scratchpad and
touched neither the repo nor the database.

---

## 0. Summary and what the proofs of concept showed

The objective is a structured takeoff system inside the existing estimator,
not a PDF chat. The simplest reliable shape is:

> **Code extracts and measures. Claude only labels, by picking ids of things
> code already extracted and drew. A person approves every row. The RFQ is a
> File.**

Three proofs of concept were run on the real test set, `3310 NE 37th — Full
Plan Set A+G+P` (34 sheets, 20 MB, vector PDF, 35 × 23 in):

| PoC | Result |
|---|---|
| Sheet index from text | A-00 carries a full sheet list (discipline / number / name) and every page has its sheet number in the title block; scale strings (`1/4" = 1'-0"`) are text. Deterministic parsing covers this set without AI. |
| Vector geometry + calibration | pdf.js `getOperatorList` exposes the drawn lines (A-10: 5,424 straight segments; P-02: 16,602 path ops). Dimension strings such as `16'-8 11/16"` are text items; a matcher found each one's dimension line and the length/feet ratio agrees with the printed scale (18 pt/ft) within 0–2 %. Auto-calibration with a verification band is therefore possible. |
| Rendering | pdf.js + `@napi-rs/canvas` (already in `node_modules` as pdf.js's optional dependency, lockfile includes the linux-x64 binary) renders A-10 at 72 dpi in 269 ms and P-02 at 144 dpi in 714 ms, ~290 MB RSS. The droplet has no `pdftoppm`; in-process rendering is the path. |
| AI on the roof plan (image only, the weak variant) | Claude Opus 5.5, A-10 at 72 dpi, 42 s, $0.12: all 8 drain fields found with their slope arrows, 9 drains + 2 scuppers (2") placed correctly, parapet traced, 12 dimension strings read verbatim, **no roofing material named** (correct — the set never specifies the membrane), 0 crickets. Its free-hand polygons measured 2,942 SF against a 3,243 SF envelope computed from the dimension strings (−9 %). Labels and classification are reliable; geometry must come from ids + snapping, which is the design below. |

What the test set tells us about the acceptance tests: the **roof is a
concrete slab with concrete parapets, tapered drain sumps, primary and
emergency drains and two 2" scuppers; the membrane assembly is not specified
anywhere in the set** (wall sections say "cementitious waterproofing" and
R-30 foam; A-24 is generic). The correct Stage 1 output for roofing on this
project is a measured roof with "assembly not specified — review required",
not an invented assembly. Plumbing is well specified: P-01 has the fixture
connection schedule (WC 3" / ½", L 1½", T 2", SH 2", HB ¾", FD 2") and
material notes (CPVC or PEX interior supply with copper stub-outs, PEX
underground; DWV PVC Sch 40 solid core underground, PVC above ground); P-02 /
P-03 label every run as text (`SAN. - 3"ø`, `VENT. - 2"ø`); P-05 / P-06 label
`C.W. 3/4"ø`, `H.W. 1/2"ø`, `H.W.R. 3/4"ø`; the isometrics P-04 / P-07 give FCO,
VTR and WHA counts; G-01 / G-02 give a 500-gal LP tank, PE 1" and ¾", CSST ¾",
Sch 40 ¾", regulators and the appliance MBH list.

---

## 1. Existing system audit

**Platform.** Next.js 16.2 App Router, React 19, Prisma 7 on PostgreSQL,
one systemd unit on the droplet, nginx (25 MB body limit, 60 s proxy timeout
on the CRM vhost) behind Cloudflare. No job queue: crons are shell wrappers
posting to `/api/cron/*` with `x-cron-secret`. No AI SDK, no `lib/ai`, no
`ANTHROPIC_API_KEY` on prod.

**Projects.** `Lead` holds the property address (`propertyAddress1`, `city`,
`state`, `zipCode`); `Job` has `jobNumber`, `leadId`, no address of its own.
Labels are address-first (`src/lib/labels`).

**Estimates.** Two families, both on the Lead, neither with `jobId`:
- Generic `Estimate` → `EstimateSection` → `EstimateLineItem` (description,
  unit type, quantity, unit price, line total; `templateCategory` is the only
  trade notion; status DRAFT / SENT / ACCEPTED / DECLINED).
- `RoofEstimate`: a lump `materialCost`, labour per roof type in JSON, nine
  fee columns, margin, no lines.
- Prod today: 5 generic estimates (all DRAFT, 109 lines), 11 roof estimates,
  0 roof measurements, **0 vendors**, 18 open jobs, 45 leads, 7 active users.

Checklist Richard asked for: trades — partial (a category enum); line items —
yes on the generic family only; material records — no; attachments — no (PDFs
become `File` rows with no back-link); suppliers — `Vendor` exists (name,
kind SUPPLIER / SUBCONTRACTOR, email, phone) but no link from estimates;
proposals — yes, client and internal PDFs via `@react-pdf/renderer` for both
families, and estimate → `CustomerContract` → e-sign; cost codes — `CostCode`
is labour-only; historical estimates / versions — no versioning, edits in
place.

**Roofing library** (`src/lib/roofing`, on prod since 2026-10-03). Pure
`parsing/` (pdf.js text with glyph positions) and `engine/` (43 rules of kind
per_square / per_lf / per_count / lf_per_unit / fixed / waste_pct, waste
only on wasteable categories, discrete-unit rounding, `calcNote` per line,
confidence score), `measurements.ts` (`applyEdits` keeps the first replaced
value, `reviewState`), `RoofMeasurement` (source ROOFR / MANUAL / FIELD,
per-field confidence, overrides), `RoofRule` overrides, `RoofMaterialItem` +
append-only `RoofMaterialPrice`. Gaps: no planes or facets, one waste number,
no package sizes, nothing persists a takeoff, no `RoofSystem`.

**Files.** `File` (leadId?, jobId?, taskId?, expenseId?, category enum,
storageKey) on local disk under `UPLOADS_DIR`; `saveFile` / `readFile`;
`GET /api/files/[id]` reads the whole file into memory (no range requests);
`FilePreviewDialog` iframes PDFs; a `GeneratedDocument` (requires `jobId`)
protects its file from deletion. CSP: `img-src 'self' data: blob: https:`,
frames denied except `FRAMED_BY_SELF`.

**Export and PDF.** `src/lib/csv.ts` `toCsv` + client `downloadCsv`;
`exceljs` 4.4 present but only used to read budget imports (nothing writes
XLSX yet); all PDFs via `@react-pdf/renderer` `renderToBuffer`.

**Reusable as-is:** the roofing engine and its rules table pattern, the
measurement edit/review model, `saveFile`, the file routes and preview, the
CSV helper, `@react-pdf` layouts and company block, zod `validateBody`,
`guardLead` and the explicit role-list convention, the cron-tick pattern,
`useSearchParamState`, the list toolbar, the pointer-event canvas pattern in
the signature pad, the dev SSO bypass + headless Chromium QA recipe.

---

## 2. Repository evaluation

| Project | Licence | What it is | Verdict |
|---|---|---|---|
| OpenTakeoff (`Kentucky-ai/opentakeoff`, 164★, 701 commits, two contributors, ~4 months old) | Apache-2.0 | Browser-only React + Canvas/SVG flooring takeoff with an MCP server; per-sheet scale from the drawn scale note or a known dimension; "Check a dimension" verdict; AI proposals drawn dashed until a person accepts; CSV/XLSX/marked-PDF exports | **Borrow concepts, do not embed.** It owns the whole UI, stores in IndexedDB, is flooring-shaped and depends on a canvas we would have to fork. The four ideas worth taking are already in this design: scale per sheet, calibration verified against a dimension, dashed proposals, a refusal to measure an uncalibrated sheet. |
| ConMCP (`ContractorKeith/conmcp`, 1★, 12 commits) | MIT | Python MCP server: find relevant sheets, render pages for a vision model, deterministic LF/SF/EA regex extraction, fence-takeoff playbook; makes no LLM calls itself | **Concepts only.** Its separation (deterministic parsing and rendering, the model only interprets) matches our boundary; nothing to run. |
| ProTakeoff (`Driven-Waterproofing-Solutions-Pty-Ltd/take-off`, 1★) | MIT, but renders with **MuPDF (AGPL)** and a Supabase backend | Tauri/Rust desktop + web, area / linear / count tools, assemblies with JS formulas | **Reject.** Desktop shell, AGPL renderer, no maintenance signal. |
| OpenConstructionERP | AGPL + PyMuPDF + CC BY-NC data | Analysed 2026-10-07 | **Reject for code** (already recorded); nothing takeoff-specific to borrow. |

Rules carried from the 2026-10-07 roadmap: no AGPL/GPL code linked in, no
non-commercial vision weights (CubiCasa, FloorPlanCAD, YOLO), no PyMuPDF.
pdf.js (Apache) is already in the CRM and gives exact vector geometry; that
is the measurement substrate.

---

## 3. Recommended architecture

```
upload PDF ──► File (PLAN_SET) ──► PlanDocument ──► PlanSheet per page
                                        │
                     tick queue (PlanJob / PlanJobStep, one unit per HTTP call)
                                        │
   code:  page inventory → positioned text → vector segments → 72/144 dpi PNG
          sheet number / title / discipline / scale (A-00 list + title block)
          dimension strings ↔ dimension lines → calibration + verification band
                                        │
   AI:    classify leftover sheets · extract schedule/spec text with line ids
          roof regions (pick candidate loops / segment ids) · pipe runs (pick segment ids
          near a parsed label) · fixture cross-check — ids + one-line evidence, never a number
                                        │
   code:  snap → shoelace / polyline length / counts at the sheet's ptPerFt
          TakeoffMeasurement rows (geometry, value, confidence, evidence, review status)
          rules table → TakeoffMaterialLine + TakeoffMaterialSource (View calculation)
          waste → required → package → order · validation checklist
                                        │
   person: review workspace (Plans | Takeoff | Materials | RFQ) — approve / edit / exclude
                                        │
   code:  TakeoffRfq + items (stable numbers) → PDF / XLSX / CSV as protected Files
```

**Ownership.** A takeoff hangs on the **Lead** (`leadId` required, `jobId`
optional, filled by the same `jobFor()` rule the roofing service uses). Plans
arrive before Won, the address and both estimate families live on the lead,
and the job page already renders lead-scoped panels.

**Execution.** A table-driven tick queue: the upload request only stores the
file and creates a `PlanJob` with its steps; `POST /api/takeoff-jobs/[id]/tick`
claims one step at a time (`FOR UPDATE SKIP LOCKED`), runs it inside a 40 s
budget and returns progress; the browser calls it in a loop while the person
watches, and a once-a-minute `POST /api/cron/takeoff-tick` finishes abandoned
jobs. Stale locks (3 min) reset to pending, so a deploy restart loses nothing.
`after()` was rejected (dies with the process, no progress, no retry) and
pg-boss deferred (needs a worker unit; `PlanJobStep` becomes a pg-boss job
later without a schema change).

**Viewer.** Server-rendered PNG levels (72 dpi for fit and thumbnails, 144 dpi
once zoomed) in an `<img>` under a CSS-transform pan/zoom container, with one
SVG overlay whose `viewBox` is the sheet in PDF points, so every shape is
stored and drawn in the same coordinates. No PDF iframe (no overlay, no
coordinate mapping, not QA-able in the headless shell) and no client pdf.js
(worker bundling, 600 MB canvases at zoom, 20 MB download per session).

**Storage.** The PDF, every page's text JSON, geometry JSON and renders, and
every RFQ export live on disk under `UPLOADS_DIR` through `saveFile`; only
keys and small summaries go to Postgres (the pool is 8 / 2 and a 34-page set
would otherwise put tens of MB of JSON in rows).

**Two new npm packages:** `@anthropic-ai/sdk` and `@napi-rs/canvas` (declared,
not optional). No other new infrastructure.

---

## 4. User workflow

1. Open the lead → tab **Plan takeoff** (also Job → Money → Plan takeoff).
   Empty state: "Upload the construction set to start a takeoff".
2. Drop the PDF(s) on the uploader, label them ("Bid set", "Addendum 1"),
   choose what an addendum replaces. Progress: "Rendering sheets 12/34 →
   Reading text → Indexing sheets". *Code proposes* the sheet index and a
   calibration per sheet, verified against the dimension strings. *The person
   confirms* by glancing at the sheet table: green "Calibrated" badges, any
   "Needs calibration" row fixed now or later; number / title / discipline /
   scale are inline-editable.
3. **Analyze plans** → tick Roofing / Plumbing → Start. Each trade card shows
   stage progress ("Classifying sheets → Identifying roof assembly →
   Measuring A-10 → Building materials"). The person can leave; the card
   resumes polling on return.
4. Trade card: `✓ 6 sheets analyzed · ✓ Roof measured — 3,180 SF, 319 LF
   parapet, 11 drains · ⚠ Roof assembly not specified · ⚠ 3 specifications
   require review` → **Review takeoff**.
5. **Takeoff tab** (`/takeoff/[id]?tab=takeoff&sheet=A-10`): AI shapes are
   dashed. Walk the measurement list: click → inspector → **Approve** (turns
   solid), drag a vertex (status Modified, value recomputed by the server),
   or **Exclude**. Draw anything missed with Area / Linear / Count, snapping
   to the drawn lines, a live "23.4 LF" readout while drawing, a label
   popover prefilled from the nearest text (`C.W. 3/4"ø`). A sheet that needs
   calibration: press K, click two ends of a dimension, type `20'-0"`, Save;
   its measurements recompute with the previous value kept.
6. **Materials tab**: rows with an amber border are the items that require
   review, each with the reason ("No roof assembly specified", "Riser
   allowance assumed"). **View calculation** opens the ledger (P-02 475 LF +
   P-03 398 LF + vertical allowance 212 LF = 1,085 LF × 1.10 = 1,194 LF → 60
   × 20 ft lengths); a source chip jumps to the sheet with the runs
   highlighted. Adjust waste or order quantity inline, **Approve**, or **Mark
   needs clarification** with a note that prints on the RFQ. **Approve all
   high-confidence** for the rest; LOW items can only be approved one by one.
7. **Validate** → the checklist lists what is left with Go buttons; when
   empty it reads **Ready for RFQ** and the header button enables.
8. **Generate supplier RFQ** → supplier (a Vendor of kind SUPPLIER, or none),
   requested-by date, notes, item preview → Create.
9. RFQ tab: Download PDF / XLSX / CSV, Print, Copy table. The card reads "RFQ
   created · RFQ-0012".
10. Repeat 4–9 for Plumbing.

A **scanned set** (no text layer): every sheet is flagged raster, the hub
explains "These plans have no readable text — automatic takeoff is off;
calibrate each sheet and measure by hand", Analyze becomes **Start manual
takeoff**, auto-calibrate and snapping are disabled, and everything the
person draws starts as Reviewed. Steps 6–9 are identical.

What the AI proposes vs what the person confirms, in one line: AI proposes
the sheet index, calibration, assembly, measurements, material normalisation,
waste defaults and package rounding; the person confirms calibration, approves
or edits every measurement and line, decides clarifications and picks the
supplier. Nothing reaches an RFQ without a non-AI review status on every line.

---

## 5. Roofing takeoff design

**Relevant sheets** (proposed by code from discipline + title keywords,
confirmed by the person): roof plans, roof drainage plans, elevations,
sections, wall sections, structural roof plans, roof details, general notes /
specifications. On 3310: A-08, A-09, A-10, A-11, A-12, A-13, A-15, A-24.

**Step 1 — assembly (text, AI call `extract_specs`).** Input: the text of the
selected sheets with `sheet:lineId` prefixes. Output: `assembly: null | {type
∈ TPO, PVC, MOD_BIT_SELF_ADHERED, MOD_BIT_TORCH, BUILT_UP,
LIQUID_APPLIED_COATING, CEMENTITIOUS_WATERPROOFING, STANDING_SEAM_METAL,
CONCRETE_TILE, CLAY_TILE, ASPHALT_SHINGLE, OTHER; description; sourceLineIds}`,
deck, insulation, parapet detail, slopes, drainage, `notSpecified[]`,
evidence. The prompt forbids inference: if the covering is not named,
`assembly` is null and the takeoff carries a blocking validation item
"Assembly not specified on plans — choose or request clarification". The
person may then pick an assembly in the takeoff's specs form (stored as
`Takeoff.specs.roofing` with `specsReviewStatus`), and every material line
derived from it carries the evidence "assembly chosen by <name>, not from the
plans".

**Step 2 — geometry (AI call `roof_regions`, image + ids).** Input: the roof
plan rendered at 144 dpi and downscaled to ≤ 2,000 px on the long edge (and
quadrant crops when the sheet is wider than 30 in), **with numbered candidate
closed loops drawn on it** (found by code from the vector segments, area >
50 SF) and the ids of slope / drain / scupper / parapet labels. Output:
regions `{candidateLoopId | polygonImagePx, kind ∈ MAIN_ROOF, CRICKET,
PARAPET_WALL, OVERHANG, EQUIPMENT_PAD, SKYLIGHT, NOT_ROOF, slopeText,
confidence, evidence}`, `parapetSegmentIds[]`, drains `{textId, kind ∈
PRIMARY, OVERFLOW, SCUPPER}`, penetrations. The model never returns an area or
a length.

**Step 3 — measurement (code).** Polygon vertices snap to segment endpoints
within 10 pt; the snapped share drives confidence (≥ 90 % HIGH, 70–90 %
MEDIUM, below LOW). Shoelace area ÷ `ptPerFt²` → SF per region; parapet LF =
Σ chosen segment lengths ÷ `ptPerFt`; drains / scuppers / crickets are counts
with a point each. Results map onto the existing `Measurements` type
(`flatAreaSqFt`, `pitchBands` when a pitch is known, eaves / rakes / ridges /
hips / valleys for steep roofs, `penetrations`) plus roofing extras
(`parapetLf`, `copingLf`, `cricketCount`, `drains`, `overflowDrains`,
`scuppers`, `slopes[]`). Measured geometry is stored separately from
calculated materials.

**Step 4 — materials.** Low-slope rules (`src/lib/takeoff/roofing/rules.ts`,
all gated on an identified assembly): membrane field SF per assembly region,
base flashing LF = parapet LF (height from the detail, else an 18" allowance
labelled as such), coping LF = parapet LF, termination bar LF, drains /
overflow drains / scuppers EA, cricket insulation EA as an allowance,
insulation SF only when specified, fasteners / plates / adhesive / primer /
sealant as allowances per SF labelled "Allowance –", walk pads only when
drawn. Steep-slope roofs (shingle / tile / metal) delegate to the existing
`roofing/engine` through `toEngineMeasurements`; the standing-seam panel
schedule (panel width × plane dimensions, not area × 10 %) is P1 because it
needs per-plane geometry the current `Measurements` type lacks (the
`TakeoffMeasurement` rows already keep each plane, so the engine input can be
widened then).

On 3310 the expected output is: 8 drain-field regions summing to roughly
3,200 SF (the envelope from the dimension strings is 3,243 SF), parapet ≈ 319
LF, 9 primary / emergency drains, 2 scuppers, 0 crickets, assembly =
not specified (blocking), and material lines generated only after the person
chooses an assembly.

---

## 6. Plumbing takeoff design

**Relevant sheets**: P-01 (notes + schedules), P-02 / P-03 (sanitary plans),
P-04 (sanitary isometric), P-05 / P-06 (water plans), P-07 (water isometric),
G-01 / G-02 (gas), the architectural floor plans A-04 / A-05 / A-07 for the
fixture cross-check, C-03 for utilities.

**Step 1 — schedule and materials (text; code first, AI second).** Code
clusters the fixture connection schedule by rows and columns
(`plumbing/schedule.ts`, the same technique as the A-00 sheet list) into
`{tag, waste, vent, cw, hw}`; `parseMaterialNotes` reads the material notes
by pattern. The `extract_specs` call then fills gaps and reads anything the
patterns missed, returning text ids as evidence. On 3310: WC 3" / ½", L 1½" /
½", BID 1½", T 2", SH 2", KS 1½", DW 1½", US 1½", HB ¾", FD 2"; supply CPVC
or PEX with copper stub-outs, underground PEX; DWV PVC Sch 40 solid core
underground, PVC above ground; hangers and 1" fibreglass sound insulation on
sanitary pipe; AAVs; Josam wall cleanouts.

**Step 2 — fixtures (code + cross-check).** Fixture tags are text items
(`WC-1`…`WC-6`, `L-1`…`L-6`, `SH-2`…`SH-6`, `KS-1/2`, `US-1`…`US-4`,
`HB-1`…`HB-8`, `WH-1/2`, `T-1`, `WM-1`…`3`, `FCO`, `AAV`, `WHA`, `VTR`);
`parseFixtureTag` counts them per sheet with a point each. The `fixture_check`
call compares plan counts, schedule counts and riser counts and names likely
causes for any discrepancy; a discrepancy becomes a NEEDS_CLARIFICATION
measurement, never a silent choice. Untagged symbol detection is P1.

**Step 3 — pipe runs (AI call `pipe_runs`, tile + ids).** For each parsed
pipe label (`SAN. - 3"ø` → system SAN, size 3; `C.W. 3/4"ø`; `H.W.R.`;
`VENT.`; `GAS … PE 1"`) code crops a 144 dpi tile around the label, draws the
candidate segments within 150 pt in colour with ids, and asks which segment
ids form that labelled run and which label it continues to. Code joins the
chosen ids into an ordered polyline (`connectedRuns`), measures it at the
sheet's `ptPerFt`, and stores one LENGTH measurement per run with
`attributes {system, sizeIn, material}`. Separate buckets: underground vs
above ground (from the plan's own notation or the person), sanitary vs vent
vs building sewer, cold vs hot vs hot-water return.

**Step 4 — vertical piping.** Plans show horizontal runs only and isometrics
are not to scale. Vertical pipe is **never measured**: it is an explicit
allowance line per system (default 6 ft DWV and 8 ft water per fixture,
editable in the takeoff's settings), labelled "Allowance –", with the
per-fixture feet shown in the validation checklist until a person confirms
it. The isometrics give counts only (VTR, FCO, WHA, stacks).

**Step 5 — valves and devices.** Counts from tags and text: shut-off valves
per fixture (schedule note 5C → one per fixture connection), main shutoff,
hose bibbs with vacuum breaker, water heaters (tankless 180 MBH ×2 on 3310),
WHA ×19, AAVs, cleanouts (FCO / WCO), floor drains, PRV / backflow /
expansion tank / recirculation pump only when drawn or noted.

**Step 6 — gas (parsed in Stage 1, materials in P1).** Labels on G-01 / G-02
are parsed into runs by material and size (PE 1", PE ¾", CSST ¾", Sch 40 ¾"),
regulators and appliances with MBH are counted, tank and meter noted. Gas
material lines (pipe, regulators, sediment traps, shutoffs, CSST fittings
allowance) ship in P1 so the plumbing acceptance test is not held by the gas
engineering details.

**Step 7 — fittings.** Where fittings are drawn and tagged they are counted;
otherwise they are an allowance line per size (default 35 % of DWV LF, 40 %
of water LF, as EA-less "Allowance – fittings, confirm with supplier" lines)
and are never presented as measured. Counting fittings from junction
geometry is P1.

---

## 7. Material generation engine

One pure function, `generateMaterials(trade, metrics, rules, settings,
specs)`, mirrors the roofing engine:

```
rule: { key, kind: per_lf | per_count | allowance_pct_of_lf | allowance_per_count | fixed,
        inputMetric, material (from specs), specKey template, unit, wasteKey, package }
line: measured = Σ MEASURED sources      (from TakeoffMeasurement rows, in the line's unit)
      allowance = Σ ALLOWANCE sources    (labelled, with the formula in the note)
      required  = (measured + allowance) × (1 + waste)
      order     = packageSize ? ceil(required / packageSize) : required
      calcNote  = "475 LF (P-02) + 398 LF (P-03) + 72 LF vertical allowance = 945 LF × 1.10 = 1,040 LF → 52 × 20 ft lengths"
```

**Normalised material record.** Structured columns on every line — `trade,
category, material, schedule, size, application, unit` — plus a deterministic
`specKey` produced by the rule (`plumbing.dwv.pipe.pvc_sch40.3in`,
`roofing.membrane.tpo.60mil.field`). The original plan wording is kept in the
source rows (`"SAN. - 3"ø"`). No new catalog table in Stage 1: `RoofMaterialItem`
stays where it is with an optional link from roofing lines; a trade-neutral
catalog is the P2 migration target once supplier quotes are ingested, because
that is when a catalog earns its keep.

**Packaging** is optional and table-driven (`materials/packaging.ts`: PVC 20 ft
lengths, PEX 100 / 300 ft rolls, membrane rolls by square); when no package is
known the order quantity equals the required quantity in the measured unit.

**Company overrides** of rule values reuse the `RoofRule` pattern through a
generic `TakeoffRule {key, value, active, note}` table (M5), with the admin UI
copied from the roofing rules tab.

---

## 8. Review and approval system

Every measurement and every material line carries `reviewStatus ∈
AI_GENERATED, REVIEWED, MODIFIED, APPROVED, EXCLUDED, NEEDS_CLARIFICATION`
and `confidence ∈ HIGH, MEDIUM, LOW` with a score and a reason. Rules:

- AI output is a proposal: dashed on the plan, "AI generated" in the table.
- Approving a measurement or line records who and when; editing geometry or
  a quantity sets MODIFIED and keeps the first replaced value (the roofing
  `applyEdits` convention).
- **Bulk approve** accepts only HIGH (and MEDIUM when the person opts in);
  the server refuses LOW in bulk, so a LOW item is always opened.
- NEEDS_CLARIFICATION requires a note; the note prints on the RFQ as
  "Clarify with supplier".
- Excluded lines stay in the record, hidden by default.
- **Validation** (`materials/validate.ts`) runs the per-trade checklist
  Richard listed (roofing: assembly, area, waste, underlayment / membrane,
  edges, flashing, penetrations, fasteners, sealants, drainage; plumbing:
  fixtures, sanitary, vent, cold, hot, HWR, service, sewer, heaters, valves,
  cleanouts, hose bibbs, gas, fittings, supports, insulation) plus cross-check
  outcomes, uncalibrated sheets with measurements, LOW items not reviewed and
  open clarifications. Output: `READY FOR RFQ` or `n items require review`,
  each item with a Go button.
- An RFQ can only be created from APPROVED (and REVIEWED) lines when there
  are no blockers; the route answers 409 otherwise.

---

## 9. RFQ generator

`TakeoffRfq {number RFQ-nnnn (Postgres sequence, never reused), takeoffId,
trade, vendorId?, projectName, siteAddress (copied from the lead at creation),
requestedByDate, notes, status DRAFT / ISSUED / CLOSED}` with `TakeoffRfqItem
{lineNo, materialLineId, specKey, description, material, schedule, size,
quantity, unit, notes}`. Line numbers and spec keys are stable so a supplier
quote can later be matched item by item (P2 architecture only).

Exports, each stored as a `File` (`category RFQ`) plus a versioned
`TakeoffRfqExport` with the exported snapshot, and protected from deletion
the way generated documents are:
- **PDF** — `@react-pdf/renderer`, the company block and address-first project
  header the estimate PDFs use, columns `# · Description · Material ·
  Schedule · Size · Qty · Unit · Notes`, a footer "Quantities are takeoff
  estimates; confirm on site". The data passed to the renderer has no price,
  labour, markup or customer-price field at all.
- **XLSX** — `exceljs` `Workbook.xlsx.writeBuffer()` (the first XLSX writer in
  the repo), one sheet, header row frozen, the same columns.
- **CSV** — `toCsv`.
- **Print** — `/takeoff/[id]/rfq/[rfqId]/print`, a route group without the app
  shell, `window.print()` on `?auto=1`.
- **Copy table** — TSV to the clipboard.
Email to the supplier is P2; "Issue" only stamps the status today.

---

## 10. Database changes

New tables (all `plan_*` / `takeoff_*`; enums as listed in the approved
backend design): `PlanSet` (lead, job?, name), `PlanDocument` (planSet, file,
kind FULL_SET / PARTIAL / ADDENDUM / REVISION, label, revisionLabel, sequence,
sha256, pageCount, status), `PlanSheet` (document, pageNumber, size,
sheetNumber / title / discipline / scaleText in force plus `detected` JSON and
`indexConfidence`, isRaster, text / geometry / render storage keys,
`scaleSource NONE / AUTO / AUTO_VERIFIED / MANUAL`, `ptPerFt`,
`scaleVerification` JSON, `supersededBySheetId`), `PlanJob` + `PlanJobStep`
(kind, status, sequence, stepKey, dependsOn, attempts, lock), `Takeoff`
(number TK-nnnn, lead, job?, planSet, trades[], status, `pinnedDocumentIds`,
`specs`, `settings`), `TakeoffSheet` (relevant-sheet selection with a role),
`TakeoffMeasurement` (sheet, trade, kind AREA / LENGTH / COUNT / POINT,
metricKey, label, attributes, geometry in PDF points, `ptPerFt` snapshot,
valueRaw, unit, previousValue, origin AI / MANUAL / TEXT_LABEL / SCHEDULE,
confidence, reviewStatus, evidence), `TakeoffMaterialLine` (lineNumber,
specKey, the normalised columns, measured / allowance / waste / required /
package / order, isAllowance, ruleKey, calcNote, notes, confidence,
reviewStatus, overrides, roofMaterialItemId?), `TakeoffMaterialSource`
(line ↔ measurement with kind and contribution), `TakeoffRule`, `TakeoffRfq`,
`TakeoffRfqItem`, `TakeoffRfqExport`, `PlanAiCall` (purpose, model, prompt
version, input hash as cache key, tokens, cost, structured output only).

Existing tables touched: `FileCategory` gains `PLAN_SET` and `RFQ`; `File`,
`Lead`, `Job`, `Vendor`, `RoofMaterialItem`, `User` gain back-relations. Hand
written CHECKs in the migration SQL: `value_raw >= 0`, `unit IN ('LF','SF','EA')`,
`kind = 'COUNT' OR pt_per_ft IS NOT NULL`. Two sequences for the takeoff and
RFQ numbers. **Not touched:** `RoofMeasurement`, `RoofRule`, `RoofMaterialItem`,
both estimate families, `GeneratedDocument`, `BudgetLine`, `Commitment`.

**Revisions.** No version table: a revised sheet is a new `PlanSheet` row
under a new `PlanDocument`; every measurement keeps a `Restrict` foreign key
to the exact sheet row it was drawn on; a takeoff records the document ids it
was built from and reads `stale: true` when its plan set has documents it
never saw; a person marks which old sheet an addendum supersedes, and every
measurement on a superseded sheet shows "replaced by P-02 (Addendum 1)".
Nothing re-attaches silently. "What changed" comparison is P2.

Five migrations in order: `plan_sets` (M1), `takeoffs_measurements` (M2),
`plan_ai_calls` (M3), `takeoff_materials` incl. `TakeoffRule` (M5),
`takeoff_rfqs` (M6).

---

## 11. API changes

All routes: session → explicit role list (`src/lib/takeoff/access.ts`) →
`guardLead` on the entity's lead → `validateBody` (zod) → audit.

| Route | Roles |
|---|---|
| `GET /api/plan-sets?leadId=` · `POST /api/plan-sets` · `GET/PATCH/DELETE /api/plan-sets/[id]` | read / edit / ADMIN+MANAGER (delete only with no takeoffs) |
| `POST /api/plan-sets/[id]/documents` (multipart, ≤ 95 MB, PDF only, duplicate sha256 → 409) | edit |
| `GET /api/plan-sets/[id]/sheets` · `PATCH /api/plan-sheets/[id]` (index corrections, supersedes) | read / edit |
| `GET /api/plan-sheets/[id]/render?dpi=72|144` (PNG, lazy, cached on disk) · `/text` · `/geometry` | read |
| `POST /api/plan-sheets/[id]/calibrate` `{mode: auto | manual {a, b, distanceFt} | confirm}` | edit |
| `POST /api/takeoffs` · `GET /api/takeoffs?leadId=` · `GET/PATCH /api/takeoffs/[id]` · `PUT /api/takeoffs/[id]/sheets` | edit / read / edit |
| `POST /api/takeoffs/[id]/analyze` (409 while running, 503 when AI is unset) | edit |
| `GET /api/takeoff-jobs/[id]` · `POST …/tick` · `…/retry` · `…/cancel` · `POST /api/cron/takeoff-tick` | read / edit / cron secret |
| `GET/POST /api/takeoffs/[id]/measurements` · `PATCH /api/takeoff-measurements/[id]` · `POST …/measurements/bulk-review` · `…/recompute` | read / edit / approve for bulk |
| `POST /api/takeoffs/[id]/materials/generate` · `GET …/materials` · `PATCH /api/takeoff-materials/[id]` · `POST …/materials/bulk` · `GET …/validation` | edit / read / edit·approve / approve / read |
| `POST /api/takeoffs/[id]/rfqs` · `GET/PATCH /api/rfqs/[id]` · `POST …/exports {format}` · `GET …/table` · `POST …/issue` | approve |

Roles: **edit** = ADMIN, MANAGER, OFFICE_STAFF, SALES_REP (own leads through
`guardLead`); **approve / RFQ** = ADMIN, MANAGER, OFFICE_STAFF. Read = anyone
who can read the lead; own-only roles get 404 outside their leads. Optimistic
concurrency on PATCH bodies (`updatedAt`; mismatch → 409 with the current row).

Environment: `ANTHROPIC_API_KEY` (optional; unset → analysis answers 503 and
manual mode works), `TAKEOFF_AI_MODEL` (default `claude-opus-5-5`),
`TAKEOFF_AI_MAX_USD` per takeoff (default 25). nginx: a `location
/api/plan-sets/` block with `client_max_body_size 100M` and a 120 s read
timeout — an operator change, recorded in the deploy notes.

---

## 12. Frontend components

Pages: `src/app/(dashboard)/takeoff/[takeoffId]/page.tsx` (+ `loading.tsx`),
`src/app/(print)/takeoff/[takeoffId]/rfq/[rfqId]/print/page.tsx` (+ a shell-less
`layout.tsx`). Entry points: `"takeoff"` in the lead page `LEAD_TABS` and
`{value: "takeoff", label: "Plan takeoff"}` in the job page `MONEY` group.

Under `src/components/takeoff/`:
- Hub: `PlanTakeoffPanel`, `PlanSetUploader` (drag-drop, label, "replaces"),
  `PlanSetList`, `SheetIndexTable` (thumbnails, inline edits, calibration
  badges), `AnalysisProgress`, `AnalyzeDialog`, `TradeStatusCard`, `badges.tsx`
  (`ConfidenceBadge`, `ReviewStatusBadge`, `CalibrationBadge`,
  `TakeoffStatusBadge`).
- Workspace: `review/TakeoffWorkspace` (URL state `tab`, `sheet`, `m`, `line`,
  `rfq`), `WorkspaceHeader`, `SheetRail`, `SheetDetails`.
- Viewer: `viewer/PlanViewer`, `SheetImage` (72 → 144 dpi swap), `SheetOverlay`
  (SVG, dashed proposals, solid approved, highlight, dimming), `MeasurementShape`,
  `DraftShape`, `VertexHandles`, `DrawToolbar` (V A L C K S F keys),
  `CalibrateDialog`, hooks `usePanZoom` (own, pointer events, wheel, pinch, no
  library), `useDrawing`, `useSnap` (grid index over the sheet's segments; 10
  px endpoint, 6 px on-segment).
- Measurements: `MeasurementList`, `MeasurementInspector`.
- Materials: `MaterialsTable` (list toolbar, grouped rows, inline waste /
  order qty, bulk bar), `MaterialRow`, `CalculationPopover`, `SourceChip`,
  `LineEditDialog`, `ClarificationDialog`.
- Validation / RFQ: `ValidationPanel`, `RfqDialog`, `RfqPanel`, `RfqPrintView`.
- Data: `use-takeoff.ts` (query keys, optimistic mutations), `use-analysis-job.ts`
  (1.5 s polling while queued / running, stall notice after 2 min),
  `use-sheet-calibration.ts`.

Pure client-safe libs under `src/lib/takeoff/`: `geometry.ts` (transform,
y-flip, shoelace, lengths, point-to-segment), `snap.ts`, `calibration.ts`
(`parseFeetInches`, `scaleTextToPtPerFoot`, deviation check), `format.ts`,
`style.ts`, `keys.ts`.

Phone: single column, Materials | Validation | RFQ, approve and clarify
allowed, read-only viewer in a bottom sheet, no drawing.

---

## 13. AI services (where AI is necessary)

| Call | Why AI | Input | Output | Effort |
|---|---|---|---|---|
| `classify_sheets` | only for pages the title-block parser could not place | text only | sheet number / title / discipline / scale / confidence per page | low |
| `extract_specs` | schedules and notes are free text | selected sheets' text with line ids | roofing assembly or null; plumbing schedule, materials, gas appliances; `notSpecified[]` | high |
| `roof_regions` | which closed region is which roof | image + numbered candidate loops + label ids | loop ids or polygons, kinds, slope text, parapet segment ids, drains by text id | high |
| `pipe_runs` | which drawn lines carry a labelled run | tile + coloured candidate segment ids | segment ids per label, continuation, system, size | medium |
| `fixture_check` | explain count discrepancies | counts per source | discrepancies with likely cause | low |

Mechanics: `@anthropic-ai/sdk` `client.messages.parse` with
`zodOutputFormat` (point coordinates as `{x, y}` objects — tuples are rejected
by the schema transformer, found in the PoC), model from env (default
`claude-opus-5-5`), adaptive thinking left at its default with display
omitted (nothing to store), frozen system prompts with `cache_control`, SDK
timeout 120 s, two retries, a per-takeoff cost cap. Every call is recorded in
`PlanAiCall` with a hash of (purpose, prompt version, model, inputs) as a
cache key, so re-running a takeoff never pays twice for the same sheet.
Images: 144 dpi renders downscaled to ≤ 2,000 px on the long edge for whole
sheets (the model's 2,576 px limit), 1:1 tiles for labels. Evidence stored:
the structured output and a ≤ 200-character summary per item; never the
prompt text or reasoning.

Estimated cost for a project like 3310 (two trades): $4–8 and 6–12 minutes of
wall time at two concurrent steps. The PoC's single image-only call cost
$0.12.

Where AI is skipped: raster sheets (manual mode), sheets without a scale (AI
labels still run; values show "needs calibration"), spec extraction when no
notes sheet is selected (blocking validation item instead).

---

## 14. Deterministic services (must not rely on AI)

Page inventory; text and geometry extraction (tracking the CTM through
save / restore / transform, flattening curves, deduping, capping at 40,000
segments per page); sheet-list and title-block parsing; discipline from the
sheet prefix; scale-string parsing; feet-inches parsing; dimension-line
matching and the calibration verdict (≥ 3 matches within 3 % spread →
AUTO_VERIFIED; printed only → AUTO, needs confirmation; nothing → NONE);
snapping; shoelace area, polyline length, point-in-polygon, connected runs;
every count; the fixture schedule row/column clustering; pipe-label parsing;
roof and plumbing metrics; all rules, waste, required, package and order
arithmetic; validation; RFQ numbering and exports. Each is a pure module with
vitest coverage; none imports Prisma or Next.

---

## 15. Security

- Plan sets are files on the lead: the existing `fileReadWhere` scope applies,
  so SALES_REP and CREW_LEAD see only their leads' plans; `PLAN_SET` and `RFQ`
  are excluded from the generic upload picker's categories.
- Explicit role lists on every route (never `hasMinRole`); approval and RFQ
  creation are office-only; deletion of a plan set needs ADMIN / MANAGER and
  no takeoffs.
- Uploads: PDF only, 95 MB on the dedicated route, sha256 recorded, the
  generic 25 MB route untouched; `request.formData()` buffers in memory, which
  16 GB tolerates at that size.
- Rendered PNGs and JSON are served through authenticated routes with
  `Cache-Control: private`; nothing is public.
- AI data handling: only rendered page images and extracted text of the
  sheets a person selected leave the server, to Anthropic's API under the
  company's key; no customer PII beyond what is printed on the drawings
  (owner name and address on the title block); outputs are stored as
  structured JSON; the API key lives in `/etc/knuco/env`, never in the repo;
  a cost cap stops runaway jobs. Claude Opus 5.5 requires standard (30-day)
  data retention on the Anthropic account.
- Exports can never carry price, labour or margin: the RFQ renderer's input
  type has no such fields, enforced by the TypeScript shape and a unit test
  that serialises a full RFQ and asserts the absence of those words.
- Audit rows on every write (`plan_set`, `plan_sheet`, `takeoff`,
  `takeoff_measurement`, `takeoff_material`, `takeoff_rfq`).
- No AGPL / GPL code, no non-commercial weights, no PyMuPDF.

---

## 16. Testing strategy

- **Unit (vitest):** every pure module above, with JSON fixtures of text items
  and segments captured from the 3310 sheets (small and committable; the 20 MB
  PDF is not committed), a 2-page fixture PDF generated by `@react-pdf` for
  the pdf.js wrappers, feet-inch and scale parsing tables, calibration verdicts
  with injected noise, snapping against brute force, rule arithmetic, packaging
  rounding, validation outcomes, RFQ export shapes (and the "no price words"
  assertion).
- **API probes:** 400 on bad geometry / scale, 403 for SALES_REP on approval
  routes, 404 on another lead's takeoff, 409 when analysing while a job runs
  or when an RFQ is requested with blockers, 503 with no API key.
- **Headless Chromium** at 1280 and 400 px with the dev SSO bypass, zero
  console errors: upload → 34 sheet rows → analyse → workspace (72 then 144
  dpi image, overlay polygons) → draw a line with snapping → approve →
  materials → View calculation → source chip jumps → validate → RFQ exports
  downloaded → print page screenshot → phone layout → SALES_REP read-only.
- **The 3310 set on prod** after each milestone: sheet index 34/34 with the
  A-00 titles, calibration verified on the plan sheets, roof regions ≈ 3,200
  SF with assembly "not specified", plumbing fixture counts matching the
  schedule tags, pipe runs by size, a plumbing RFQ with every item measured,
  specified, calculated or labelled as an allowance.

---

## 17. Accuracy benchmark

Per project and per metric: AI takeoff (before review) vs human takeoff (the
approved rows) vs actual purchase. Metrics: roof area, parapet / trim LF,
drain count, pipe LF by size, fixture count, per-line material quantity.
Error = |AI − reference| ÷ reference, reported as the share of items inside
±2 / ±5 / ±10 / ±20 %. The review workspace already records the before and
after of every edit (`previousValue`, overrides, review status), so the "AI
vs human" column needs no extra work; "actual purchase" is entered per
project from supplier invoices once the P2 quote ingestion exists, and by
hand before that.

Material on hand: the old estimator's 23 Roofr reports and 29 supplier
quotes / invoices (SRS, ABC, Tri County) give a roofing reference for
quantities per square. **Plumbing has no history in any system; Richard
chooses 2–3 completed projects with plan sets and purchase lists.** A
`scripts/takeoff-benchmark.ts` report prints the table per project; the
thresholds that gate "rely on it" are Richard's call once the first three
projects are in.

---

## 18. Implementation phases

| # | Milestone | Migration | Exit criterion |
|---|---|---|---|
| **M0** | Proofs of concept: (1) `@napi-rs/canvas` under the `knuco` systemd user on the droplet, (2) geometry fidelity (draw extracted segments back over the render; nested form XObjects and CTM are the trap), (3) AI id-picking on 10 pipe tiles + 2 roof plans vs hand labels, (4) tick timing over the 34 pages | none | numbers recorded in CLAUDE.md; the id design confirmed or the free-polygon + snap fallback chosen |
| **M1** | Plan sets, documents, sheet index with corrections, renders, text / geometry routes, 95 MB upload + nginx line, hub panel, sheet table, viewer (pan/zoom, no drawing) | `plan_sets` | the 3310 set indexed 34/34 on prod, every sheet viewable |
| **M2** | Calibration (auto-verified, manual, confirm) and the manual Area / Linear / Count tools with snapping, measurement list and inspector | `takeoffs_measurements` | a complete manual takeoff of A-10 and P-02 on prod; the scanned-set fallback works |
| **M3** | AI-assisted roofing: specs call, regions call, measurement from ids, review states, `PlanAiCall` | `plan_ai_calls` | A-10 regions within 5 % of the hand takeoff; assembly = not specified |
| **M4** | AI-assisted plumbing: schedule + notes, fixture counts and cross-check, pipe runs, vertical allowance | none | P-02 / P-05 runs by size within 10 % of the hand takeoff; fixture counts match the schedule |
| **M5** | Material lines, sources, View calculation, bulk review, validation, `TakeoffRule` + admin tab | `takeoff_materials` | "Ready for RFQ" reachable on both trades |
| **M6** | RFQ, PDF / XLSX / CSV / print / copy, protected files | `takeoff_rfqs` | a plumbing RFQ for 3310 downloaded in all three formats |

Each milestone: branch, tests + typecheck + lint ≤ baseline + build, dev QA,
Richard's push and deploy from `!`, prod click-through on 3310. P1 follows M6
(auto specs with evidence, automatic waste by category, fittings from
junctions, gas materials, history sanity checks, chunked upload, pg-boss if
ticks prove annoying). Not in Stage 1: pricing, supplier email, quote
ingestion, revision comparison, OCR.

---

## 19. File-by-file implementation plan

**Changed existing files**
- `prisma/schema.prisma` — models and enums of §10, back-relations; five
  migration folders under `prisma/migrations/` with hand-written CHECKs and
  sequences.
- `package.json` — `@anthropic-ai/sdk`, `@napi-rs/canvas` (declared).
- `next.config.ts` — add `@napi-rs/canvas` to `serverExternalPackages`
  (pdf.js is already there); no header change.
- `src/lib/env.ts` — `ANTHROPIC_API_KEY`, `TAKEOFF_AI_MODEL`, `TAKEOFF_AI_MAX_USD`.
- `src/lib/files/scope.ts` — keep `PLAN_SET` / `RFQ` out of `UPLOAD_CATEGORIES`.
- `src/app/api/files/[id]/route.ts` — the `generated` guard also counts
  `rfqExports` and `planDocument` (M6 / M1).
- `src/app/(dashboard)/leads/[id]/page.tsx` — `LEAD_TABS` + tab content.
- `src/app/(dashboard)/jobs/[id]/page.tsx` — `MONEY` sub-tab + content.
- `src/components/nav/*` command palette — a "Takeoffs" group (M2).
- `CLAUDE.md`, `docs/project-memory/features/plan-takeoff.md` (new feature doc).

**New — library (`src/lib/takeoff/`)**
`types.ts`, `limits.ts`, `access.ts`, `validation.ts`, `sheet-cache.ts`,
`service.ts`, `takeoff-service.ts`, `materials-service.ts`, `rfq-service.ts`;
`pdf/{open,text,geometry,render}.ts`; `sheets/{sheet-list,title-block,
discipline,scale,classify}.ts`; `geometry/{dimensions,calibrate,measure,
segments}.ts` and the client-safe `geometry.ts`, `snap.ts`, `calibration.ts`,
`format.ts`, `style.ts`, `keys.ts`; `roofing/{metrics,rules}.ts`;
`plumbing/{labels,schedule,metrics,rules}.ts`; `materials/{generate,packaging,
validate}.ts`; `ai/{client,schemas,prompts,calls,images}.ts`;
`pipeline/{plan,runner}.ts` and `pipeline/handlers/{index,classify,scale,
render,ai,measure,materials,validate}.ts`; `exports/{rfq-pdf.tsx,rfq-xlsx.ts,
rfq-csv.ts}`; a `*.test.ts` beside every pure module; fixtures under
`src/lib/takeoff/__fixtures__/` (text + segment JSON from A-00, A-10, P-01,
P-02, P-05; a tiny generated PDF).

**New — routes (`src/app/api/`)**
`plan-sets/route.ts`, `plan-sets/[id]/{route,documents,sheets}/route.ts`,
`plan-sheets/[id]/{route,render,text,geometry,calibrate}/route.ts`,
`takeoffs/route.ts`, `takeoffs/[id]/{route,sheets,analyze,measurements,
measurements/bulk-review,measurements/recompute,materials,materials/generate,
materials/bulk,validation,rfqs}/route.ts`, `takeoff-measurements/[id]/route.ts`,
`takeoff-materials/[id]/route.ts`, `takeoff-jobs/[id]/{route,tick,retry,cancel}/route.ts`,
`rfqs/[id]/{route,exports,table,issue}/route.ts`, `cron/takeoff-tick/route.ts`.

**New — UI** — the components and pages of §12 under `src/components/takeoff/`
and `src/app/(dashboard)/takeoff/`, `src/app/(print)/`.

**New — scripts** — `scripts/takeoff-poc/*` (M0, kept out of the build),
`scripts/takeoff-benchmark.ts` (M5+), `crm-cron/takeoff-tick.sh` on the
droplet.

**Must not be touched:** `src/lib/roofing/engine/*` and `parsing/*` (consumed
read-only), `RoofMeasurement` routes and panel, both estimate families,
`POST /api/files` and its 25 MB limit, `deploy.sh` (the uploads exclude).

---

## 20. Risks and unknowns needing proof-of-concept testing

| Risk | Handling |
|---|---|
| `@napi-rs/canvas` under systemd on the droplet | M0 item 1; fallback is `apt install poppler-utils` and a `pdftoppm` child process behind the same `render.ts` interface |
| Geometry fidelity (form XObjects, clipping, curves) | M0 item 2 draws the extracted segments back over the render |
| AI coordinate accuracy | measured: free polygons −9 % on A-10; the id-picking design is M0 item 3, with free polygon + snap as the fallback and the snapped share driving confidence |
| Raster / scanned sets | manual mode, no OCR in Stage 1 |
| Very large sets | 150-page cap with a clear error, per-page steps, lazy 144 dpi renders, 95 MB per upload (split larger sets; chunked upload P1) |
| Memory | one pdf.js document per tick, ≤ 2 concurrent steps, renders on disk; measured in M0 |
| Cost | `PlanAiCall` records real spend; `TAKEOFF_AI_MAX_USD` stops a runaway job with a readable reason |
| Vertical pipe | never measured; an explicit allowance line per system, confirmed in validation |
| Fittings | allowance only, labelled; counting is P1 |
| Concurrent reviewers | per-row review, `updatedAt` optimistic concurrency, analyse refused while a job runs, regeneration keeps reviewed lines |
| Revision confusion | measurements FK the exact sheet row; `stale` flag; supersedes link; comparison P2 |
| AI unavailable | every AI step is skippable; the takeoff opens in manual mode |
| Reading the plan PDF from this laptop | macOS refused reads of the 3310 file mid-session (every tool, including Richard's own `cp` through the session); the file needs a Finder copy — unrelated to the design, noted so the M0 run is not blocked by it |

---

## The final question

> If our immediate objective is to upload a construction plan set and
> generate an accurate, reviewable roofing or plumbing material list that
> can be sent to a supplier for pricing, what is the simplest architecture
> that gets us there reliably without overengineering the system?

Store the PDF as a File. Index each page once, with code, into positioned
text, vector segments and a PNG, through a small table-driven tick queue
that needs no new process. Let code read sheet numbers, scales and dimension
strings and prove the scale by dimension-line agreement. Let Claude do only
the interpretive labelling — which sheet is which, which drawn lines form a
labelled 3" sanitary run, which closed region is the roof, what the schedule
says — by picking ids from what code already extracted and drew on the image,
and have it return ids and a one-line reason, never a number. Let code
compute every length, area, count, waste and package from those ids with the
calibration snapshotted on each measurement. Keep a per-row review status
with evidence pointing back to the sheet, derive material lines from a rules
table exactly like the existing roofing engine with allowances labelled as
such, and export the approved lines as an RFQ file through the File, PDF and
CSV seams the CRM already has. No queue daemon, no new storage, no catalog,
no pricing, no chat; two npm packages, five migrations, one nginx line. Ship
the manual tool (M1 + M2) before any AI: it is useful on its own and it is the
fallback for every scanned set.
