# CAREYOS_GITHUB_INTELLIGENCE_ROADMAP

_Plan-mode research and architecture, 2026-10-07. Read-only: no CareyOS code modified, nothing installed, nothing copied. Every licence, star count and last-push date was read from the GitHub REST API or the repository's LICENSE file on 2026-10-07; figures marked est. are estimates from the prod facts recorded in CLAUDE.md and are stated so they can be checked._

## 1. Executive Summary

**The finding.** CareyOS already has a complete operational record from lead to payroll and a handful of engines (workflows, tasks, calendar, field labour, contracts, G702 billing, permits, violations, roofing takeoff) that are better than their open-source equivalents. What it lacks is the financial spine that turns that record into decisions: cost codes on money rows, budget buckets with a forecast, commitments derived from documents, an estimate baseline tied to actuals, and a learning loop. No open-source project supplies that spine in a form a proprietary Next.js app can use; the construction ERPs are copyleft and heavy, the construction-specific repos are months old with a bus factor of one, and every pretrained floorplan or construction-vision model is non-commercial or AGPL.

**What open source does give, and should be adopted (all permissive):** a Postgres-only job queue (pg-boss), the PDF engine already in the CRM extended to vector geometry (pdf.js), a maintained PDF sealing/form library (LibPDF), a vehicle-routing solver that runs as a child process (VROOM), an MIT Gantt to draw a schedule the CRM computes itself (SVAR or DHTMLX), robust statistics (simple-statistics), spatial data (PostGIS, Turf, ArcGIS REST), Florida's public parcel, flood and LiDAR data, the Anthropic SDK with zod structured outputs, and IRR/XIRR arithmetic (`financial`/formulajs). Fifteen projects are worth integrating directly; a further fifteen are worth studying for their data models only.

**What should not be adopted:** any AGPL/GPL code linked into CareyOS (OpenConstructionERP, Bidwright, OCA, Paperless-ngx, Documenso, Ultralytics YOLO, PyMuPDF, xeokit, ParadeDB), non-commercial datasets and weights (CubiCasa5k, FloorPlanCAD, MOCS, LayoutLMv3, CWICR), external orchestrators and embedded BI (Temporal, n8n, Windmill, Superset, Metabase), agent frameworks, self-hosted geocoders and routers, and above all autonomous permit submission, LLM-priced estimates and auto-applied norm changes.

**The roadmap** is seven phases inside existing CRM models: Phase 0 foundations (queue, money cleanup, cost-code tree, dormant `lib/ai`), Phase 1 quick wins (typed daily-log entries, health score, snapshots, Property + Jurisdiction, e-sign seal, code suggestions), Phase 2 financial intelligence (the five picks from the OpenConstructionERP analysis), Phase 3 estimating intelligence (roofing norms, learning loop, price quotes, plan takeoff), Phase 4 operational automation (permit packets and 553.792 clocks, invoice intelligence, CPM, dispatch, equipment), Phase 5 advanced AI (LiDAR roof PoC, takeoff proposals, bounded document agent), Phase 6 predictive intelligence (redevelopment discovery, learned durations and turnaround, vendor scorecards, margin cohorts). The 30/90/180/365 plan and the twelve direct answers close the report.

**The two 10X bets** are real-time profit forecasting on every job (14 of 17 open billable jobs have no budget today) and the estimate-to-actual learning loop over hours the field already books by cost code; the strongest moat is a Property-keyed history across leads, jobs, permits, roof measurements, prices and crews that no competitor can buy.

## 2. CareyOS Architecture

Next.js 16.2.3 App Router, React 19, Prisma 7 on PostgreSQL (pool 8/2 on a shared cluster), zod `validateBody` in 150 route files, `@react-pdf/renderer` (13 renderers), MailerSend, Twilio (outbound only), Open-Meteo, Mapbox Search + Leaflet/OSM, pdfjs-dist for Roofr reports. One app on one DigitalOcean droplet under systemd (`knuco`, port 4000) behind Cloudflare; uploads on local disk through one storage seam (`src/lib/files/storage.ts`); no queue, no worker, no object storage; 12 cron routes behind `x-cron-secret` driven by crontab wrappers. Identity is CareyOS portal SSO introspected per request (`src/lib/sso.ts`, `src/lib/auth/helpers.ts`); seven roles plus four DB grants; explicit role lists per module (`src/lib/access/*`, per-module `access.ts`); own-only roles get 404 outside their lists. Audit through `recordAudit` (72 caller files). 126 models, 346 route files, 180 test files (1,536 tests). No AI anywhere in the CRM; the Anthropic SDK is used in closing-brain (five agents behind a Human Approval Center, structured outputs), knu-phone-routing (voicemail summary) and fl-buyback-docs.

Fleet: the portal is identity only (two tables, app registry in code); cc-allocator posts card/bank money to QBO, Buildium and the CRM with rule-based categorisation and no AI; the live roofing estimator at `roofing.careyos.com` still holds the estimate builder, supplier invoices and the calibration loop the CRM has not absorbed; landdev-analyzer holds parcels, zoning scenarios and a feasibility PDF on PostGIS; rentals, STR, closing-brain and the title engine are separate; `homedepotscraper` and `fairfield` are empty directories; `constructioncrm.old` is a dead ancestor.

## 3. Existing Capability Map

| Area | State | Notes |
|---|---|---|
| Organisations / companies | Single company | No tenant entity; the portal grants per-app roles by email |
| Customers / contacts / properties | Absent as entities | `Lead` is customer + property; address strings join six `Property` tables across the fleet |
| Leads | Strong | Stages, sources, duplicate check, nurture engine (off), canvassing with Zylow scoring and route optimiser, tracked links, response metrics |
| Projects / jobs | Strong | FIXED_PRICE / COST_PLUS / OWNED_REHAB, overview, health, timeline, delete with blockers |
| Estimates | Partial, duplicated | Two families (`RoofEstimate` lump materials; template `Estimate` lines); no resource kind, no cost code, no takeoff consumer |
| Proposals | Partial | Estimate PDFs regenerated from live data; no proposal entity |
| Contracts | Strong | Versioned templates, snapshot, single-use token signing, SHA-256 certificate, money effects, void |
| Change orders | Strong (customer side) | Token approval, SOV line on PROGRESS jobs, labour COs; positive prices only; no cost side by code |
| Invoices / payments | Strong | Lump-sum (no lines) + G702/G703 with retainage release; one `balanceDue` writer; A/R aging |
| Vendors / subcontractors | Good | Vendor + aliases + matching on every expense write; compliance derived on read; commitments; labour contracts with schedule lines and payment requests. No PO, pay app, retention ledger, lien waiver |
| Employees | Good | Personnel with encrypted SSNs, pay types, crews, documents |
| Tasks / workflows | Strong | One create/update path; versioned workflow generations; gates; stage sync; catch-up; reports |
| Calendar / scheduling | Good / absent | Dispatch calendar; no Gantt, durations, CPM or VRP |
| Notifications / email / SMS | Good / partial | v2 digests recording (switch off); Twilio outbound only, inbound webhook unreachable; Outlook intake unscheduled |
| Documents / storage / generation | Good | Job-owned files, preview, missing state, receipts, gallery, `GeneratedDocument` protection; local disk only |
| Integrations / webhooks | Partial | cc-allocator (in/out), Zapier Roofr orders, phone routing (keyless), Zylow, QBO CSV only; no outbound webhooks |
| Background workers | Cron only | No queue; long work runs in the request |
| Reporting / dashboards | Good | Attention rows (count = list), funnel, workflow, financials, field labour; `DashboardMetricSnapshot` unused; no cost history |
| Accounting | Partial | Expense approval gate, payroll posting, QBO CSV; books live in QBO via cc-allocator |
| Roofing | Strong P0 | Parser, measurements, rules, price book; estimate builder (P1) and calibration (P2) pending |
| Plumbing / renovations / W&D | Thin | Template estimates and workflow trades only |
| Permits / inspections | Strong | One record, workflow effects, alert tasks, fees from costs |
| Code violations | Strong | Cases, items, hearings, agency inspections, fines, deadlines; reports stage pending |
| Property management / real estate / development | Outside the CRM | rentals, STR, landdev-analyzer, equifirst-site; no IRR/draw/proforma anywhere |
| GIS / property data | Partial | Zylow enrichment, Leaflet/OSM, Mapbox autofill; no PostGIS in the CRM (landdev has it) |
| Purchasing / inventory / equipment | Absent | Expense types only |
| Field operations / mobile | Strong | `/field` shell, daily logs, GPS clock-in/out, OT, payroll, photos, issues, offline drafts; no PWA |
| Analytics | Partial | KPIs and charts; no snapshots, no cohorting beyond canvassing |
| AI | Absent | — |

## 4. Operational Gaps

**The fifteen determinations.**
1. **Does**: lead-to-cash for a residential GC with field payroll and compliance (the map above).
2. **Well**: workflows/tasks/calendar, field labour, contracts/billing, permits/violations, access control, pure engines with tests.
3. **Partial**: roofing P1/P2, notifications 3–4, violations reports, Twilio inbound, Outlook intake, budget allocations, lump-sum invoice lines, QBO export.
4. **Overlaps**: estimate families; four automation generations (FollowUpRule, auto-tasks, nurture, alert runs); permit models; notification tables; photo stores; date fields on jobs.
5. **Duplicated**: two calculators/renderers/brand loaders; `getFinancialSummary` beside `computeCostSummary`; expense enums in four places; materials catalogues ×3 and property tables ×6 across the fleet.
6. **Abandoned**: `AiSession`, `PasswordResetToken`, `DashboardMetricSnapshot` (unused, to be repurposed), `Inspection`, `PermitLookupRun`, `follow-up-tick.sh`, `/admin/follow-up-rules`, knu-estimator, homedepotscraper.
7. **Collected but underused**: per-worker daily hours by cost code; daily-log weather and delay text; photos with GPS; workflow step timing; permit timing by jurisdiction; contract snapshot vs actuals; Roofr geometry vs materials bought; roofing price history; lead response metrics; canvassing outcomes; audit trail. (Section 22.)
8. **Excessive manual work**: typing the roofing material cost; building a budget by hand (14 of 17 open billable jobs have none); allocating expenses to budget lines; reconciling cc-allocator twins; chasing subcontractor COIs; entering supplier prices; permit applications on municipal portals; daily-report emails to owners; re-entering supplier invoices as expenses.
9. **Double entry**: estimate → job contract (seeded from `Lead.estimatedJobValue`, not the estimate); roofing takeoff → `RoofEstimate.materialCost`; labour contract schedule lines → payment requests → payments; expense type vs cost code vs budget category; address into Lead, Prospect, CanvassingProperty, violation parcel; vendor as payee text and as `Vendor`.
10. **Information not turned into intelligence**: nothing computes cost per square by roof type/pitch/crew, permit turnaround by municipality, crew productivity, vendor price drift, estimate-vs-actual by trade or margin trend.
11. **AI with measurable value**: cost-code and vendor suggestions on expense and invoice lines; invoice/receipt line extraction; scope extraction from lead text; delay/change signals from daily-log text; owner report summaries; plan sheet and scale proposals; "jobs like this one" (which needs no AI at all).
12. **Deterministic is better**: every money figure; budget buckets, ETC/EAC, margin; retention, waivers, lien dates; CPM and slippage; dispatch optimisation; price comparison; compliance gates; twin detection; productivity factors.
13. **Financial visibility gaps**: no cost-to-complete or EAC; no budget by code; no committed-from-documents; no cost history or margin trend; no sub pay-app position; no price history outside roofing; no cash-requirement forecast.
14. **Operational visibility gaps**: no critical path or slippage; no material delivery status; no equipment whereabouts; no crew utilisation; no punch-list items; no RFI; delays only as free text.
15. **Where it could decide, not just record**: which crew and day for an install (skills, licences, distance, windows); which supplier package to buy; which jobs are eroding margin; which permits are about to lapse (done); which leads to call first (partly done); which estimate assumptions to revise.

**Lifecycle coverage (the operating model).**

| Stage | CareyOS today | Gap |
|---|---|---|
| Lead | `Lead` with stages, sources, nurture, canvassing promotion | — |
| Property | Address fields on `Lead`; Zylow/REAPI mirror on canvassing | No property entity; no parcel/APN; no history across jobs at one address |
| Customer | Same row as the lead | A repeat customer is a duplicate-flagged lead |
| Site information | Lead notes, photos, Roofr report | No structured site survey |
| Inspection (pre-sale) | Field photos, Roofr order via Zapier | No pre-sale inspection form |
| Measurements | `RoofMeasurement` (ROOFR / MANUAL / FIELD) | Roofing only; no plan measurements |
| Scope | Lead services, template sections | No scope entity; inclusions/exclusions live in estimate text |
| Takeoff | Roofing engine preview | No consumer; nothing for other trades |
| Estimate | Two families | No resource split, cost codes, markup cascade, snapshots |
| Proposal | Estimate PDF | No proposal entity, options or acceptance analytics |
| Contract | Customer contract with e-sign | No cryptographic seal or timestamp |
| Permit | Permits + inspections + alert tasks | Applications by hand on portals; no document package; no statutory clocks |
| Project | Job with workflow, overview, health | — |
| Schedule | Calendar + workflow business-day dates | No durations/CPM/critical path |
| Procurement | None | No PO, quotes, deliveries |
| Subcontractors | Labour contracts, payment requests, compliance | No pay apps, retention ledger, waivers, scorecards |
| Field operations | Daily logs, labour, photos, issues | No typed entries, punch items, equipment, materials received |
| Inspections (permit) | One record with workflow effects | — |
| Change orders | Customer + labour COs | No cost side by code; no detection from field text |
| Billing | Lump-sum + G702 | — |
| Actual cost | Expenses, labour, field labour, payroll | No cost codes; no committed-from-documents |
| Closeout | "Close the job" step; review request email | No closeout checklist, warranty record, final waivers |
| Warranty | None | No warranty entity or claims |
| Profitability | Cost summary card, Collections | No forecast, no history, no by-trade/estimator/PM cuts |
| Historical learning | None | The whole loop |

## 5. GitHub Research Methodology

Five parallel read-only sweeps covered the 22 categories (A/J/I/H/O; B/C/R/D; E/F/G/N/T; K/L/M/U; P/Q/S/V). For every candidate: repository metadata from the GitHub REST API (`/repos`, `/license`, `/commits`, `/releases/latest`, `/contributors`, security advisories), the LICENSE file read directly where the API returned NOASSERTION, model-weight licences from the Hugging Face API, and source or schema files via raw.githubusercontent.com. Nothing was cloned into any CareyOS repository and nothing was executed. Each kept repository received a scorecard (purpose, licence colour, last meaningful activity, maintainers and bus factor, stars/forks as secondary signals, architecture and language, deployment complexity against a single Next.js droplet, CareyOS overlap, useful functionality, integration path, direct-reuse and independent-implementation verdicts, security concerns, maintenance risk, business value, difficulty, maturity class) and seven 1–10 scores: BUSINESS VALUE, TECHNICAL QUALITY, MATURITY, CAREYOS FIT, MAINTAINABILITY, INTEGRATION EASE, STRATEGIC VALUE; and one classification: ADOPT · INTEGRATE · BORROW CONCEPTS · REIMPLEMENT · WATCH · REJECT. Maturity classes: PRODUCTION QUALITY · PROMISING · EXPERIMENTAL · ABANDONED · DEMO. Licence colours for a proprietary SaaS: GREEN permissive (MIT, Apache-2.0, BSD, ISC, PostgreSQL, CDLA-Permissive, CC BY, US public domain); YELLOW usable with a condition (MPL file-level, LGPL dynamic, GPL across a process boundary, ODbL attribution/share-alike on derived databases, restricted weights, source-available field-of-use terms); RED (AGPL or GPL linked, SSPL, BUSL, non-commercial, no licence). OpenConstructionERP was analysed separately on the same day and is referenced, not repeated.

Statute and data sources consulted for Florida: Fla. Stat. 553.79, 553.792, 713.13/713.135, 713.20, 668.50; FDOR statewide parcels and FGIO FeatureServer; FEMA NFHL; USGS 3DEP and FDEM Florida Peninsular LiDAR; DBPR licensee extracts; Accela developer documentation; EagleView's published accuracy studies; Google Solar API policies.

## 6. Top 25 Repositories

Composite = sum of the seven scorecard axes (max 70).

| # | Repo | Category | Licence | Classification | One-line reason | Composite |
|---|---|---|---|---|---|---|
| 1 | pg-boss | Queue / orchestration | MIT GREEN | ADOPT | Postgres-only queue with cron, retries, singleton keys, dead-letter; replaces 12 crontab HTTP crons with one `careyos-worker` unit; 0 advisories | 63 |
| 2 | pdf.js (pdfjs-dist) | PDF / takeoff | Apache GREEN | ADOPT (extend) | Already in the CRM; `getOperatorList` gives exact vector geometry, `getTextContent` gives scale notes, sheet ids, schedules | 63 |
| 3 | @anthropic-ai/sdk | AI | MIT GREEN | ADOPT | `messages.parse` + zod output is the whole AI layer; no framework earns its place | 63 |
| 4 | simple-statistics | Risk / analytics | ISC GREEN | ADOPT | Median/MAD robust z-scores and regressions for health score, price drift, productivity factors | 60 |
| 5 | PostGIS | GIS | PostgreSQL extension (GPL-2 code, no app contamination) GREEN | ADOPT when Property polygons arrive | Point-in-polygon jurisdiction, parcel geometry, setbacks; DigitalOcean managed supports it | 60 |
| 6 | Turf.js | GIS | MIT GREEN | ADOPT | Negative buffers, areas, distances in TS without a DB round-trip | 59 |
| 7 | Leaflet | Maps | BSD-2 GREEN | ADOPT (keep, pin 1.9.x) | Already the renderer; Mapbox GL JS v2+ is proprietary and rejected as a renderer | 58 |
| 8 | VROOM | Routing / dispatch | BSD-2 GREEN | INTEGRATE | C++ child process, JSON in/out, skills, time windows, breaks, custom matrix; one maintainer | 56 |
| 9 | LibPDF `@libpdf/core` | Signing / forms | MIT GREEN | ADOPT | PAdES B-B/T/LT/LTA seal, AcroForm fill/flatten; replaces unmaintained pdf-lib; young, bus factor 1 (Documenso depends on it) | 56 |
| 10 | unpdf | Documents | MIT GREEN | ADOPT | Text-layer extraction for the invoice pipeline's digital-vs-scanned test | 54 |
| 11 | PDAL | Roofing LiDAR | BSD GREEN | INTEGRATE | Clips 3DEP EPT/COPC tiles for the roof measurement PoC | 52 |
| 12 | `financial` / formulajs | Development | MIT GREEN | INTEGRATE | Excel-compatible IRR/XIRR with checked tests; never IRR by LLM | 51 |
| 13 | pgvector (+ pgvector-node) | Search | PostgreSQL GREEN | ADOPT (deferred) | "Jobs like this one" and document search once FTS + pg_trgm stop being enough | 51 |
| 14 | ArcGIS REST JS | GIS data | Apache GREEN | INTEGRATE (or a 100-line fetch client) | FDOR parcels, county appraiser, FEMA NFHL feature services | 50 |
| 15 | OpenTakeoff | Plan takeoff | Apache GREEN | BORROW CONCEPTS + selective REIMPLEMENT | `detectScale()` text parser, per-sheet calibration, AGENT vs APPROVED review states, schedule reading; two contributors, four months old | 49 |
| 16 | SVAR React Gantt | Scheduling | MIT core GREEN | ADOPT | Draw-only Gantt; CPM computed server-side in-house (no permissive CPM lib exists) | 49 |
| 17 | pdfplumber | Plan takeoff | MIT GREEN | BORROW CONCEPTS (port to TS) | Table heuristics for window/door/fixture schedules, the highest-value recognition for these trades | 48 |
| 18 | Microsoft GlobalMLBuildingFootprints | Roofing LiDAR | CDLA-Permissive-2.0 GREEN | INTEGRATE (seed only) | Footprint seed for the LiDAR clip; IoU 63–68%, never the measurement | 48 |
| 19 | PaddleOCR (ONNX in Node) | OCR | Apache GREEN | INTEGRATE | Scanned plans and receipt photos without a Python service | 47 |
| 20 | Protomaps PMTiles / basemaps | Maps | BSD-3 GREEN | INTEGRATE | Self-hosted FL parcel, flood and surge overlay tiles via tippecanoe | 47 |
| 21 | roofer (3DBAG) | Roofing LiDAR | GPL-3.0 YELLOW | INTEGRATE (subprocess only, never linked) | LoD2.2 planar faces from LiDAR; process boundary keeps the CRM proprietary | 46 |
| 22 | DBOS Transact | Orchestration | MIT GREEN | BORROW CONCEPTS | Checkpointed steps for long jobs inside pg-boss handlers | 46 |
| 23 | pdfme | Forms | MIT GREEN | INTEGRATE (pinned, admin-only designer) | Overlay for non-fillable permit forms; 6 advisories 2025–26, no URL base PDFs | 45 |
| 24 | @signpdf | Signing | MIT GREEN | INTEGRATE (fallback) | Second seal path if LibPDF's bus factor bites | 45 |
| 25 | Traccar | Fleet | Apache GREEN | INTEGRATE (optional, off-internet) | Truck and skid-steer GPS via Teltonika-class devices; 28 advisories, patch past 6.13.3 | 42 |

Equal alternatives held in reserve: Graphile Worker (MIT) for pg-boss; DHTMLX Gantt (MIT since v10.0.0, June 2026; pin and keep the LICENSE copy) for SVAR; MapLibre GL JS (BSD-3) for landdev-analyzer; OpenFreeMap (MIT code/ODbL data) as basemap; tesseract.js (Apache) as receipt pre-classifier; MCP SDK for read-only CareyOS tools later; Playwright (Apache) only for opt-in read-only permit status polls; US Census Geocoder (public domain) for batch geocoding and FIPS.

**Study but do NOT integrate.**

| Repo | Licence | What to take (concepts only) |
|---|---|---|
| OpenConstructionERP | AGPL + PyMuPDF + CC BY-NC data | Financial shapes already extracted in the OCE analysis; not a byte of code |
| Bidwright | AGPL | Assembly model: typed parameters, quantity expressions, `TakeoffLink` measurement→line with multipliers, insert-time snapshots |
| OCA/field-service, Beveren FSM | AGPL | Visit/appointment window separate from the task; skills + licences with expiry; signature at the door; recurring service agreements |
| ERPNext, Odoo CE/OCA, Tryton | GPL / LGPL+AGPL / GPL | Three budget gates Stop·Warn·Ignore; PO line received/invoiced/to-invoice; order points with provisioning location; post-approval PO amendment |
| Paperless-ngx | GPL | `MATCH_*` matcher enum + learn-from-corrections → `MatchRule` on vendors and cost codes |
| invoice2data | MIT (Python) | Per-vendor extraction hints → `VendorExtractionHint` |
| Documenso | AGPL + `ee` | Envelope flow, P12 sealing order, audit certificate layout; implemented natively on LibPDF |
| ibuilder/massing | MIT, bus factor 1 | Cost spine integrity check, commitment types, G703 cents; do not copy its four formula flaws |
| MassingCloud/massingbill | MIT, one week old | Retention policies with stepped reductions; waiver templates versioned per state; compliance-blocks-payment; its Florida 713.20 note looks wrong (counsel to confirm) |
| BuildSuite buildsuite_core | MIT on GPL ERPNext | `construction_rate_history` shape for price history; claimed vs certified pay lines; advance recovery |
| joburke1/tdranalysis | CC0 | Per-district rules JSON with ordinance section + effective date + corrections workflow → permit and zoning rule tables |
| Shelf.nu, Snipe-IT, Atlas CMMS | AGPL | Custody ledger by QR, date-range bookings with conflicts, meter-triggered maintenance → tasks |
| InvenTree | MIT, 32 advisories | Stock ledger shape; integrate only if a real warehouse appears |
| OpenProject | GPL | Manual vs automatic scheduling modes with pinned dates and lag |
| LangGraph, Mastra | MIT / Apache + source-available `ee` | Checkpoint/interrupt and suspend/resume for the approval centre |
| Docassemble | MIT, heavy | Interview → variables → template as a Next.js permit wizard |
| pmcontrols, bc-construction-management | MIT / none | Textbook ETC/EAC wording |
| Real Estate DataMap, pyforma | MIT / BSD | Phased site plan, frontage classes, pro forma input structure (landdev) |

## 7. Repository Scorecards

Scores in the order value / quality / maturity / fit / maintainability / integration / strategic. Maturity: PQ production quality, PR promising, EX experimental, AB abandoned, DM demo.

| Repo | Licence | Activity (2026) | Maintainers | Deploy beside Next.js | Security notes | Maturity | Scores | Class |
|---|---|---|---|---|---|---|---|---|
| pg-boss | MIT | 12.37.0 on 10-05, 4.0k★ | one (timgit, 1.6k commits) | npm + own schema in the same Postgres; worker unit | 0 advisories; no network surface | PQ | 8/8/8/10/7/9/8 | ADOPT |
| Graphile Worker | MIT | 0.18.0 on 09-08 | benjie | Postgres LISTEN/NOTIFY | 0 | PQ | 7/9/7/9/7/8/7 | INTEGRATE (alt) |
| DBOS Transact TS | MIT | v5.2 09-29 | company | library | 0 | PR | 6/8/6/6/6/6/6 | BORROW |
| Hatchet | MIT | active | company | Go + Postgres (+ MQ) | 8 advisories | PR | — | WATCH |
| Temporal | MIT | 23.5k★ | company | multi-service cluster | 0 | PQ | — | REJECT (size) |
| Trigger.dev | Apache | 16.5k★ | company | Postgres + Redis + ClickHouse + Electric + MinIO | 38 (2 critical) | PQ | — | REJECT self-host |
| Inngest | **SSPL** server | — | company | Go | 0 | PQ | — | REJECT |
| n8n | **Sustainable Use** | 207k★ | company | Node + Docker | **210 (22 critical)** | PQ | — | REJECT |
| Windmill | **AGPL** + EE | 18.1k★ | company | Rust + Postgres | 5 | PQ | — | REJECT |
| Activepieces | MIT core | 24.9k★ | company | Node + Postgres + Redis | 9 (1 critical: unauthenticated dashboard) | PQ | — | WATCH |
| BullMQ / Node-RED / Kestra / Prefect / Dagster | MIT / Apache | — | — | Redis / IoT / Java / Python | Kestra 33 (5 critical) | PQ | — | REJECT (fit) |
| VROOM | BSD-2 | v1.15.0 03-12, push 10-05, 1.9k★ | one (jcoupey) | binary as child process; custom matrix | subprocess only; vroom-express has no auth | PQ | 8/8/8/9/7/8/8 | INTEGRATE |
| OR-Tools | Apache | 14.2k★ | Google | Python sidecar (no Node bindings) | localhost | PQ | 7/9/9/6/6/4/8 | WATCH |
| PyVRP | MIT | 10-06 | academic | Python sidecar | — | PR/PQ | 6/9/7/5/7/4/6 | WATCH |
| jsprit | Apache | maintenance mode | one | JVM | — | PQ stale | 5/7/7/4/4/3/3 | REJECT |
| Timefold Solver | Apache | active; Python port archived 07-2025 | company | JVM | — | PQ | 6/9/8/4/6/3/5 | WATCH |
| Valhalla / OSRM / GraphHopper | MIT / BSD-2 / Apache | active | orgs | heavy self-host of a FL extract; no traffic data | — | PQ | 6/8/9/6/6/5/6 | WATCH |
| SVAR React Gantt | MIT core (PRO paid) | v2.8.0 10-07, 212★ | vendor | npm | — | PR | 7/7/6/9/6/8/7 | ADOPT |
| DHTMLX Gantt CE | MIT since v10 | v10.0.3 09-03, 1.9k★ | company | npm | — | PQ | 7/8/9/7/7/7/7 | ADOPT (alt) |
| frappe-gantt | MIT | slowing | Frappe | npm | — | PQ basic | 5/6/7/6/5/8/4 | WATCH |
| gantt-task-react | MIT, archived | 2024 | — | — | — | AB | — | REJECT |
| OpenProject / Plane / Leantime / Vikunja / Taiga | GPL / AGPL / AGPL / AGPL / MPL | active | — | separate apps | — | PQ | ~5/7/8/2/6/2/3 | BORROW / REJECT |
| OCA/field-service | AGPL | push 10-07, 199★ | OCA | whole Odoo | inherits Odoo | PQ | 7/7/8/3/6/1/6 | BORROW |
| ERPNext | GPL-3 | v15.122.0 10-07, 39.9k★ | Frappe | heavy bench | 89 advisories (09-20 stored XSS) | PQ | 7/8/9/4/8/4/6 | BORROW |
| Odoo CE / OCA | LGPL / AGPL | daily, 54.9k★ | Odoo SA | separate service | — | PQ | 6/8/9/3/8/3/5 | BORROW |
| Tryton | GPL-3 | 10-06 | foundation | Python | — | PQ | 5/8/8/3/7/2/4 | BORROW |
| OCA/vertical-construction | AGPL | one BC3 importer; 17+ empty | — | — | — | AB | — | REJECT |
| ibuilder/massing | MIT | push 10-02, created 06-14, 122★ | one (+ AI) | Docker 5+ services | unknown; bug-history in commits | EX/PR | 7/5/3/5/3/2/6 | BORROW / WATCH |
| MassingCloud/massingbill | MIT | 08-16, 0★ | one | Flask + Postgres | CodeQL/Semgrep; untested | EX | 7/6/2/6/2/3/6 | BORROW |
| BuildSuite buildsuite_core | MIT on ERPNext | 10-07, 19★ | one | bench | — | PR | 5/6/4/4/4/2/5 | BORROW / WATCH |
| cepho suite | none | 05-20 dump | — | — | — | DM | 4/4/1/3/1/1/3 | BORROW (fields) |
| pmcontrols | MIT | 06-22, 5★ | one | Python | — | EX | 4/6/2/3/2/2/3 | BORROW |
| Akaunting / Dolibarr / metasfresh / Twenty | BUSL / GPL / GPL-2 / AGPL | — | — | — | Dolibarr critical RCE 04-2026 | — | — | REJECT |
| InvenTree | MIT | 1.5.6 09-26, 7.7k★ | two | Django + worker | 32 (09-08 auth bypasses) | PQ | 6/8/8/5/8/6/6 | BORROW / INTEGRATE later |
| OpenBoxes | EPL-1.0 | 10-07, 910★ | PIH | JVM | 3 high 07-07 (SSTI RCE, SSRF) | PQ | 3/6/7/2/6/2/2 | BORROW |
| Snipe-IT | AGPL | v8.8.0 09-30, 15k★ | company | PHP | 86 (08-24 RCE, 08-26 company isolation) | PQ | 4/6/8/3/6/3/3 | BORROW |
| Traccar | Apache | v6.16.0 09-27, 7.8k★ | one | JVM, device ports | 28 incl. CVE-2026-52851 (fixed >6.13.3) | PQ | 6/7/9/6/6/6/6 | INTEGRATE opt. |
| Atlas CMMS / Shelf.nu / Fleetbase | AGPL | active | one / company / company | — | 2 / 19 (cross-org IDOR) / — | PR / PQ / — | 5/6/5/3/4/2/4 ; 6/7/7/4/6/2/5 | BORROW / REJECT |
| OpenTakeoff | Apache | push 10-06, created 06-17, 161★ | two | Node only | client-side OCR; check transitive deps | PR | 8/7/5/8/6/7/8 | BORROW + REIMPLEMENT |
| Bidwright | AGPL | 10-02, 61★ | one | TS/Prisma | — | PR | 7/6/4/7/4/1/6 | BORROW |
| open-construction-codes | CC BY 4.0 | 07, 3★ | — | data | — | EX | 3/4/2/4/3/8/3 | WATCH |
| pdf.js | Apache | push 10-07, 54k★ | Mozilla | already in CRM | `isEvalSupported:false`, pin major | PQ | 9/9/10/10/9/10/9 | ADOPT |
| pypdfium2 | Apache/BSD | 10-05 | team | Python | — | PQ | 5/8/8/4/8/5/5 | WATCH |
| pdfplumber | MIT | 08, 10.8k★ | one | Python | — | PQ | 6/8/9/5/8/4/6 | BORROW |
| PyMuPDF | **AGPL** | — | Artifex | — | — | PQ | — | REJECT |
| pdf-lib | MIT | last real commit 11-2021 | none | npm | malformed-PDF failures | AB | 6/7/4/6/2/9/3 | REJECT (use fork/LibPDF) |
| LibPDF `@libpdf/core` | MIT | push 10-07, created 01-2026, 1.8k★ | Documenso (Mythie) | pure TS | young parser on untrusted input; pin | PR | 8/8/5/9/6/9/8 | ADOPT |
| @signpdf | MIT | 3.3.0 12-2025, commit 10-02 | one | npm | 0 | PQ | 7/7/8/8/6/8/6 | INTEGRATE (fallback) |
| pdfme | MIT | 6.2.4 10-06, 4.9k★ | one | npm | 6 (SSRF basePdf URL, XSS, zip bomb, sandbox escape) | PQ | 7/7/7/8/6/8/7 | INTEGRATE (pinned) |
| ezdxf / dxf-parser / dxf-viewer / libredwg | MIT / MIT (stale) / MPL / GPL | — | — | Python / Node / WebGL / C | — | PQ / PR / — / — | 4/9/9/4/8/4/4 ; 4/6/6/6/4/8/4 | WATCH / WATCH / WATCH / REJECT |
| IfcOpenShell / web-ifc / xeokit | LGPL / MPL / AGPL | active | orgs | — | — | PQ | ~2/—/—/2/—/—/3 | WATCH / WATCH / REJECT |
| Floorplan models (CubiCasa5k, HEAT, FloorPlanCAD, DeepFloorplan, RoomFormer, ConstructDrawingAI, YOLOplan) | CC BY-NC / NC / CC BY-NC / GPL / MIT-on-NC-weights / PolyForm-NC / AGPL | — | — | GPU | — | — | ~3/—/—/2/—/2/— | REJECT (RoomFormer: concepts) |
| PaddleOCR / Tesseract / docTR / EasyOCR / Surya | Apache ×4 / weights OpenRAIL-M | active | orgs | ONNX in Node / WASM / Python / Python | — | PQ | 6/8/9/6/7/7/6 (Paddle) | INTEGRATE / fallback / WATCH / WATCH / WATCH |
| Ultralytics YOLOv8/11, YOLOv9, YOLOv10 | AGPL / GPL / AGPL | — | — | GPU | — | PQ | 6/9/10/3/8/2/3 | REJECT |
| RF-DETR | Apache (N/S/M/L; others PML) | 10-07, 9.7k★ | Roboflow | Python, ONNX export | — | PQ | 6/8/7/5/7/5/7 | WATCH → INTEGRATE with own data |
| YOLOX / RT-DETR / Detectron2 / PaddleDetection / GroundingDINO | Apache | varied | orgs | Python | — | PQ/PR | — | WATCH / BORROW (pre-labelling) |
| SAM / SAM2 / SAM3 | Apache / Apache / custom | — | Meta | GPU preferred | — | PQ | 6/9/8/5/6/4/6 | WATCH |
| roofer (3DBAG) | GPL-3 | v1.0.0 04-20, push 07-30, 203★ | 3DGI / TU Delft | C++ CLI subprocess | isolated unit | PQ (NL) / EX (FL) | 8/8/7/6/6/5/9 | INTEGRATE (subprocess) |
| PDAL / laspy / Open3D | BSD / BSD-2 / MIT | active | Hobu / — / Intel | batch | — | PQ | 7/9/9/6/9/5/8 ; 6/8/9/5/8/5/6 | INTEGRATE / WATCH |
| MS Building Footprints / Overture | CDLA-P-2.0 / ODbL | — | Microsoft / LF | data | — | PQ | 6/7/8/7/8/8/6 | ADOPT seed / WATCH |
| segment-geospatial / geoai | MIT | active | opengeos | Python GPU | — | PR | 5/6/6/4/6/4/5 | WATCH |
| RoofSense / PolyFit / roofn3d | MIT+CC BY / GPL / none | — | — | — | — | EX / — / AB | — | WATCH / REJECT / REJECT |
| Google Solar API | ToS: no caching except place IDs | service | Google | — | — | — | 7/—/—/4/—/—/4 | WATCH (live-only, counsel) |
| ODM / WebODM | AGPL | active | — | separate tool | — | PQ | — | WATCH |
| Docassemble | MIT | 1.10.13 10-02, 990★ | one | Docker Python/Celery/Redis | 4 advisories; server-side Python from YAML | PQ | 5/7/8/3/5/2/4 | BORROW |
| Playwright | Apache | 10-06, 97k★ | Microsoft | headless Chromium, own unit | 0; isolate | PQ | 4/10/10/4/4/7/3 | WATCH (status only) |
| docxtemplater / easy-template-x / Carbone | MIT-or-GPL / MIT / Carbone CL | active | — | Node (+LibreOffice for PDF) | 0 | PQ | 5/8/9/5/8/7/4 | WATCH / WATCH / REJECT |
| Accela Construct API / Shovels | commercial, agency-gated / commercial | — | — | — | OAuth per agency | — | 7/7/8/5/6/3/6 ; 4/7/7/3/8/7/4 | WATCH / WATCH |
| Stagehand / browser-use | MIT | — | — | LLM browser | nondeterministic | PQ | — | REJECT for submission |
| Paperless-ngx | GPL-3 | 10-07, 46k★ | community | Django/Celery/Redis/Tesseract | 16 | PQ | 6/8/9/3/8/1/6 | BORROW |
| docling | MIT | 10-07, 68k★ | IBM / LF AI | Python sidecar | **16 (10 in Sep–Oct 2026: SSRF bypass, local file read, path traversal)** | PQ | 6/9/8/4/7/3/6 | WATCH |
| unstructured | Apache | 15.5k★ | company | Python | critical SSRF 07-2026, critical path traversal 02-2026 | PQ | 4/7/8/3/6/3/3 | REJECT |
| marker / surya | Apache code, OpenRAIL-M weights (< $5M) | 40k / 21k★ | company | GPU | — | PQ | 5/9/7/3/6/3/3 | WATCH |
| MinerU | Apache + extra terms | 81k★ | — | GPU | — | PQ | — | REJECT (fit) |
| tesseract.js | Apache | v7 12-2025 | one | WASM in Node | 0 | PQ | 6/7/8/8/7/9/5 | INTEGRATE (optional) |
| OCRmyPDF | MPL | 35k★ | one | apt CLI | — | PQ | 5/9/9/6/8/6/4 | WATCH |
| invoice2data | MIT | 1.0.1 08-01 | dependabot mostly | Python | — | PR | 5/6/6/5/5/3/5 | BORROW |
| Donut / LayoutLMv3 | MIT inactive / CC-BY-NC-SA weights | — | — | GPU | — | AB / — | — | REJECT |
| unpdf | MIT | 08-14, 1.2k★ | unjs | Node | — | PR | 6/8/7/9/7/10/5 | ADOPT |
| pgvector | PostgreSQL | 0.8.7 10-01, 23k★ | ankane | extension | IVFFlat overflow just fixed; stay current | PQ | 7/9/9/10/9/8/8 | ADOPT (deferred) |
| ParadeDB pg_search / Qdrant / LanceDB | AGPL / Apache / Apache | — | — | — | — | — | — | REJECT (scale) |
| Vercel AI SDK | Apache | 27k★ | Vercel | npm | 6 | PQ | 5/8/8/7/7/8/5 | WATCH |
| LlamaIndex / LangChain.js / Mastra | MIT / MIT / Apache + `ee` | — | — | — | — | — | 5/8/7/5/6/6/4 (Mastra) | REJECT / REJECT / BORROW |
| Documenso | AGPL + `ee` | 10-07, 15k★ | company | Next.js/Prisma/LibPDF | 1 high 10-02 | PQ | 6/8/8/5/7/3/6 | BORROW |
| DocuSeal / OpenSign | AGPL | — | — | Ruby / Parse | 0 / 6 | PQ | — | REJECT |
| pyHanko | MIT | 778★ | one | Python CLI | — | PQ | — | WATCH (CI validation) |
| Docusign / Dropbox Sign | commercial ~$50–75/mo | — | — | API | — | — | — | WATCH (escape hatch) |
| Metabase / Superset / Grafana / Lightdash / Redash | AGPL+commercial / Apache / AGPL / MIT+ee / BSD | — | — | JVM / Python+Redis / Go / dbt / Python | 44 / Apache process / 28 / 46 / 20 | PQ | 6/8/9/4/6/4/4 (Metabase) | WATCH internal / REJECT ×4 |
| Evidence / Cube / Rill / DuckDB / ECharts | MIT / Apache / Apache / MIT / Apache | active | — | Node / Node / Go / lib / lib | 0 / 8 / — / 3 / — | PR / PQ | 5/7/6/6/6/6/4 (Evidence) | WATCH / BORROW / WATCH / WATCH / WATCH |
| PostGIS | GPL-2 ext | 10-07, 2.2k★ | OSGeo | PGDG package | parameterised spatial SQL | PQ | 9/10/10/8/9/6/10 | ADOPT |
| MapLibre GL JS / Leaflet / Mapbox GL JS | BSD-3 / BSD-2 / proprietary | v6.13 10-06 / 1.9.4 / — | foundation / community / Mapbox | npm | — | PQ | 7/9/9/6/9/7/8 ; 6/8/10/9/7/10/5 ; 4/9/10/3/8/8/2 | ADOPT (landdev) / ADOPT keep / REJECT renderer |
| OpenFreeMap / Protomaps | MIT+ODbL / BSD-3 | 10-04 / 09-16 | one / company | URL / static PMTiles | — | PR / PQ | 6/7/7/7/6/10/6 ; 7/9/8/7/8/8/8 | INTEGRATE / INTEGRATE |
| Nominatim / Photon / Pelias | GPL / Apache / MIT | active | — | needs Elasticsearch-class resources | public policy forbids autocomplete | PQ | 4/8/9/3/7/4/4 | REJECT now |
| Turf.js / H3 / ArcGIS REST JS / OpenAddresses / Overture | MIT / Apache / Apache / BSD (data varies) / MIT (data per theme) | active | — | npm / npm / npm / data / data | — | PQ | 7/8/9/9/8/10/7 ; 5/9/9/6/9/9/5 ; 7/8/8/9/8/9/7 | ADOPT / BORROW / INTEGRATE / BORROW / WATCH |
| Real Estate DataMap / tdranalysis / UrbanLayer / pyforma / UrbanSim / momepy / cityseer / pandana / ladybug | MIT / CC0 / AGPL (spec, no code) / BSD (2016) / BSD / BSD / AGPL / AGPL / AGPL | — | — | — | — | DM / EX / DM / AB / PQ / PQ / — / — / — | 4/6/2/4/3/3/4 ; 6/7/4/6/4/4/7 | BORROW / BORROW / REJECT / BORROW / WATCH / WATCH / REJECT / REJECT / REJECT |
| numpy-financial / `financial` / formulajs / finance.js | BSD / MIT / MIT / MIT (2023) | — | — | Python / TS / JS / — | — | PQ / PR / PQ / AB | 5/8/9/3/8/4/4 ; 6/7/6/9/6/10/5 ; 6/7/8/8/7/9/5 | WATCH / INTEGRATE / INTEGRATE / REJECT |
| @anthropic-ai/sdk | MIT | 09-30, 2.1k★ | Anthropic | npm | — | PQ | 9/9/9/10/9/10/9 | ADOPT |
| Claude Agent SDK TS / Python | **no OSS licence (Commercial Terms)** / MIT | 10-06 | Anthropic | harness with shell/file tools | wrong posture for a web app | PQ | 4/8/7/3/8/5/5 | WATCH (dev/ops only) |
| LangGraph / OpenAI Agents SDK / Pydantic AI / CrewAI / smolagents / AG2 / AutoGen / instructor-js / MCP SDK | MIT / MIT / MIT / MIT / Apache / Apache / MIT (maintenance) / MIT (dead) / MIT→Apache | — | — | — | — | — | 5/8/8/5/6/5/5 (LangGraph) ; 5/8/8/6/8/7/7 (MCP) | BORROW / REJECT / WATCH / REJECT / REJECT / REJECT / REJECT / REJECT / WATCH→INTEGRATE |
| simple-statistics / json-rules-engine / ml.js | ISC / ISC / MIT (2024) | 7.12.1 09-27 / 02-2026 / — | — | npm | 0 | PQ / PQ slow / AB | 7/8/9/9/8/10/6 ; 5/7/7/6/5/8/4 | ADOPT / BORROW / REJECT |
| statsmodels / Prophet / river / PyOD / Darts / tsfresh | BSD / MIT / BSD / BSD / Apache / MIT | active | — | Python | — | PQ | — | WATCH (only with a Python worker) |
| Construction risk/delay ML notebooks | varied, 0–3★ | — | students | — | synthetic data | DM | — | REJECT |

## 8. Construction ERP

No ERP is worth adopting outright. ERPNext (GPL-3, 39.9k★, 89 advisories) has no retainage anywhere in its code and its "Subcontracting" module is manufacturing toll-processing; its project costing is actuals-only margin, much like the CRM today. Its one strong idea is budget control at three gates (material request, purchase order, actual expense) each with Stop/Warn/Ignore and a line-to-line chain requisition → PO → receipt → bill. Odoo CE (LGPL) contributes the PO-line fields `qty_received`/`qty_invoiced`/`qty_to_invoice` and the bill-on-ordered vs bill-on-received policy; Tryton (GPL) the order point with a provisioning location and `purchase_amendment` for post-approval PO changes. OCA/vertical-construction is one BC3 importer and empty on current branches. The construction-specific repos (massing, massingbill, BuildSuite, cepho, bc-construction-management) are 2026 projects with a bus factor of one and visible AI generation; they are useful as worked examples of data models and, in massing's case, as a warning: its budget is built from the owner's SOV (revenue), committed double-counts owner CO revenue, forecast is max(committed, actual) and percent complete divides by budget instead of EAC. BuildSuite's `construction_rate_history` (rate, effective from/to, reason, PO, supplier, who) is the right shape for CareyOS price history; massingbill's retention policies with stepped reductions and payment-blocking compliance requirements are the right shapes for subcontracts.

What CareyOS takes: build natively in Prisma; use the line-to-line link pattern as the backbone for cost codes on every money row; adopt the three-gate budget control with an override role; treat massing's "cost spine" (one code traced estimate → budget → commitment → actual) as a data-integrity report; ignore the "construction" modules that exist only in name.

## 9. Estimating

No permissive, maintained US residential cost database exists. FDOT historical item averages are road and bridge items; BLS Producer Price Indexes (asphalt shingles, lumber, gypsum, copper pipe) and Davis-Bacon Florida wage determinations are public-domain escalation indices for the company's own price book, not prices; NREL's PV Rooftop Database (CC BY, LiDAR-derived roof planes, 2006–2014) is a test fixture. The estimating repos that matter are OpenTakeoff (Apache-2.0; scale detection, per-sheet calibration, symbol sweep, schedule reading, review states where only a person mints APPROVED; its one-click room fill is currently gated off pending re-validation) and Bidwright (AGPL; the best assembly model found: typed parameters, quantity expressions, nested sub-assemblies, per-component overrides, snapshots when an assembly is inserted, a `TakeoffLink` from measurement to estimate line with multipliers; concepts only). GitHub roofing calculators are 0–19-star demos; the CRM's 45-rule engine is already ahead of all of them.

Design for CareyOS (consistent with the OCE analysis §7): one estimate line model (`EstimateLineItem` gains `kind`, `costCodeId`, `source`, `provenance`), a per-unit resource split (`EstimateLineResource` with the invariant unit price = Σ quantity × rate), a productivity norm library separate from money (`LaborNorm` hours per unit, `NormMaterial` net quantities per unit; price is a view over norm × rates × prices), parameterised assemblies with a safe allow-list formula evaluator and insert-time snapshots, markup steps with explicit bases and allowances with drawdowns, an immutable `EstimateSnapshot` taken on SENT and at contract, and `RoofEstimate` retired by generation once the takeoff writes lines. Prices come from the append-only price book and invoice-derived quotes; BLS indices only raise an "index suggests" flag beside a price and are never applied silently. Every line carries provenance (rule key or norm id, assembly id, parameters, price as-of, match confidence, needs-review).

## 10. Plan Takeoff

| Step | Permissive library today | Needs a trained model? | Human-verified? |
|---|---|---|---|
| Upload plans | pdf.js + existing upload; enforce size and page limits, `isEvalSupported:false` | No | No |
| Identify sheets | Title-block text via `getTextContent` (sheet number regex, title, discipline prefix); PaddleOCR-ONNX for scans | Optional small classifier later | Light confirmation |
| Detect scale | Scale-note parser with split-run guards (OpenTakeoff concept), cross-check against a dimension string, two-point calibration; block on NTS, multiple viewports or mismatch > 1% | No | **Always** |
| Detect objects | (a) **schedules** via text + table geometry (pdfplumber heuristics ported to TS), the best value for windows/doors/fixtures; (b) vector walls/rooms from `getOperatorList` paths + polygonisation on CAD-exported PDFs; (c) count-by-example template sweep from one user-boxed symbol | Yes for general symbol/room detection on rasters; **no permissive pretrained model exists** (CubiCasa5k CC BY-NC, HEAT NC, FloorPlanCAD CC BY-NC, MOCS CC BY-NC, DeepFloorplan GPL, RoomFormer on NC weights, ConstructDrawingAI PolyForm-NC, YOLOplan AGPL); fine-tune RF-DETR/YOLOX/RT-DETR on own labelled sheets later | **Yes**, every item accept/reject |
| Calculate quantities | Deterministic geometry (jsts/turf area, length, offset) × calibrated scale; server recompute from raw points | No | Spot-check |
| Create takeoff | `PlanDocument / PlanPage / PlanMeasurement / PlanSchedule` with method, author, confidence, review state, calibration reference; recalibration recomputes | No | Estimator owns it |
| Map to assemblies | Own rules engine; the roofing rules are already this | Optional suggestion later, never automatic | Yes for non-default mappings |
| Generate estimate | The one estimate line model on the price book | No | Yes |

pdf.js v6.4 changed its operator-list layout (`DrawOPS` buffers with bounds per path, ending at a paint op), so geometry code must track the transformation matrix through save/restore/transform and be pinned to a major version with fixtures. CAD/BIM (DXF via ezdxf or dxf-parser; IFC via web-ifc/IfcOpenShell) is WATCH only; DWG needs a proprietary converter or GPL libredwg and is rejected: ask architects for PDF or DXF.

## 11. Roofing Intelligence

**Feasibility.** Pitch cannot be measured from a single top-down image; every credible open pipeline derives slope from 3D data. Florida has unusually good public 3D data: the 2018–2020 FDEM/USGS Florida Peninsular LiDAR at QL1 (≥ 8 pulses/m², public domain) across 35 counties, with 3DEP baseline coverage statewide except areas around Tampa, Pensacola, north of Lake Okeechobee and north of Daytona pending at the time of the USGS fact sheet; verify Hillsborough, Pinellas and Pasco in LidarExplorer. Caveats: 2018–2020 tiles predate post-Ian/Milton reroofs and additions; live-oak canopy; small dormers under ~4 m² give too few points for a plane fit; flat roofs with parapets; barrel tile roughness. Orthoimagery: NAIP 2023 is 30 cm but positioned only to ±4 m (context, not edges); FDOT APLUS 1 ft; county appraiser 3–6 inch imagery under per-county terms. Footprints: Microsoft GlobalMLBuildingFootprints (CDLA-Permissive-2.0, IoU 63–68%, overhangs excluded) are a seed polygon for "which building", never the measurement. Google Solar API returns per-segment pitch, azimuth and area, but its policy restricts caching or storage of anything except place IDs, so storing results in estimate tables conflicts with it; usable only as a live, non-stored second opinion pending counsel. ODM/WebODM is AGPL and only a separate tool; there is no drone workflow today.

**Pipeline (no GPU, no ML in v1):** Census geocoder → Microsoft footprint containing the point, confirmed by the user on a map → PDAL clip of 3DEP EPT/COPC by the footprint buffered ~1.5 m, keeping building-class points, recording the acquisition date → `roofer` (3DBAG, GPL-3.0, v1.0.0 April 2026, runs the Dutch national 3DBAG; **subprocess only, never linked**, in its own service unit) producing LoD2.2 planar faces → a pure TypeScript classifier: pitch from plane normals, sloped area = planimetric area ÷ cos θ, edges classified ridge/hip (convex fold), valley (concave), eave (boundary horizontal), rake (boundary sloped), step flashing (against a wall) → **emit exactly the Roofr parser's `Measurements` shape** so the existing takeoff engine is unchanged. Open3D region growing + RANSAC as a fallback. The result lands as a `RoofMeasurement` with source LIDAR, confidence, engine version and the LiDAR date; a freshness gate rejects it when a permitted reroof or addition postdates the tiles.

**Accuracy evidence.** EagleView's 2025 drone/terrestrial-LiDAR benchmark reports lines 98.77%, area 98.43%, slope 98.49%; its carrier pilots report manual adjusters over-measuring by +9.5–10.9% on average; Roofr publishes no accuracy study. Academic LiDAR work puts roof tilt error around 3° at moderate density and 1–2° at dense. Error propagation: relative area error from a pitch error Δθ is tan θ·Δθ (at 6/12, 1.7% per 2°; at 12/12, 3.5%); a ±0.15 m eave offset on a 70 m perimeter of a 300 m² roof is ±3.5%. So **2–4% total-area disagreement is the noise floor** of a LiDAR engine against a good aerial vendor.

**Validation model (worst metric governs; every comparison stored append-only with input and engine versions).**

| Metric | ACCEPTABLE | REVIEW | MANUAL REVIEW REQUIRED |
|---|---|---|---|
| Total roof area (squares) | ≤ 3% | 3–8% | > 8% |
| Predominant pitch | same x/12 | ±1/12 | ≥ 2/12 difference, or the slope-factor class changes (low-slope ≤ 2/12 vs steep) |
| Ridge + hip LF | ≤ 5% | 5–12% | > 12% |
| Valley LF | ≤ 5% | 5–15% | > 15%, or valley count differs |
| Eave + rake LF | ≤ 5% | 5–10% | > 10% |
| Facet count | equal, or ±1 facet under 2 m² | ±2 | > 2, or any facet > 5% of area missing |
| Data freshness | LiDAR newer than the last known roof change | unknown | permit or job history shows a change after the LiDAR date |

Operating rules: ACCEPTABLE may pre-fill a preliminary estimate labelled "engine-measured, Roofr pending"; REVIEW means the estimator compares overlays and picks a source with a reason code; MANUAL hides the engine output from quoting and requires a Roofr report or field measurement. The engine becomes the primary source for a roof class only after at least 30 consecutive ACCEPTABLE jobs of that class against **field-verified** truth (tape and pitch gauge, or a drone survey), after which the internal accuracy (MAPE, P90) is published the way EagleView did; bands are recalibrated after the first 50 paired jobs. The example in the brief (4,012 vs 3,955 SF, +1.44%) is ACCEPTABLE; 4,550 vs 3,955 (+15.0%) is MANUAL REVIEW REQUIRED.

## 12. Field Operations

CareyOS is ahead of every open-source field-service product on the mobile side; those products (OCA field-service, ERPNext, Beveren FSM) are AGPL/GPL Odoo or Frappe apps whose value is a well-tested feature list. What they teach: a **visit/appointment window as its own record** (promised window, hard/soft, duration estimate, required skills/licences/equipment), the input a dispatch solver needs; **skills and licences on people with expiry dates** (Florida trade licences, OSHA cards) and a check that warns or blocks when an assignment needs a licence the person lacks or has let expire; **a signature at the door inside `/field`** (canvas capture, hash, GPS, timestamp, stored with the change order or visit); **recurring service agreements** that generate visits. From the CRM's own gaps: typed daily-log entries (DELAY with cause and hours, DELIVERY with vendor, quantity and PO line, INCIDENT, VISITOR, PUNCH) beside the narrative; punch items with four-eyes verification, reopen count and optional back-charge to a vendor; materials delivered that receive commitment lines without a warehouse module; customer acknowledgement on site. Not worth taking: Last Planner, takt, drone/360 media, three weather providers, certified payroll.

## 13. Scheduling

There is no maintained, permissively licensed CPM library in TypeScript or Python worth depending on; CPM is about 200 lines of deterministic code and should be written inside the workflow engine over the dependency edges the CRM already has. Gantt vendors put critical path and auto-scheduling in paid editions; that is fine because CareyOS computes them server-side and only needs a chart to draw them: SVAR React Gantt (MIT core, v2.8.0 on 2026-10-07) or DHTMLX Gantt Community (MIT since v10.0.0, June 2026; pin and keep the LICENSE copy). OpenProject's manual-vs-automatic scheduling modes with pinned dates and lag are the pattern to borrow. Minimal CPM: an explicit duration in business days per step (most already have a business-day offset), finish-to-start dependencies with optional lag, pinned dates as constraints the engine never overwrites, actual start/finish; forward pass on the business-day calendar from actual dates, backward pass from the target completion, total float = late start − early start, critical = zero or negative float, slippage = forecast finish − baseline finish (baseline snapshot at contract signing); recompute on every step change through the outbox and nightly, results stored on the step. Deterministic delay signals: permit waiting beyond the jurisdiction's typical days, inspection overdue, material not received X days before the dependent install's early start, crew not assigned within N business days, assigned person's licence lapsing before the step, float consumed, exterior step on a high-rain day (soft), gate stalled beyond its SLA. No automatic resource levelling; show workload conflicts (already done) and let people decide. VROOM (dispatch) is a separate concern (Section 28 and the roadmap).

## 14. Procurement

Nothing standalone is worth adopting; the references are ERPNext, Odoo and Tryton for the chain requisition → quote → PO → receipt → bill with every downstream line linked to its upstream line. CareyOS design: `Commitment.kind` PURCHASE_ORDER · SUBCONTRACT · OTHER with `CommitmentLine` (item or free text, qty, unit, rate, last rate, project, cost code, required-by, destination job site/yard, received qty, billed amount, closed flag); receipt lines (received/accepted/rejected, location, photo or delivery ticket, PO-line link), with a crew lead's daily-log DELIVERY entry serving as the receipt for drop-shipped roofing material; 3-way match with configurable tolerances (bill qty ≤ received + overage %, rate = PO rate as stop or warn, total ≤ PO + allowance, optional PO-required/receipt-required) routed to an exception queue; open commitment = Σ(line − billed, not closed) floored at 0 so committed and actual never double-count; append-only price history per vendor and item fed by POs, invoices and the card/bank allocator (the BuildSuite rate-history shape); `PriceItem` + `VendorSku` + `PriceQuote` (append-only, effective date, valid-to, source manual/invoice/quote/import, job-specific when it is, lead time, delivery basis) generalising the roofing price book; derived current price, 90-day average, change since last quote, stale over 90 days (the roofing library already has `STALE_PRICE_DAYS`); `MaterialPackage` per takeoff with per-vendor totals (Σ qty × current price + delivery − discount), coverage % and a best package by total with coverage above a threshold, shown as a recommendation beside the per-line comparison; price-change attention row on preferred items. Supplier scraping is not needed in year one; invoice- and receipt-derived prices need no site terms. Inventory stays minimal: locations (yard, each truck), an append-only stock ledger, transfers as paired rows, issue to a job as an actual cost at moving average, order points only for yard consumables; InvenTree only if a real warehouse appears.

## 15. Cost Control

The consensus model from every source read (ERPNext budget logic, Business Central documentation, massing/cepho/BuildSuite schemas, PMI earned value), stated in plain words and consistent with the OCE analysis §9:

- **Cost code** tree (division → code → sub) × cost type (labor, material, subcontract, equipment, other); 30–80 codes for these trades, not full MasterFormat (which is licensed; OCE ships no table either).
- **Budget line** = project × code × type: original (frozen at baseline, dated, approver), optional manual ETC with note and date; everything else derived.
- **Change events**: revenue side (customer price, status) and cost-side lines by code; approved and pending kept apart, never folded together.
- **Commitment** = PO or subcontract with lines by code; original + approved commitment COs = revised; status draft/issued/executed/closed/void.
- **Actual** lines with source type (bill, expense, labour, inventory issue, equipment) and an optional commitment-line link.

| Figure | Formula |
|---|---|
| Revised budget | original + approved changes |
| Projected budget | revised + pending changes (shown, never added to revised) |
| Committed | Σ revised executed commitment lines |
| **Open commitment** | committed − invoiced against, floored at 0, closed lines 0 |
| Uncommitted actual | actuals with no commitment link |
| ETC (A, default) | max(revised − actual − open commitment, 0) |
| ETC (B) | manual, with reviewer, date, note |
| ETC (C) | (revised − earned value) ÷ CPI |
| **EAC** | actual + open commitment + ETC |
| Variance at completion | revised − EAC (negative = over) |
| **Percent complete** | actual ÷ EAC (not ÷ budget) |
| Earned value / CPI / SPI / TCPI | BAC × physical %; EV ÷ actual; EV ÷ planned; (BAC − EV) ÷ (BAC − actual) |
| Contract value | original contract + approved owner COs |
| Earned revenue; over/under-billing | % complete × contract; max(billed − earned, 0) and the reverse |
| Projected gross profit; backlog | contract − EAC; contract − billed |

Monthly `JobCostSnapshot` rows (and at signing and close) give the margin trend, "what changed since last month", and the WIP report; budget gates Stop/Warn/Ignore at PO issue and bill posting with an override role audited. The brief's example resolves as: contract $250,000; original cost $175,000; actual $126,000; open commitments $55,000; ETC by the default rule $55,000 or $61,000 with a superintendent's remaining-quantity override on two lines; EAC $187,000; projected GP $63,000 against $75,000; variance −$12,000 on two codes, visible the day the second PO is entered. Every number is deterministic; the LLM only writes the PM paragraph from a frozen snapshot.

Pay applications and retainage share one structure on both sides: SOV line (item, description, code, scheduled, previous, this period, stored, per-line retainage rate honouring an explicit 0, optional quantity basis); G702 lines 1–9 with retainage split 5a (completed work) and 5b (stored material); submitted applications immutable with line 7 (previous certificates) read from stored certified amounts, never recomputed; an append-only retention ledger (withheld/released/reduced) with stepped reduction, partial and final release. The CRM's existing G702 engine already does the owner side; the subcontract side reuses it.

## 16. Subcontractors

Design on the existing `LaborContract` (a subcontract commitment of its own kind; no second `Subcontract` model): `originalAmount`, `requiresLienWaiver`; approved and pending labour COs as separate buckets; `SubcontractPayApplication` per period with per-line claimed vs certified (the GC can cut a claim), deductions (retention, advance recovery, back-charges from punch items), net posting as an actual against the commitment, status REQUESTED → APPROVED → PAID with the existing accountant task as the approval UX; `RetentionLedger` append-only; `LienWaiver` (type PROGRESS · FINAL per Florida's statutory forms, `statutoryForm` flag, template version, through date, amount, signed date, file hash, status requested → received → verified); payment release conditioned on the waiver, warn-by-default and block when the admin switches it on (the compliance pattern); compliance requirements (COI general liability/auto/workers' comp or exemption, W-9, licence, bond) with blocks-payment, recurring and warn-days-before on top of the existing `VendorDocument`; remaining commitment derived as revised − Σ approved applications. Vendor scorecard later from receipts (on-time), CO rate, pay-app disputes, compliance gaps, punch back-charges. **Legal flag:** massingbill's seed data says Florida "expressly permits" non-statutory waiver forms; the reading of Fla. Stat. 713.20 here is the opposite (waivers in substantially the statutory progress/final form; a payer may not require a different one), and the 713.06 final affidavit and 713.13/713.135 NOC recording-and-posting rules belong in the same engine; counsel confirms before any template is built. Lien deadlines are not computed until Richard rules on it.

## 17. Permit Automation

There is no open-source permit ecosystem (toy repos ≤ 4★; the BLDS standard is dead; ICC owns the code text). The lever is Florida statute, and it argues for a rule table and monitoring, not scraping: **Fla. Stat. 553.79(1)(b)** requires every local enforcement agency to post each permit type's application with its list of required attachments, accept electronic submission, and post and update the status of every application on its website; **553.792** sets a sufficiency notice within 5 business days and decisions within 5 (single-family under $15k) / 30 (residential under 7,500 sq ft) / 60 business days, with the permit fee reduced 10% per business day of delay (20% per day for late revision reviews). Accela's Construct API (~417 operations) needs each agency's administrator to approve an app (Manatee and Escambia are confirmed Accela customers); no public contractor API exists for Tyler EnerGov, CityView, OpenGov, CentralSquare or ProjectDox. Open data (Socrata/ArcGIS) supports nightly status reconciliation where it exists; Shovels (commercial, refreshed twice monthly) is market intelligence only; DBPR weekly CSVs of licensees support subcontractor licence verification. Browser automation for submission is rejected: portal terms of use, the licence attestation and payment liability sit with the licensee, vendor upgrades break selectors, and LLM browser agents (Stagehand, browser-use) are nondeterministic exactly where a mis-click files a wrong application; Playwright is WATCH for read-only, low-rate status polls, opt-in per jurisdiction, in its own unit.

| Step | Feasible | How |
|---|---|---|
| Property → jurisdiction | Yes | Geocode, DOR/appraiser parcel point-in-polygon → county, municipality, HVHZ flag (Miami-Dade, Broward), flood zone |
| → trade, permit type | Yes (rules table) | `JurisdictionPermitRule` (jurisdiction, trade, scope, valuation band, permit type, source URL, verified at) seeded by hand from the 553.79 postings for the 10–15 jurisdictions worked, re-verified quarterly |
| → required documents | Yes (rules table) | Checklist per rule: FL Product Approval / Miami-Dade NOA (windows, doors, roofing), NOC recorded and posted before first inspection, owner-builder disclosure, survey, energy calcs, HVHZ roof uniform application, licence and insurance certificates |
| → auto-populate | Yes | LibPDF AcroForm fill of municipal PDFs; pdfme overlay for non-fillable forms (templates per jurisdiction, admin-only designer); data from job, customer, parcel, DBPR licence and insurance tables; Docassemble's interview → variables → template as a Next.js wizard |
| → validate | Yes | Deterministic: every checklist item has a file in the right category, licence and insurance unexpired, signatures present, valuation consistent with the contract |
| → submit | **No (human)** | One-click submission packet (ZIP + cover sheet); a person uploads and pays; API only where an agency approves an Accela citizen app |
| → track | Partly | Record number; 553.792 clocks (sufficiency due, decision due, revision due); nightly open-data reconciliation where available; optional read-only poll; manual "last checked" otherwise; "fee reduction available" flag |
| → respond to comments | Assisted | Upload the comments PDF; LLM extracts a correction list into task candidates; the revision clock starts; tasks raised through `createTask` after confirmation |
| → schedule inspection | **No (human)** | Inspection-sequence tasks from the rule table; scheduling on the portal or IVR |
| → close | Yes | Final inspection pass closes the permit (exists), closeout packet, 180-day inactivity alerts |

## 18. Document Intelligence

The fleet already has Anthropic structured outputs, and current models read PDFs and images directly, so a Python OCR service is not justified: use the text layer when present (unpdf; most vendor invoices are digital), send the PDF or photo to the model with a zod schema otherwise, and keep tesseract.js only as a cheap pre-classifier. docling (MIT, 16 advisories with 10 in Sep–Oct 2026) is WATCH for drawings and spec PDFs; unstructured (critical SSRF and path traversal) is rejected; marker/surya weights are restricted above $5M revenue; MinerU carries extra terms; LayoutLMv3 weights are non-commercial. Paperless-ngx (GPL) teaches the matcher enum (`NONE/ANY/ALL/LITERAL/REGEX/FUZZY/AUTO`) and learning from corrections; invoice2data (MIT) the per-vendor template hints. pgvector (PostgreSQL licence) is adopted only when full-text search plus `pg_trgm` stop being enough; ParadeDB (AGPL), Qdrant/LanceDB and RAG frameworks are rejected at this scale.

**Invoice pipeline.** Ingest (upload, email forward, MMS, or an allocator-posted expense) → store the `File`, SHA-256 exact-duplicate check → pg-boss `extract-document` → text layer (< ~50 characters a page means scanned; optional tesseract.js) → cheap classification by vendor alias rules (literal, regex, fuzzy on remit-to name, phone, tax id) → LLM structured extraction with a zod schema (header: vendor, remit-to, invoice number, dates, terms, PO number, ship-to address, subtotal, tax, freight, total; lines: description, SKU, qty, unit, unit price, amount; per-field confidence and evidence page/quote; vendor hint in the prompt; null rather than guess) → deterministic validation (Σ lines + tax + freight = total within 1¢, plausible dates, vendor + invoice number unique, county surtax consistency) → deterministic scored matching (alias → `Vendor`; PO number → commitment → job, else ship-to vs job and parcel addresses, else open jobs with that vendor in a date window; cost code = vendor default + description keyword map; open commitment balance and variance; **the cc-allocator expense matched by amount/date/vendor so bank-side and invoice are linked, not double-counted**) → review UX (split pane with evidence highlights, colour by source, keyboard approve, "always map this vendor/description to…" creating alias or cost-code rules, `ExtractionCorrection` stored for evaluation and few-shot hints); nothing posts to job cost until approved; auto-approve only for vendors with N clean extractions under a threshold. Later: embed approved text into pgvector for "find the window quote for 123 Main".

## 19. Fleet / Equipment

Traccar (Apache-2.0, v6.16.0, one maintainer, 28 advisories including an authenticated SQL injection fixed after 6.13.3) is the only GPS server worth integrating, optionally, for trucks and the skid steer via Teltonika-class devices or the Traccar Client phone app, kept off the internet behind a relay; most consumer trackers have no API (Bouncie advertises one, unverified). Atlas CMMS, Snipe-IT (86 advisories, an RCE in August 2026) and Shelf.nu (cross-organisation IDORs) are AGPL and contribute concepts only: a custody ledger by QR, date-range bookings with conflict detection, kits, meter-triggered preventive maintenance that creates tasks. Minimal CareyOS model: `EquipmentAsset` (truck, trailer, dumpster, generator, skid steer, tool kit; owned/leased/rented with vendor, rental dates and daily rate; plate and registration expiry; status; QR; optional tracker id), `EquipmentBooking` (asset × job/crew/person × dates, conflicts via the calendar's existing warnings; dumpsters get drop and pull visits), `EquipmentCustody` (append-only check-out/in with condition photo from `/field`), `EquipmentMeter` readings, `EquipmentUsage` posting an EQUIPMENT cost by code through the expense service, `EquipmentMaintenanceRule` (every N miles/hours/days or a fixed date → a normal task). Leave out inventory and fleet telemetry; a "materials received" flag from typed daily-log entries covers scheduling.

## 20. GIS / Development

**Property intelligence.** PostGIS is GPL-2 but a database extension; an app talking to it over SQL is not a derivative (DigitalOcean managed Postgres supports it; self-hosted is one PGDG package); Prisma needs `Unsupported("geometry")` plus raw SQL. Keep Leaflet (pin 1.9.x) and Mapbox Search as a paid API; do not adopt Mapbox GL JS v2+ (proprietary); use MapLibre + OpenFreeMap/Protomaps in landdev-analyzer. Public Nominatim forbids autocomplete and bulk use and self-hosting Photon/Pelias needs Elasticsearch-class resources; the US Census Geocoder (public domain, batches of 10,000, returns county/tract FIPS) is the batch tool. Florida public sources: FDOR statewide parcels (10.8M polygons, `PARCEL_ID`, `CO_NO` in DOR's own 1–67 numbering that must be mapped to FIPS, `DOR_UC`, actual/effective year built, values, sales; FGIO FeatureServer), county appraiser ArcGIS REST (fresher), FEMA NFHL, NOAA SLOSH surge, NWI/FDEP wetlands, zoning and FLU per county/city (no statewide layer), DBPR licence extracts, Sunbiz bulk, scattered permit layers (Miami iBuild, Fort Lauderdale, Leon); Regrid per record only where a county's endpoint is unusable. The `Property` design (key `countyFips` + normalised `parcelId`, situs, point and polygon, jurisdiction, DOR use code, year built, heated/lot sqft, value, sale, owner/Sunbiz id, source vintage; append-only `PropertyLayer` per enrichment with source URL, fetched-at and hash; `PropertyLink` to lead/job/violation/deal; `Jurisdiction` with polygon, portal URL, typical permit days by type, HVHZ) serves construction (roof age = max of latest roof permit and effective year built; permit jurisdiction by point-in-polygon replacing free text; flood zone to scope; knock score gaining roof age, homestead and equity) and development (landdev-analyzer shares the key or reads a bearer API). Enrichment runs in the queue, throttled per source, hash-cached.

**Development intelligence.** Real Estate DataMap is a one-day MIT portfolio dump with a Rust site-layout engine and three demo projects (concepts: phased plan, frontage classification, never place geometry outside the parcel); "TDR Analysis" resolves to joburke1/tdranalysis (CC0, Arlington VA single-family): a well-structured four-stage pipeline whose per-district rules JSON carries ordinance section and effective date, with validators, anomaly detection and a corrections workflow, the right template for a Florida rules table; UrbanLayer is an AGPL specification with no code; pyforma (BSD, 2016) is a clean but abandoned pro forma; UrbanSim is regional simulation; momepy/cityseer/pandana/ladybug are either Python-only or AGPL. There is no mature open-source buildable-envelope engine; it is 300–600 lines on PostGIS/Turf. IRR/XIRR come from `financial` (MIT TypeScript port of numpy-financial) or formulajs (Excel-compatible) with unit tests checked against Excel; never from an LLM.

| Step | Kind | Where |
|---|---|---|
| Address/APN → parcel; zoning; FLU; overlays (flood, surge, wetland, historic, CHHA, airport) | Data lookups (public GIS) | CRM `Property` layers (shared) |
| Setbacks; height/stories; density (lesser of zoning and FLU plus Live Local Act bonuses, human-flagged); FAR; coverage | Rules table per jurisdiction + geometry (edge classification, negative buffer, validity check) | landdev-analyzer |
| Buildable envelope = min(setback polygon × floors, FAR GFA, coverage cap, height); parking ratio × ~350 SF; massing extrusion; unit count = min(density cap, net rentable ÷ average unit, parking-limited) | Deterministic geometry and arithmetic | landdev-analyzer |
| Construction cost | **CRM `CostIndex`** ($/SF by code, trade, year, county from closed jobs, inflation-adjusted) + site work, soft-cost %, contingency | CRM exports; landdev consumes |
| Rents; NOI = EGI − OpEx; value = NOI ÷ exit cap; residual land value = value − hard − soft − financing − developer profit; IRR / equity multiple | Inputs and financial formulas | landdev-analyzer |

AI's place: the model reads a zoning-code PDF and proposes rules-table rows (district, field, value, section, page) that a reviewer accepts or edits one by one, the closing-brain approval pattern; the CRM owns Property, layers, jurisdictions, permits on record and the cost index; envelope, massing, pro forma and the feasibility PDF stay in landdev-analyzer. No IRR, draw-schedule or proforma code exists anywhere in the fleet today; when it is wanted it is built beside landdev-analyzer, not from any repository found.

## 21. AI Opportunities

No framework earns its place: `@anthropic-ai/sdk` with `messages.parse` + `zodOutputFormat` is the whole layer; the Claude Agent SDK for TypeScript has no open-source licence (Anthropic Commercial Terms) and the wrong security posture for a web app; Mastra's `ee/` is source-available with no production use; LangGraph's checkpoint/interrupt and Mastra's suspend/resume are ideas for the approval centre; OpenAI Agents SDK, CrewAI, smolagents, AG2, AutoGen (maintenance mode) and instructor-js are rejected; the MCP SDK is WATCH for exposing read-only CareyOS tools later. Pattern: `lib/ai/{client,run,features,redact}.ts`, an `AiRun` audit table (feature, prompt version, model, input reference and hash, redacted input, output, status PROPOSED/APPROVED/REJECTED/ERROR/EXPIRED, tokens, cost, requester, decider), per-feature switches and daily cost caps in an `AiSettings` singleton, batches through pg-boss using the Message Batches API, approval reused from closing-brain.

| Proposed agent | Verdict | What the LLM does | Approval boundary | Audit |
|---|---|---|---|---|
| Estimating | Deterministic workflow + LLM step | Turns scope text or photos into draft lines mapped to cost codes; flags missing scope; **prices from the index, never the model** | Estimator approves every line | Input, lines, price source per line, approver, diff |
| Permit | Deterministic + LLM step | Jurisdiction by point-in-polygon, never the model; LLM summarises reviewer comments into a checklist | Human submits every filing | Permit, comment source, draft, final |
| Project manager | Deterministic score + LLM narrative | Writes the "why" paragraph from scored facts only | Read-only; suggested tasks need a click | Snapshot, narrative |
| Procurement | Deterministic + LLM step | Reads quote PDFs into lines; compares to budget | PO issuance human-only | Quote hash, extraction, approver |
| Document | **The only bounded agent** | Classifies, extracts and files COIs, waivers, NOCs, invoices; tools read and propose only | Human confirms filing; low confidence queued | Document, class, confidence, fields |
| Code violation | Deterministic + LLM step | Parses notices into violation, deadline, fine; matches to a Property | Any outreach human | Notice, parse, match score |
| Property development | Deterministic pipeline + LLM rule extraction | Rules-table candidates with citations | Every rule row approved; math never LLM | Rule row, citation, reviewer |
| Acquisition | **Do not automate decisions** | Summarises title and comparables; drafts an LOI from a template | Price and terms human-only | Sources, draft, sender |

Mode per opportunity: AUTOMATIC — none for money; voicemail summaries only (already in the fleet). HUMAN REVIEW REQUIRED — plan sheet and scale proposals, room/count proposals (only after a labelled set exists), scope extraction, cost-code matching above a threshold (still shown as suggested), invoice/receipt line extraction, change-order drafts from daily-log delay entries, document classification, daily-log summarisation for owner reports, permit comment extraction. ADVISORY ONLY — supplier quote comparison explanations, project and schedule risk narratives, margin-erosion explanation, permit document validation, historical comparison. DETERMINISTIC — every money figure, health score, ETC/EAC, retention, waivers, CPM, dispatch optimisation, price comparison, productivity factors. Security: SSNs, pay rates, bank details and customer contact details never in a prompt; personnel and encrypted fields structurally unreachable from the feature registry; the redacted input stored per run.

## 22. Underutilised CareyOS Data

| Dataset (tables) | What it holds | What CareyOS could learn | Prerequisite |
|---|---|---|---|
| Historical estimates (`Estimate`/`EstimateLineItem`, `RoofEstimate.roofTypesJson`, `CustomerContract.snapshot`) | Quoted cost, price, margin, unit rates, frozen at signing | Estimated vs realised margin by job, trade, estimator; unit-rate drift; win rate by price band | Cost codes on lines; `EstimateSnapshot` |
| Roofr measurements + takeoff items | Squares, pitch bands, LF by edge type, waste suggestion, rule-keyed quantities | **Real cost per square by roof type / pitch / stories / crew / material / municipality**; waste used vs recommended; rule calibration | Takeoff written to lines; MATERIAL expenses by vendor (exists) |
| Supplier purchases (`JobExpense` + receipts; `RoofMaterialPrice`) | Every purchase with payee, amount, date, type, receipt | Price history per vendor and item; drift alerts; vendor spend share; quote vs invoice variance | Invoice line extraction → `PriceQuote` |
| Final job costs (cost summary inputs) | Spent / committed / projected at a point in time | Projected-margin trend over a job's life; EAC accuracy by PM; backlog and cash requirements | `JobCostSnapshot` monthly |
| Employee activity (`DailyLaborEntry`: hours, OT, cost code, phase, GPS, late/absent) | Per worker per day per job | Crew productivity (hours per square / per opening) by crew and code; dispatch durations from actuals; geofence compliance; OT drivers | Estimate hours per unit to compare against |
| Project duration (workflow step timing, dependencies, stage history) | Every step's timing and edges | Phase durations by trade; critical path and float; forecast completion; where slippage starts | CPM over existing edges |
| Permit duration (`JobPermit`, inspections, jurisdiction) | Dates and outcomes per permit | Turnaround by jurisdiction and type; first-pass inspection rate; 553.792 breaches and fee-reduction eligibility | `Jurisdiction` from parcel; clocks |
| Customer communication (`Communication`, `ActivityLog`, `LeadResponseMetric`, tracked links, nurture) | Every touch with timestamps and channel | Speed-to-lead vs win rate; best contact windows; rep benchmarks; nurture effect | Metrics registry |
| Task completion (`Task`, `TaskEvent`, escalations, nudges) | Who did what when, blocked reasons, skips | Bottlenecks by role; SLA per step; notification effectiveness | Metrics registry |
| Material usage (takeoff vs purchased vs credits) | Takeoff preview; purchases; credits as negative expenses | Waste and over-ordering per crew and roof type; returns by vendor | Persisted takeoff; invoice lines with quantities |
| Change orders + daily-log delay text | Customer and labour COs; free-text delays | CO rate by estimator/trade; unapproved scope signals; CO cycle time | Typed entries; keyword rules |
| Inspection results | PASS/FAIL/CONDITIONAL with dates | Fail rate by crew, trade, jurisdiction; rework cost | Punch items with cost |
| Lead sources + canvassing (knock score, Zylow equity/roof age, outcomes) | Source and enrichment per lead | Source ROI (needs ad spend); knock-score calibration; roof-age → conversion curves | Property for history across leads |
| Weather (daily logs, Open-Meteo archive) | Temp/precip/wind per log day | Weather-adjusted productivity; rain-day forecasting for roofing schedules | Typed delay entries with cause |
| Photos (`FieldPhoto` + image `File`, GPS, category, area) | Thousands of site photos | A labelled dataset for future detection (damage, progress, before/after), the asset competitors cannot buy | Capture labels at upload now |
| Vendors (documents, commitments, contracts, payments) | Compliance, promises, payments | Scorecard: on-time delivery, CO rate, disputes, compliance gaps, price competitiveness | PO/receipt chain |
| Code-violation cases | Deadlines, hearings, fines, agency behaviour | Jurisdiction behaviour; fine exposure forecasting; corrective cost vs fine avoided | Case cost linked to job costs |
| Audit trail | Who changed money and when | Pricing-change frequency by role; quiet-job detection (partly in health) | Metrics registry |

The brief's example resolves directly: historical roofing estimates + Roofr measurements + supplier invoices + final labour cost → real roofing cost per square by roof type, pitch, story count, crew, material and municipality, with medians, MAD and n per cell, once invoice lines carry quantities and labour hours carry codes (they already do).

## 23. Proposed Intelligence Layer

```
CAREYOS OPERATIONAL DATA  (existing tables: expenses APPROVED, labour, commitments, budget, invoices,
                           payments, COs, contract snapshot, estimates, tasks/steps, daily logs,
                           DailyLaborEntry, permits, cases; reference CostCode, Vendor, Crew, RoofRule, prices)
        ↓
NORMALISATION             cost code on every money row (vendor default → type map → "Unallocated" line);
                           Property on every address; EstimateSnapshot at signing; JobCostSnapshot monthly;
                           DashboardMetricSnapshot nightly via a typed metrics registry
        ↓
HISTORICAL DATA           append-only: JobCostSnapshot, DashboardMetricSnapshot, EstimateSnapshot, PriceQuote,
                           ProductivityObservation, CostVariance, PropertyLayer, AuditEvent; CostIndex view
        ↓
RULE ENGINE               health score (100 − capped penalties, weights in a settings row, rules in TS),
                           attention rows over nightly facts (count = list), margin risk, budget gates,
                           waiver/compliance gates, CPM delay signals, 553.792 clocks
        ↓
STATISTICAL ANALYSIS      simple-statistics: median/MAD robust z (outliers), regressions ($/SF by code, year,
                           county), permit turnaround P50/P80, crew factors; every figure carries n and coverage
        ↓
AI ANALYSIS               lib/ai on @anthropic-ai/sdk + zod; AiRun audit; per-feature switch and cost cap;
                           classify, extract, summarise, draft — never money, quantities, dates, measurements
        ↓
RECOMMENDATIONS           one Recommendation table (NORM · PRICE · COST_CODE_MAP · VENDOR_ALIAS ·
                           JURISDICTION_DAYS · SCHEDULE_DATE · DISPATCH_PLAN · TASK) with basis, confidence,
                           explanation; status PROPOSED → ACCEPTED / REJECTED / EXPIRED, audited
        ↓
HUMAN APPROVAL            /admin/recommendations (closing-brain layout); role lists mirror the target service
        ↓
ACTION                    only through owning services: RoofRule/LaborNorm upsert with provenance, PriceQuote
                           append, MatchRule/VendorAlias, createTask/updateTask, expense service, createCommitment
```

**The learning loop** (ESTIMATE → BUDGET → PURCHASES → LABOR → SUBS → ACTUAL → VARIANCE → CAUSE → HISTORY → RECOMMENDATION → APPROVAL → UPDATED ASSUMPTION) is anchored on `EstimateSnapshot` (the contract baseline) → `BudgetLine.originalAmount` by code → `CommitmentLine` + `JobExpenseLine` (the only place a purchased quantity lives) → `DailyLaborEntry` → `SubcontractPayApplication` → `computeCostSummary` by code frozen in `JobCostSnapshot` → `CostVariance` per job × code with buckets (quantity, rate, productivity, price, scope, waste, residual) → `VarianceCause` assigned deterministically: RATE_CHANGE (hours × (entry rate snapshot − baseline rate)); VENDOR_PRICE_CHANGE (qty × (invoice unit price − price in force at the estimate's as-of)); WASTE (purchased − takeoff × (1 + estimated waste), valued at estimate price); ADDED_SCOPE_NO_CO (daily-log change items or typed SCOPE_ADDED entries or confirmed AI labels with no approved CO after that date, or installed > takeoff beyond waste); PRODUCTION_ASSUMPTION (population median factor for the norm ≠ 1 beyond tolerance, the norm was wrong); CREW_PRODUCTIVITY (this crew deviates while the population is near 1); COMPLEXITY (measured stories, pitch band or facets above the rule's assumed class, else a candidate only); ESTIMATING_ERROR (a code with actuals and zero budget, or a quantity gap beyond the 2–4% noise floor); UNEXPLAINED (residual over threshold raises a review task, never a recommendation). The person closing the job sees the buckets and may confirm or override with a note; the override never changes the numbers. `ProductivityObservation` per job × code × norm/rule × crew with coverage; recommendations only above thresholds in a `LearningSettings` row (min n 8 per roofing roof type, 12 elsewhere; coverage ≥ 0.7; spread MAD/median ≤ 0.35); suggested value = median factor × current norm; acceptance writes `RoofRule`/`LaborNorm` with provenance, and a nightly invariant proves no rule was written without an ACCEPTED row. Triggers: job close (outbox on the "Close the job" step), month end (provisional variances for open jobs, no recommendations), contract signed (baseline inside the signing transaction). First 90 days from existing data, before the new tables: contract `subtotalCost` vs spent/committed on closed jobs by job type/service/rep/PM/month; `RoofMeasurement.totalSquares` × roof type vs MATERIAL expenses (material $/square by roof type, pitch, stories, county, with medians, MAD, outliers); `DailyLaborEntry` hours and cost by code and crew vs squares × `laborRatePerSquare` (hours per square by crew, with coverage); permit turnaround by municipality string and price drift from `RoofMaterialPrice`; all as read-only report cards feeding nightly facts.

## 24. Top 15 Features

Score = (BV × FREQ × TS × MI × DA × SV) ÷ (DC × MB × IR × LR), each 1–10, licence risk 1 = none. The ratio rewards cheap daily-use items; the roadmap orders by dependency, so foundations ship before higher-scoring consumers.

| Rank | Feature | BV | FREQ | TS | MI | DA | SV | DC | MB | IR | LR | Ratio | Depends on |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Project health score + margin-erosion attention rows | 8 | 10 | 5 | 7 | 8 | 8 | 3 | 2 | 2 | 1 | 14,933 | Cost codes (financial factors), Jurisdiction (permit factor) |
| 2 | Cost-code spine + budget buckets + ETC/EAC | 10 | 9 | 6 | 10 | 9 | 10 | 5 | 3 | 4 | 1 | 8,100 | Cost-code ruling; Phase 0 cleanup |
| 2 | Typed daily-log entries + punch items | 6 | 9 | 5 | 5 | 8 | 6 | 2 | 2 | 2 | 1 | 8,100 | None |
| 4 | Analytics snapshots + metrics registry | 6 | 7 | 4 | 5 | 8 | 7 | 2 | 2 | 2 | 1 | 5,880 | Queue |
| 5 | Estimate snapshot → budget + one estimate line model (roofing takeoff writes it) | 9 | 8 | 7 | 8 | 9 | 9 | 6 | 3 | 5 | 1 | 3,629 | Cost codes |
| 6 | Post-calc learning loop + roofing cost-per-square | 8 | 4 | 5 | 9 | 10 | 10 | 5 | 3 | 3 | 1 | 3,200 | Buckets, snapshots, a quarter of closed jobs |
| 7 | Invoice/receipt intelligence pipeline | 8 | 9 | 9 | 6 | 8 | 8 | 6 | 4 | 4 | 1 | 2,592 | Queue, cost codes, vendor directory, `lib/ai` |
| 8 | Price quotes + supplier package comparison + price-change detection | 7 | 6 | 6 | 7 | 8 | 7 | 5 | 3 | 3 | 1 | 2,195 | One line model; invoice pipeline feeds it |
| 9 | CostIndex for landdev-analyzer | 6 | 3 | 5 | 6 | 9 | 8 | 3 | 2 | 3 | 1 | 2,160 | Cost codes, closed jobs with EAC |
| 10 | Commitments from POs / receipts | 8 | 7 | 6 | 7 | 7 | 7 | 5 | 3 | 4 | 1 | 1,921 | Cost codes |
| 11 | CPM over workflow steps + Gantt + delay signals | 7 | 8 | 5 | 6 | 7 | 7 | 5 | 3 | 3 | 1 | 1,829 | Jurisdiction days, receipts |
| 12 | Property + Jurisdiction + permit rule table + 553.792 clocks + packets | 8 | 7 | 7 | 5 | 9 | 9 | 7 | 4 | 4 | 1 | 1,418 | Property before rules; LibPDF; jurisdiction list |
| 13 | pg-boss job queue + outbox | 7 | 10 | 4 | 3 | 3 | 9 | 3 | 2 | 3 | 1 | 1,260 | None (first thing built) |
| 14 | Subcontract pay apps + retention + lien waivers | 8 | 5 | 6 | 6 | 6 | 7 | 5 | 3 | 4 | 1 | 1,008 | Cost codes, commitments; block-vs-warn ruling |
| 15 | VROOM dispatch with skills / licences / windows | 6 | 8 | 6 | 5 | 6 | 6 | 5 | 4 | 4 | 2 | 324 | Skills + licence expiry; install dates |
| — | Plan takeoff v1 (scale, vector geometry, schedules) | 7 | 5 | 7 | 5 | 6 | 8 | 8 | 4 | 4 | 2 | 230 | One line model |
| — | Roofing LiDAR PoC with validation bands | 7 | 5 | 7 | 6 | 8 | 9 | 8 | 5 | 5 | 3 | 176 | Property, queue |
| — | Equipment / asset model | 4 | 5 | 3 | 3 | 4 | 4 | 3 | 3 | 2 | 1 | 160 | Typed entries |
| — | E-sign hardening (PAdES / TSA / OTP / audit chain) | 7 | 5 | 2 | 2 | 3 | 7 | 4 | 3 | 2 | 1 | 123 | LibPDF; counsel on template text |

E-sign scores last on this formula because its value is avoided dispute, not saved time; it still ships in Phase 1 because it is small and contracts are already signed on the native flow.

## 25. Top 5 "10X" Opportunities

1. **Real-time profit forecasting (EAC on every open job).** 14 of 17 open billable jobs have no budget, so margin is discovered at closeout; with codes, commitments and the ETC rule, every job shows projected GP the day a PO or labour CO is entered. Est. catching a 5% code overrun a month earlier on a $60–250K job is worth $1–5K per job, $17–85K a year across the open book; the JOB-00002 pattern ($2,350 paid over contract) is blocked at entry. Prerequisites: Phase 0, cost-code ruling, Phase 2 spine. Horizon 90–120 days. Boundary: the number is deterministic; the LLM only writes the paragraph.
2. **Automatic estimating (roofing first, then assemblies).** The typed `materialCost` becomes quantities × current prices × calibrated norms with provenance on every line; est. 30–45 minutes saved per roofing estimate and 3–5 points of labour pricing accuracy on ~$1.5M of labour contracts ($45–75K a year). Prerequisites: one line model, price book generalised, `LaborNorm` seeded from `laborRatePerSquare` history and payroll, the learning loop. Horizon: roofing 120–180 days; interior/W&D assemblies 9–12 months. Boundary: prices from the index, never the model; the estimator marks every estimate SENT.
3. **Permit package creation and 553.792 clocks (not submission).** 553.79(1)(b) forces every jurisdiction to publish its application and attachment list, so a rule table for the 10–15 jurisdictions worked is realistic; one click yields a filled application, NOC, product approvals, licence/COI and cover sheet, and the statutory clocks run automatically (the 397-day unissued permit on JOB-00002 would have flagged at day 30; a ten-day-late decision on a $500–2,500 fee is the whole fee). Horizon 120–180 days for the first five jurisdictions. Why not submission: portal terms, licence attestation and payment liability, no public contractor APIs, per-agency Accela approval, nondeterministic browser agents; the human clicks submit, pays and schedules inspections.
4. **Document intelligence (invoice/receipt pipeline).** Every supplier invoice is today re-keyed as an expense and allocated by hand; the pipeline extracts lines with evidence, validates arithmetic, matches vendor → commitment → job → code, links the cc-allocator twin and feeds price history for free. Est. 3–5 office hours a week plus the reconciliation rulings (19 duplicates worth $16K were found once already). Horizon 120–180 days to review mode. Boundary: nothing posts until approved; "always map…" creates a rule.
5. **Redevelopment discovery.** Property keyed by county FIPS + parcel joined to FDOR (use code, year built, values, sales, owner), permits on record, roof age, flood/surge layers, canvassing outcomes and the CRM's own job history produce ranked prospects for both the roofing book and the development arm; no competitor can reproduce it. Horizon 9–12 months. Boundary: deterministic, explained scoring; LLM-drafted zoning rules approved row by row; acquisition decisions never automated.

Assessed from the brief and placed elsewhere: automatic roof measurement is a feeder to item 2 (2–4% noise floor, stale tiles, canopy; primary status only after 30 consecutive ACCEPTABLE results per roof class); crew route optimisation matters as the carrier for skills, licences and windows on a small fleet; change-order and project risk detection are factor rows inside the health score; AI procurement is the package comparison plus quote reading with a human-only PO; the feasibility engine lives in landdev-analyzer on the CRM's cost index.

Opportunities the brief did not name: **553.792 fee-reduction claims** as a report line per permit; a **statutory waiver / NOC compliance engine** (713.20 forms, 713.06 affidavit, 713.13 NOC recorded and posted, 713.015 and 489.1425 disclosures) as versioned templates gating payment release; **crew productivity by cost code feeding both estimating norms and dispatch durations** from hours already booked; **"jobs like this one"** as a deterministic nearest-neighbour over trade, roof class, pitch, squares, jurisdiction and contract band showing real cost by code of the five closest closed jobs; **repeat-customer and property history** so a second lead at a parcel shows the prior estimate, contract, permits and warranty instead of a duplicate warning.

## 26. Licensing Risks

_Technical risk analysis, not legal advice._ GREEN: MIT, Apache-2.0, BSD, ISC, PostgreSQL licence, CDLA-Permissive, CC BY, US public domain, PostGIS as an extension. YELLOW: MPL (file-level copyleft, fine as an unmodified dependency: dxf-viewer, OCRmyPDF, web-ifc); LGPL dynamic or separate process (IfcOpenShell, Odoo CE, psycopg2); GPL only across a process boundary as an unmodified executable on the company's own server (roofer, OpenRouteService), since GPL is triggered by distribution and running a CLI internally is not distribution; ODbL data (OSM, Overture buildings: attribution always, share-alike only if a derived database is published); restricted weights (marker/surya OpenRAIL-M free under $5M revenue, re-check yearly; SAM3 custom licence; RF-DETR's non-Apache sizes under PML); source-available field-of-use terms (Mastra `ee/`, MinerU extra terms, Carbone Community License, Lightdash `ee`, Metabase `enterprise/`); Google Solar API (no caching or storage except place IDs; live-only use needs counsel); Mapbox Matrix API (check storage terms before caching matrices); Claude Agent SDK TS (Anthropic Commercial Terms, not open source). RED when linked, vendored, ported or served from CareyOS: AGPL (OpenConstructionERP, PyMuPDF, Bidwright, OCA field-service and vertical-construction, Beveren FSM, Documenso core, DocuSeal, OpenSign, Shelf.nu, Snipe-IT, Atlas CMMS, Fleetbase, Plane, Leantime, Vikunja, Windmill, xeokit, ParadeDB, Ultralytics YOLOv8/11, YOLOv10, YOLOplan/MEPdetect, cityseer, pandana, ladybug/honeybee, UrbanLayer, ODM/WebODM, Grafana, Metabase outside `enterprise/`), GPL (ERPNext, Tryton, Dolibarr, OpenProject, libredwg, DeepFloorplan, YOLOv9, GEstimator, Nominatim as software, Paperless-ngx), SSPL (Inngest server), BUSL (Akaunting), Sustainable Use (n8n), non-commercial (CubiCasa5k, HEAT, FloorPlanCAD, MOCS, Structured3D weights, ConstructDrawingAI PolyForm-NC, LayoutLMv3 weights, MUSE dictionaries, CWICR/DDC catalogues), no licence (bc-construction-management, cepho suite, most roofing CRM repos, SODA dataset unclear). Mapbox GL JS v2+ is proprietary and rejected as a renderer.

Obligations that attach to what is adopted: attribution notices for Apache-borrowed modules (OpenTakeoff) in a NOTICE file; OSM attribution wherever routes or OSM tiles are drawn; pin pdfjs-dist, LibPDF, pdfme, pg-boss, the Gantt package and the Anthropic SDK; keep a copy of DHTMLX's MIT LICENSE if chosen; a CI licence scanner allowing MIT/Apache/BSD/ISC/PostgreSQL and failing on AGPL, GPL in linked code, SSPL, BUSL and non-commercial weights; a CI grep for `pymupdf`, `fitz`, `openconstructionerp`, `cwicr`, `DDC_`. The clean-room protocol from the OCE analysis (specifier/implementer separation, no identifiers or constants transcribed, provenance log) applies to every BORROW CONCEPTS item above.

## 27. Security Risks

- **Untrusted PDF parsing**: pdfjs with `isEvalSupported:false`, `disableFontFace`, no XFA, a page limit and a CPU budget, major pinned; parsing of uploaded plans and invoices only in the worker, never in a request handler; LibPDF is young with a bus factor of one and touches only CRM-rendered PDFs, pinned, advisories watched; pdfme admin-only, pinned, never fed a URL as a base PDF (its 2025–26 advisories: SSRF via `basePdf` URL, XSS, FlateDecode bomb, sandbox escape); every parser with a timeout and the existing size limits.
- **Child processes** (VROOM, roofer, PDAL): spawned with argument arrays, fixed working directory under scratch, wall-clock timeout, output cap, no network, unprivileged worker user; the LiDAR toolchain in its own unit and user with read-only inputs; inputs are files the worker wrote, never request paths.
- **Headless Playwright**, if ever used: read-only permit polls only, opt-in per jurisdiction, own unit, no database credentials, results posted to a bearer-guarded route; never for submission.
- **Traccar**: localhost or private interface, firewalled, patched past 6.13.3 (CVE-2026-52851 authenticated SQL injection), own credentials, a relay into the CRM; never through Cloudflare.
- **Extensions**: PostGIS and pgvector from PGDG packages pinned to the cluster major; `ALTER EXTENSION UPDATE` as a tracked migration step tested on a restore; pgvector only when search needs it (a recent IVFFlat overflow was fixed; stay current).
- **AI data**: a per-feature allowlist enforced in `redact.ts`; `Personnel` and encrypted fields structurally unreachable; SSNs, pay rates, bank details and customer contact details never in prompts; redacted input stored per run; daily cost caps and switches; the key only in `/etc/knuco/env`; batch inputs purged after the run.
- **Secrets**: every new key through `env.ts` (`ANTHROPIC_API_KEY`, `ESIGN_P12_PATH/PASSPHRASE`, `TSA_URL`, `STORAGE_*`, `ROOFMEASURE_API_KEY`, `WEBHOOK_SIGNING_KEY`), optional at boot with the 503 convention; never in the client bundle.
- **Tenant and role isolation**: every new route takes a guard from `lib/access/records.ts`, `lib/money/access.ts` or a module `access.ts`; own-only roles 404 outside their lists; recommendation and AI pages ADMIN/MANAGER; integration routes bearer-only and session-free per `middleware.test.ts`. Shelf.nu's cross-organisation IDOR history is the cautionary tale.
- **Uploads**: existing caps and MIME allowlist; plans get a separate cap and page-count check; private object storage with short-lived signed reads through the existing file route (which keeps the frame headers).
- **SSRF**: the app never fetches a user-supplied URL; enrichment hosts are an allowlist; pdfme and LibPDF load no remote resources; outbound webhooks only to registered subscriptions. docling and unstructured are flagged precisely for SSRF and path-traversal classes.
- **Webhooks**: inbound HMAC or bearer with timestamp and replay window, body size limit, idempotency on the source id; outbound HMAC-SHA256 with key rotation, retries from the outbox, a delivery log.
- **Dependencies**: exact pins; `npm audit` gated on high; the licence scanner above; repositories with heavy advisory histories (n8n 210, Snipe-IT 86, Metabase 44, Lightdash 46, Trigger.dev 38, Kestra 33, InvenTree 32, Traccar 28, docling 16) are either rejected or isolated.

## 28. Architecture Recommendations

Everything lands inside the existing CRM; no new service except the isolated LiDAR toolchain, no Python in the app, no Redis.

- **Background work**: pg-boss in a `pgboss` schema on the same database with its own small pool; an `OutboxEvent` table written in the business transaction and drained by the worker; `JobRun` history; timers as `send(startAfter)` with singleton keys; a `careyos-worker` systemd unit from `scripts/worker.ts` with no port; the 12 cron bodies move into module `run` functions, the HTTP cron routes stay as manual kicks, crontab lines retired one per deploy after a week of parity. Jobs: the 12 schedules, `outbox-dispatch`, `snapshot-job-cost`, `snapshot-metrics`, `enrich-property`, `extract-document`, `ai-batch-submit/poll`, `learning-close-job`, `learning-month-end`, `cpm-recompute`, `dispatch-optimise`, `roof-measure-request`, `webhook-deliver`, `invariants-nightly`. Outbox topics: `contract.signed`, `task.transitioned`, `expense.approved`, `commitment.issued/received`, `permit.status`, `job.closed`, `daily-log.approved`, `document.uploaded`, `recommendation.decided`. Not a `WorkflowRun` orchestrator: business workflows stay in `lib/workflows`.
- **Database additions (extend-existing first)**: `CostCode` (parent, kind, division, default); `BudgetLine` (code FK unique per job, buckets, ETC override + reason); `JobExpense` (code, commitment line, sync key) + `JobExpenseLine`; `Commitment.kind` + `CommitmentLine` + receipts; `ChangeOrderItem`; `EstimateLineItem` (kind, code, source, provenance) + `EstimateLineResource` + `EstimateMarkupStep` + `EstimateAllowance` + `EstimateSnapshot` (pointed at by `CustomerContract`); `LaborContract` (original amount, requires waiver) + `SubcontractPayApplication` + `RetentionLedger` + `LienWaiver`; `PriceItem`/`VendorSku`/`PriceQuote` from the roofing tables; `LaborNorm`/`NormMaterial`/`Assembly`/`RoofSystem`; `Property`/`PropertyLayer`/`PropertyLink`/`Jurisdiction` (+ `propertyId`/`jurisdictionId` nullable on Lead, Job, JobPermit, CodeViolationCase, CanvassingProperty); `DailyLogEntry`, `PunchItem`; `PlanDocument/Page/Measurement/Schedule`; `RoofMeasurement.source` LIDAR + `RoofMeasurementComparison`; `DocumentExtraction`, `MatchRule`, `VendorExtractionHint`, `ExtractionCorrection`; `SigningEvent`, `EsignDisclosure`, seal columns on `CustomerContract`; `Task` CPM columns + template durations in the next generation; `Crew.skills/homeBase/windows`; `EquipmentAsset/Booking/Custody/Meter/Usage/MaintenanceRule`; `JobCostSnapshot`, `DashboardMetricSnapshot` (repurposed with grain + unique index), `ProductivityObservation`, `CostVariance`, `Recommendation`, `AiRun` (replacing dead `AiSession`), settings singletons `JobHealthSettings`, `LearningSettings`, `AiSettings`; `OutboxEvent`, `JobRun`. Dropped: `AiSession`, `PasswordResetToken`, `Inspection`, `PermitLookupRun`. Never created: `Customer`, a seventh property table, `PurchaseOrder`, `Subcontract`, `Bill`, `VendorInvoice`, `WorkflowRun`.
- **Services**: pure engines with fixtures under `src/lib/<module>` and thin loaders, the pattern of `cost-summary.ts`/`job-cost.ts`: `lib/queue`, `lib/property`, `lib/budget/gates.ts`, `lib/subcontracts`, `lib/plans`, `lib/documents`, `lib/customer-contracts/{seal,otp,chain}.ts`, `lib/dispatch`, `lib/workflows/{cpm,slip}.ts`, `lib/assets`, `lib/stats`, `lib/metrics/registry.ts`, `lib/learning/{variance,confidence}.ts`, `lib/ai`. `computeCostSummary` stays the one formula (extended with per-code buckets and ETC/EAC); `health.ts` keeps its shape and gains score and factors; `lib/attention` stays the one builder.
- **APIs**: the existing convention `/api/<collection>/[id]/<sub>` with `getSession` → guard → module access → `validateBody`; integration routes bearer-only (`/api/integrations/landdev/properties`, `/api/integrations/roofmeasure/callback`, `/api/integrations/cc-allocator/cost-codes`).
- **Webhooks**: inbound as today; outbound subscriptions delivered from the outbox with signatures.
- **AI services**: one module, one table, one settings row, one approval page; landdev-analyzer reuses the pattern in its repo; cc-allocator stays rule-based.
- **Storage**: keep the `storage.ts` interface and add an S3-compatible driver (DO Spaces) by `STORAGE_DRIVER`; move signed PDFs and seals first (retention through warranty and lien periods, versioning on), then plans and LiDAR artifacts, then everything by a dry-run-first script; before PAdES sealing and before plan/LiDAR features produce large files.
- **Permissions**: explicit role lists per the CRM's rules; money roles for budgets, commitments, pay apps, waivers; pricing visibility per Richard's ruling; PRODUCTION for dispatch and schedule; ADMIN/MANAGER for recommendations, AI and job runs.
- **UI**: job Money tab gains Budget by code, Commitments/POs, Pay applications, Waivers; Workflow tab gains the Gantt; Overview gains the health score and Property card; Files gains "Open as plan"; Estimates gain line kinds, markup panel, "from measurement"; the calendar day view gains "Propose a plan"; new pages `/admin/recommendations`, `/admin/job-runs`, `/documents/[id]`, `/equipment`, `/reports/cost-index`; `/field` gains typed entries, punch, QR custody, signature capture.

## 29. Features Not Recommended

**Done well already, keep**: workflows/tasks/calendar, field labour and payroll, contracts and G702 billing, permits and violations, access control, attention rows, vendor matching and compliance, job files and gallery, the roofing parser and rules.

**Commodity, buy or keep external**: accounting (QBO via cc-allocator), email (MailerSend), SMS (Twilio), address autofill (Mapbox Search), batch geocoding (Census), weather (Open-Meteo), basemaps (OpenFreeMap/Protomaps), parcel data where public endpoints fail (Regrid per record), e-sign escape hatch (Docusign/Dropbox Sign at ~$50–75/month only if a customer or lender demands it), permit market intel (Shovels, not needed), supplier price scraping (invoice-derived prices suffice in year one).

**Low ROI at this size**: an RFI entity (a task kind suffices), certified payroll/Davis-Bacon, a warehouse ledger beyond yard consumables, a tenant/organisation entity, a PWA beyond the existing offline drafts, forensic delay analysis, Monte Carlo cost risk, S-curves from typed points, EVM/TCPI engines, proposal-option analytics before a proposal entity is used, fleet telemetry beyond trucks.

**Over-complex**: external orchestrators (Temporal, Windmill, Trigger.dev self-host, n8n, Kestra, Hatchet now), embedded BI (Superset, Metabase embedded, Lightdash, Redash, Grafana), vector/RAG stacks (Qdrant, LanceDB, ParadeDB, LlamaIndex, LangChain), agent frameworks (CrewAI, AutoGen, OpenAI Agents SDK, smolagents, the Claude Agent SDK in production), BIM/IFC/DWG import, ISO 19650 CDE, a Python sidecar before any feature needs one, self-hosted routers and geocoders with Florida extracts.

**Dangerous AI automation, never**: autonomous permit portal submission or inspection scheduling; LLM-priced estimate lines; auto-applied norm, rule or price changes from the learning loop; acquisition or feasibility decisions; AI writing any money figure; AI sending customer legal notices; AI browsers for anything that binds the licence.

**Licensing problems**: everything RED in Section 26; the GPL `roofer` binary only across a process boundary.

**Maintenance-heavy integrations**: ERPNext/Odoo/Tryton sidecars, Docassemble's Docker stack, WebODM, Activepieces unless third-party connectors are required, docling and unstructured, InvenTree without a warehouse, Traccar without hardware trackers.

**Features employees probably won't use**: a chat-style AI assistant, a second time-tracking app beside `/field`, a vendor portal, a customer portal beyond token pages, unread "AI summaries", a 90-step workflow (prod already proved it: ~1,320 steps with 25 completed before the slim templates).

## 30. 30 / 90 / 180 / 365-Day Roadmap

**Roadmap by phase** (complexity S days, M 1–2 weeks, L 3–5 weeks, XL more; every stage keeps the CRM's gate of typecheck, lint ≤ baseline, tests green, build clean, dry-run scripts, deploy with the env override, Richard's click-through before the next stage).

**PHASE 0 — Foundations**
- **0.1 pg-boss queue + outbox + worker unit** — WHY no queue, long work in requests, 12 crontab crons · VALUE every later feature needs it · TECH pg-boss (MIT), DBOS checkpoint concept · MODULES new `src/lib/queue/*`, `src/lib/cron/auth.ts`, every `src/app/api/cron/*` · ARCH pg-boss schema in the same Postgres; `careyos-worker` systemd unit; outbox in the business transaction · DATA pg-boss tables, `OutboxEvent`, `JobRun` · UI Admin → Background Jobs · API `GET /api/admin/jobs`, retry · JOBS the 12 crons migrated one at a time · SEC admin-only; worker shares the env file · LIC MIT · TEST stubbed boss; parity invariant per migrated cron · SIZE M · DEPS none · METRIC 0 crontab lines for migrated crons; 12 schedules with last-run < interval.
- **0.2 Money-model cleanup** — WHY four incrementers write `contractAmount`, two cost summaries, expense enums in four places, two unguarded budget routes · VALUE makes the spine safe · TECH in-house · MODULES `src/lib/services/{jobs,financials,job-pricing}.ts`, `src/lib/jobs/overview.ts`, `src/lib/budget/parse.ts`, expense routes · ARCH one recompute for contract amount; every reader on `computeCostSummary` · DATA drop `AiSession`, `PasswordResetToken`, `Inspection`, `PermitLookupRun`; keep `DashboardMetricSnapshot` · UI budget import preview diff · API `guardJob` on budget line POST/import · SEC the two routes · LIC licence scanner + CI deny-list grep · TEST before/after invariant on every job's summary · SIZE M · DEPS none · METRIC 0 code paths writing `contractAmount` outside the recompute; 26 jobs identical before and after.
- **0.3 CostCode tree + seed + ruling** — WHY only labour uses codes; 456 expenses carry none · TECH in-house · MODULES `api/cost-codes`, `lib/labor` · ARCH division → code → sub with cost type; ~60 codes drafted from expense types, template sections and roofing categories · DATA `CostCode` columns; mapping table · UI Admin → Cost Codes · SIZE S · DEPS cost-code ruling · METRIC 100% of expenses mapped in a dry run with an accepted Unallocated count.
- **0.4 `lib/ai` scaffold (dormant)** — WHY one audited entry point before any feature · TECH @anthropic-ai/sdk, zod · DATA `AiRun`, `AiSettings` · UI Admin → AI (switches, spend) · SEC allowlists; no personnel data · SIZE S · DEPS 0.1 · METRIC `AiRun` count 0 until Phase 4.

**PHASE 1 — Quick wins**
- **1.1 Typed daily-log entries + punch items** — MODULES `lib/labor/log-service.ts`, `/field`, field-log routes · DATA `DailyLogEntry`, `PunchItem` · SIZE S · METRIC ≥ 60% of logs with a typed entry; punch open vs closed per job.
- **1.2 Project health score v1 (operational factors)** — TECH simple-statistics · MODULES `health.ts`, `attention/rows.ts`, Overview · DATA `JobHealthSnapshot` nightly · SIZE S · DEPS 0.1, 1.1 · METRIC every open job scored; At Risk count = list.
- **1.3 Analytics snapshots + metrics registry** — MODULES `lib/reports`, `DashboardMetricSnapshot` · ARCH typed registry; nightly facts; materialised views · SIZE S · DEPS 0.1 · METRIC 30 consecutive nightly rows per metric.
- **1.4 Property + Jurisdiction (minimal)** — TECH ArcGIS REST / fetch client, Census geocoder, PostGIS + Turf when polygons · MODULES new `lib/property`, leads, permits, canvassing · DATA `Property`, `PropertyLayer`, `PropertyLink`, `Jurisdiction` · UI Property card on lead and job; jurisdiction picker on permits · JOBS `enrich-property` · SIZE M · DEPS 0.1; jurisdiction list · METRIC 90% of open leads with a parcel id; 0 permits with free-text jurisdiction after backfill.
- **1.5 E-sign hardening, first tier** — TECH LibPDF P12 seal, RFC 3161 TSA, @signpdf fallback, pyHanko in CI · MODULES `lib/customer-contracts`, `api/sign` · DATA `SigningEvent`, `EsignDisclosure`, seal columns · SEC cert outside the repo · SIZE M · DEPS 0.1 · METRIC 100% of new contracts with a valid seal and timestamp.
- **1.6 Deterministic cost-code suggestion on expenses** — TECH Paperless matcher concept · DATA `JobExpense.costCodeId`, `MatchRule`, decision ledger · SIZE S · DEPS 0.3 · METRIC acceptance ≥ 70% after a month.

**PHASE 2 — Financial intelligence**
- **2.1 Cost-code spine + budget buckets + ETC/EAC** — MODULES `cost-summary.ts` (one formula), `job-cost.ts`, `lib/budget`, Budget panel, Collections · DATA buckets on `BudgetLine`, codes on expenses/commitments/CO items, `JobCostSnapshot` · UI Budget by code; EAC/VAC on the cost card · API `cost-summary` gains `lines[]`; ETC override route · JOBS monthly snapshot · SEC who-sees-cost ruling · TEST Σ lines = totals; read-only prod comparison · SIZE L · DEPS 0.2, 0.3 · METRIC budgets on open billable jobs 3 → 17; EAC on every open job.
- **2.2 Estimate snapshot → budget + one estimate line model** — MODULES `lib/estimates` (one calculator), `lib/roofing/engine`, `sign-service.ts` · DATA line columns, `EstimateLineResource`, `EstimateSnapshot`, `EstimateMarkupStep`, `EstimateAllowance` · UI builder with kinds and markup panel; "Seed from contract" preview · TEST every prod estimate total reproduced to the cent · SIZE L · DEPS 2.1 · METRIC 100% of new contracts seeded from a snapshot; roofing estimates with engine-written lines.
- **2.3 Commitments from POs / receipts** — DATA `Commitment.kind`, `CommitmentLine`, receipts · ARCH open = Σ(line − billed, not closed) floored; Stop/Warn/Ignore gate at PO issue · UI PO builder, Record delivery (also from the daily log) · SIZE M · DEPS 2.1 · METRIC 60% of material expenses linked to a commitment line in a quarter.
- **2.4 Subcontract pay apps + retention + lien waivers** — MODULES `lib/labor/*`, labour contract card, `lib/vendors/compliance.ts` · DATA `SubcontractPayApplication`, `RetentionLedger`, `LienWaiver` templates/instances, compliance blocks-payment · SIZE L · DEPS 2.1, 2.3; block-vs-warn ruling; counsel on forms · METRIC 0 payments over contract + approved COs; % payments with a verified waiver.
- **2.5 Health score v2: margin-erosion factors + rows** — SIZE S · DEPS 2.1, 1.2 · METRIC precision of High flags against final GP drop > 5 points.
- **2.6 CostIndex** — DATA `CostIndex` view/table (code, trade, county, year, unit, median, n) · API keyed read-only for landdev · SIZE S · DEPS 2.1, 1.4 · METRIC codes with n ≥ 5 closed jobs.
- **2.7 Learning loop reports from existing data** — the four read-only cards (Section 23) · SIZE S · DEPS 1.3.

**PHASE 3 — Estimating intelligence**
- **3.1 Roofing takeoff writes the full estimate** — DATA `LaborNorm`, `NormMaterial`, `RoofSystem` · TEST goldens from the 23 Roofr PDFs · SIZE M · DEPS 2.2 · METRIC roofing estimates with 0 typed material cost.
- **3.2 Post-calc learning loop + roofing cost-per-square** — MODULES new `lib/learning`, Admin → Norms · DATA `ProductivityObservation`, `CostVariance`, `Recommendation` · SIZE M · DEPS 2.1, 2.2, 3.1, a quarter of closed jobs · METRIC labour estimate-vs-actual by code trending to ±5%.
- **3.3 Price quotes + package comparison + drift** — DATA `PriceItem/VendorSku/PriceQuote` · JOBS nightly stale/drift scan · SIZE M · DEPS 2.2, 2.3 · METRIC items with a quote under 90 days; drift alerts acted on.
- **3.4 Plan takeoff v1** — TECH pdf.js vectors, OpenTakeoff concepts with NOTICE, pdfplumber heuristics in TS, PaddleOCR-ONNX · DATA `PlanDocument/Page/Measurement/Schedule` · SIZE XL · DEPS 2.2, 0.1 · METRIC estimate lines with a plan measurement source.

**PHASE 4 — Operational automation**
- **4.1 Permit rule table + 553.792 clocks + packets** — TECH LibPDF forms, pdfme overlay, tdranalysis rules-table shape, Docassemble wizard concept · DATA `PermitRule`, clock columns on `JobPermit`, `feeReductionClaimed` · SIZE L · DEPS 1.4, 1.5; jurisdiction list · METRIC median days packet → issued; fee reductions claimed.
- **4.2 Invoice / receipt intelligence** — TECH unpdf, Anthropic zod extraction, tesseract.js optional · DATA `DocumentExtraction`, `ExtractionCorrection`, `VendorExtractionHint` · UI split-pane review · SIZE L · DEPS 0.1, 0.4, 2.1, 2.3, vendor directory · METRIC minutes per invoice upload → approved; % auto-matched to a commitment.
- **4.3 CPM + Gantt + delay signals** — TECH in-house CPM, SVAR Gantt · DATA durations on templates, CPM columns on `Task` · SIZE M · DEPS 1.4, 2.3, 1.1 · METRIC critical-step slip days; jobs within target ± 5 days.
- **4.4 VROOM dispatch** — DATA `PersonnelSkill`, licence expiry, dispatch proposals as recommendations · SIZE M · DEPS 0.1, 3.2 · METRIC proposals accepted; licence-lapse assignments blocked.
- **4.5 Equipment / asset model** — SIZE S · DEPS 1.1 · METRIC assets with a known custodian today.

**PHASE 5 — Advanced AI**
- **5.1 Roofing LiDAR PoC with validation bands** — separate `roofmeasure` service (PDAL + roofer subprocess + TS classifier emitting the Roofr schema) · DATA `RoofMeasurementComparison` · SIZE XL · DEPS 1.4, 0.1 · METRIC 30 consecutive ACCEPTABLE vs field truth per roof class.
- **5.2 Plan takeoff v2** (sheet/scale proposals, template sweep, scans) · SIZE L · DEPS 3.4, 0.4.
- **5.3 Bounded document agent + scope extraction + narratives** · SIZE L over quarters · DEPS 0.4, 1.1, 2.5 · METRIC proposals accepted vs rejected per feature.
- **5.4 "Jobs like this one"** · SIZE S · DEPS 2.1, 1.4.

**PHASE 6 — Predictive intelligence**
- **6.1 Redevelopment discovery** (Property + FDOR + roof age + permits on record + flood/surge + canvassing → ranked prospects; LLM-drafted zoning rules approved row by row; feasibility in landdev on the CostIndex) · SIZE L · DEPS 1.4, 2.6.
- **6.2 Crew productivity → dispatch durations and norms** · SIZE S · DEPS 3.2, 4.3, 4.4.
- **6.3 Permit turnaround learned per jurisdiction** · SIZE S · DEPS 4.1.
- **6.4 Vendor scorecards** · SIZE S · DEPS 2.3, 2.4, 1.1.
- **6.5 Margin trend and cohorts** (by trade, estimator, PM, jurisdiction from snapshots; MAD outliers) · SIZE S · DEPS 2.1, 1.3.
- **6.6 Repeat-customer / property history** · SIZE S · DEPS 1.4.

**By day 30** — ships 0.1 (first three crons migrated), 0.2, 0.3, 1.1. Operator items: SPF record for `knuconstruction.com`; cost-code list ruling; who-sees-cost ruling; Admin → Workflow Roles saved. Outcome: 0 crontab lines for migrated crons; 456 expenses mapped in a dry run; typed entries on daily logs.

**By day 90** — ships 2.1, 2.2, 1.2 + 2.5, 1.4, 1.3, 1.6, 1.5, 2.7. Operator items: vendor directory built from Vendors → Unmatched; the jurisdiction list; waiver block-vs-warn ruling; `RoofEstimate` retirement ruling. Outcome: budgets on open billable jobs 3 → 17; EAC and a health score on every open job; 90% of open leads with a parcel id; digests on.

**By day 180** — ships 2.3, 2.4, 2.6, 3.1, 3.3, 4.2 (review mode), 4.1 (first five jurisdictions), 4.3. Operator items: counsel review of 713.20 forms and contract disclosures; org signing certificate; Anthropic key and cost cap; supplier-scraping ruling (default no). Outcome: 60% of material expenses on commitment lines; 0 payments over contract; minutes per invoice measured; permit days by jurisdiction on the dashboard; first fee-reduction claim computed.

**By day 365** — ships 3.2 (first recommendations after a quarter of closed jobs), 3.4, 4.4, 4.5, 5.1 (shadow), 5.3, 5.4, 6.1–6.6 as data allows. Operator items: skills and licences on personnel; field-verified roof truth on 30 jobs; Traccar devices only if wanted. Outcome: roofing labour estimate-vs-actual within ±5% by code; LiDAR ACCEPTABLE streak counted; discovered prospects → leads; GP trend by trade for four quarters.

## 31. Final Recommendation

Treat GitHub as a library of shapes and a short list of permissive tools, not as a source of modules. Adopt fifteen small, well-maintained pieces (a Postgres queue, the PDF engine already in use, a sealing library, a routing solver, a Gantt, robust statistics, spatial data tools, the Anthropic SDK, IRR arithmetic) and build everything else natively inside the CRM's existing models and rules, in the order the dependencies dictate: queue and cost codes first, then budget buckets with a forecast on every job, then the estimate baseline that seeds the budget and the takeoff that writes the estimate, then commitments, subcontract applications and waivers, then the learning loop over hours the field already books. Put every AI output behind a proposal row and a person; keep money, quantities, dates and measurements deterministic. The result in a year is not a construction CRM with AI features but an operating system that forecasts profit on every job, prices from its own calibrated norms, computes Florida's permit and lien law instead of remembering it, and gets measurably better with every closed job, on data no competitor can buy.

### The twelve questions

1. **Five capabilities in 90 days**: the foundation (queue, money cleanup, cost codes); cost-code spine with buckets and EAC; estimate snapshot → budget with the roofing takeoff writing lines; health score with margin-erosion rows; Property + Jurisdiction. These are the financial core plus the two cheapest high-ratio features and the key everything later joins on.
2. **Greatest effect on gross profit**: EAC on every job (est. $1–5K per job caught a month earlier); the learning loop on labour norms (est. $45–75K a year on $1.5M of labour); pay applications with waivers and retention (stops overpayment like JOB-00002 and makes progress-billed commercial work repeatable).
3. **Most employee time saved**: the invoice/receipt pipeline (est. 3–5 office hours a week); the roofing takeoff writing the estimate (est. 30–45 minutes per quote); permit packet generation and clocks (est. 1–2 hours per application plus the chasing removed).
4. **Strongest data moats**: crew productivity by cost code from hours already booked; property history keyed by parcel across leads, jobs, permits, roof measurements and warranties; price history from the company's own invoices and POs by vendor and item.
5. **Buy or integrate rather than build**: accounting (QBO), email and SMS delivery, Mapbox Search, Census geocoding, basemaps, public parcel/flood/LiDAR data, TSA timestamps, the VROOM solver, the roofer binary across a process boundary, the Anthropic API; an e-sign SaaS only if a customer demands it.
6. **Directly integrate**: pg-boss, @anthropic-ai/sdk, LibPDF, pdf.js (extend), unpdf, simple-statistics, Turf, PostGIS, VROOM, SVAR Gantt, ArcGIS REST client, PDAL + roofer (subprocess), PaddleOCR-ONNX, pdfme (pinned), `financial`/formulajs, Microsoft footprints, Protomaps.
7. **Study but not integrate**: OpenConstructionERP, Bidwright, OCA field-service, ERPNext/Odoo/Tryton, Paperless-ngx, Documenso, massing/massingbill, BuildSuite, tdranalysis, Shelf.nu/Snipe-IT, InvenTree, OpenProject, LangGraph/Mastra, Docassemble.
8. **Improve inside CareyOS first**: the money model (one contract recompute, one cost summary, centralised enums, guarded budget routes), the operator switches already built but off (SPF, digests, workflow roles, vendor directory, the roofing import), and the dead models. Intelligence over an inconsistent money model produces confident wrong numbers.
9. **Single biggest operational gap**: no cost-to-complete, because 14 of 17 open billable jobs have no budget and committed cost is typed, so margin is learned at closeout.
10. **Single biggest intelligence opportunity**: the estimate ↔ actual chain by cost code, which feeds forecasting, the learning loop, the cost index, vendor scorecards and jobs-like-this from one join.
11. **Most differentiating feature**: Property-keyed statutory automation (jurisdiction rules, 553.792 clocks and fee-reduction claims, NOC and 713.20 waivers as versioned templates), because conventional construction CRMs track permits as dates while this one computes the law.
12. **Built from data it already possesses that competitors cannot reproduce**: crew productivity norms and cost per square by roof class, pitch and crew from `DailyLaborEntry` hours and Roofr geometry; permit turnaround by jurisdiction from its own permits; price drift from its own invoices; canvassing outcome scores by parcel; and the audit trail from lead to payroll that lets every number show its provenance.

### Appendix A — Open rulings this roadmap needs from Richard

1. The company cost-code list (a ~60-code draft is generated from existing types, sections and roofing categories for review).
2. Who sees cost and margin (decides role lists for pricing, budgets, recommendations).
3. Whether the lien-waiver gate blocks or warns by default; counsel's reading of 713.20 and 713.06.
4. When `RoofEstimate` retires (Phase 2 or one more season beside the new line model).
5. The list of jurisdictions to seed first (10–15 worked).
6. Whether supplier price scraping is wanted at all (default no; invoice capture suffices).
7. Whether hardware GPS trackers are wanted (Traccar only then).

### Appendix B — Sources

GitHub REST API and LICENSE files for every repository named (2026-10-07); Hugging Face model cards for weights; Fla. Stat. 553.79, 553.792, 713.13, 713.135, 713.20, 713.06, 668.50; USGS fact sheet FS 2023-3037 and NOAA InPort item 64526 (Florida LiDAR); Google Solar API policies; EagleView 2025 accuracy study and carrier pilot; FDOT historical item averages and APLUS; NREL PV Rooftop Database; FDOR 2026 NAL users guide and FGIO parcel FeatureServer; FEMA NFHL; DigitalOcean supported Postgres extensions; Nominatim usage policy; OpenFreeMap; Census Geocoding Services; Accela developer documentation and Manatee/Escambia case studies; DBPR construction public records; Docusign and Dropbox Sign pricing pages; FloorPlanCAD and CubiCasa5k licence pages; the OpenConstruction dataset survey (arXiv 2508.11482); `CAREYOS_OPENCONSTRUCTIONERP_INTEGRATION_ANALYSIS.md` (2026-10-07).
