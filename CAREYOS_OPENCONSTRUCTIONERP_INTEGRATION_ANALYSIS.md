# CareyOS × OpenConstructionERP — Integration Analysis

_Discovery and architectural analysis, 2026-10-07. Read-only: no CareyOS code was modified, nothing was installed, nothing was copied. OpenConstructionERP (OCE) was cloned into a session scratch directory outside every CareyOS repository and read as untrusted data; nothing from it was executed._

**Scope of "CareyOS" in this report.** The construction operating system today is the KNU Construction CRM (`construction-crm/constructioncrm`, Next.js 16 + Prisma/PostgreSQL, 126 models, 346 API routes, 263 commits) plus the fleet apps it talks to: the CareyOS portal (identity only), cc-allocator (money that moved), the live roofing estimator at `roofing.careyos.com`, and the phone-routing app. The CRM is the system of record for jobs and job costing and is the target of every recommendation below.

**OCE at a glance.** Version 18.4.0 (2026-10-04), one author, 397 releases since 2026-03-30, FastAPI + SQLAlchemy backend of 1.09M Python lines across 194 modules (642 tables, 3,887 routes), React/Vite frontend, embedded-PostgreSQL desktop build, ~2,400 backend test files. Licence AGPL-3.0-or-later with a second AGPL licensor (PyMuPDF) in every install, proprietary CAD converters, and cost data that is CC BY-NC upstream.

---

## 1. Executive Summary

**Do not install, embed, link, port or copy OpenConstructionERP.** Every form of code reuse is RED under its licence stack (AGPL-3.0-or-later on OCE, AGPL on PyMuPDF in every install, a proprietary ODA-based converter whose EULA forbids SaaS use, and a cost database that is non-commercial upstream with the largest base's legal basis recorded as "PENDING"). Running it as a separate service is YELLOW at best and buys nothing CareyOS needs. Section 5 has the full classification.

**Do learn from it.** OCE's arithmetic core is real: Decimal-exact, pure, tested, and in a handful of places better designed than anything CareyOS has. Seven of its design patterns answer exactly the gaps found in the CRM:

| CRM gap (verified in code) | OCE pattern worth re-implementing cleanly |
|---|---|
| Two lump-sum estimate calculators; `materialCost` is one typed number; the roofing takeoff is a preview nothing consumes | Per-unit **resource split** on every priced line (labour hours, materials, equipment, sub) with the invariant `unit_rate = Σ qty × rate`, plus a **productivity norm** library separate from money |
| `CostCode` exists but only field labour uses it; budget lines, expenses, commitments and estimate lines carry no code | A real **cost-code spine** as a foreign key on every money row |
| `projectedCost = max(estimate, committed)`; no cost-to-complete, no forecast, no history | **Budget buckets** (original · approved changes · pending changes · committed · actual · forecast) with commitment **derived from documents**, idempotent sync markers, and a monthly snapshot |
| No estimate → budget → actual link; nothing seeds a budget from an estimate | **Immutable estimate snapshot** as the contract baseline that seeds the budget by cost code |
| `JobComparison` / `RuleChangeRecommendation` left behind in the roofing estimator; no learning anywhere in the CRM | **Post-calculation**: earned hours from installed quantity, `productivity_factor = actual ÷ earned`, coverage-gated recommendations, nothing auto-applied |
| Commitments are a typed amount; no POs, no sub pay applications, no retention ledger, no lien waivers | **Purchase order → goods receipt → invoice** commitment chain; **subcontract pay application** with retention ledger and a **lien-waiver** table gating payment |
| Margin, fees and contingency are flat percentages inside two calculators | **Markup cascade with explicit bases** (overhead · contingency · insurance · bond · profit · tax, each naming what it compounds on) and **allowances with drawdowns** |

**What CareyOS already does better** and should keep untouched: the workflow engine, task spine and calendar; field daily logs with per-worker hours, GPS check-ins, OT and payroll; permits/inspections as one record; code-violation cases; customer contracts with single-use signing and frozen snapshots; G702/G703 progress billing; the cc-allocator reconciliation; vendor compliance derived on read; explicit role lists on every route. OCE's equivalents are either duplicated several times over, metric/EU-institutional, or weaker (its field labour never prices overtime and probably double-posts).

**The recommendation** is a native build in six phases (Section 18), starting with a cost-code spine and budget buckets inside the existing `computeCostSummary`, then a unified estimate line model that the roofing takeoff and the template builder both write to, then the learning loop over data the CRM already collects. Nothing in the roadmap depends on OCE at runtime. The five concepts that create the most measurable value in 90 days are in Section 21.

---

## 2. CareyOS Current Architecture

### 2.1 Platform

- **Stack**: Next.js 16.2.3 App Router, React 19, Prisma 7 on PostgreSQL (pool max 8 / min 2, shared cluster), zod validation (`validateBody` in 150 route files), `@react-pdf/renderer` (13 renderers), MailerSend, Open-Meteo, Mapbox/Leaflet, pdfjs-dist for Roofr reports. Deployed to one droplet under systemd (`knuco`, port 4000) behind Cloudflare at `crm.careyos.com`.
- **Identity**: CareyOS portal SSO; the CRM introspects the `careyos_session` cookie per request (`src/lib/sso.ts`, `src/lib/auth/helpers.ts`), finds-or-creates `User` by email, and enforces seven roles plus four DB grants. Explicit role lists live in `src/lib/access/roles.ts` and per-module `access.ts` files; own-only roles get 404 outside their lists (`src/lib/access/records.ts`).
- **API**: 346 route files under `src/app/api`, convention `<resource>/[id]/<action>/route.ts`; machine routes use bearer keys with 503-unset / 401-bad. Twelve cron routes behind `x-cron-secret`, driven by droplet crontab wrappers.
- **Audit**: `AuditEvent` through `recordAudit` (72 caller files; typed union plus ~30 free-string actions).
- **Storage**: local disk under `UPLOADS_DIR` (`src/lib/files/storage.ts` is the single seam); no object storage; 190 older uploads are missing on disk.
- **Background work**: none in-process; everything is cron-triggered HTTP. No queue, no scheduler library.
- **AI**: none. `grep -ri "anthropic|openai|llm|embedding|claude"` over `src` returns nothing; an unused `AiSession` model is scaffolding. In the fleet, Anthropic SDK use exists only in closing-brain, knu-phone-routing (voicemail summary) and fl-buyback-docs.

### 2.2 Domain map (what it does, traced in code)

**Leads → estimates → contract → job.** There is no Property, Customer or Contact entity: the `Lead` row is customer and property (address, county, property type, services, stage history, source, assigned rep, `estimatedJobValue`). Two estimate families sit on the lead: `RoofEstimate` (squares × labour rate + one typed `materialCost` + nine fee columns + true margin `price = cost ÷ (1 − m)` + discount + tax; no status) and the template `Estimate` with sections and `EstimateLineItem` rows (qty × unitPrice, optional lines, identical margin/discount/tax pipeline, DRAFT/SENT/ACCEPTED/DECLINED). A `CustomerContract` is generated from exactly one accepted estimate (DB CHECK), snapshots it, and signing sets `Job.contractAmount`, `originalContractAmount`, `depositRequired` and the base SOV line. `createJobFromLead` seeds the job's contract from `Lead.estimatedJobValue`, not from any estimate; the only estimate → job money path is the signed contract.

**Job costing.** One pure formula (`src/lib/jobs/cost-summary.ts`, loaded by `src/lib/services/job-cost.ts`): spent = labour paid + unposted field labour + approved expenses; committed = spent + open labour commitment + open commitments; `projectedCost = max(estimatedCost, committed)`; projected profit and margin; `percentCostComplete = committed ÷ projected`; over/under billed. Inputs: `BudgetLine` (flat; category free text; no cost code), the signed estimate's `subtotalCost` as fallback, `JobExpense` (seven-value type enum, APPROVED gate, vendor match, receipts, cc-allocator `externalId`), `LaborContract` + `LaborChangeOrder` + `LaborPayment`, `DailyLaborEntry`, `Commitment` (typed amount, vendor, optional budget line, drawn down by linked expenses).

**Customer money.** `ChangeOrder` (positive price only, token approval page, approval adds to `contractAmount` or a `SovLine`), lump-sum `Invoice` (no lines) and PROGRESS applications (`computeApplication` G702/G703 with retainage and release), `Payment` (drives `balanceDue` through one writer), A/R aging, QBO export as a CSV of approved expenses only.

**Operations.** Workflow engine (templates in code, versions, generations, subject = job or violation case, pure compose/apply/reconcile/activation, record gates that complete themselves, stage follows the workflow); tasks as the one spine (`createTask`/`updateTask`, 28 event types, evidence and checklists, escalations, auto-tasks, nudges); calendar with one date axis, dispatch, people view and read-only overlays; field module (personnel with encrypted SSNs, crews, daily logs with weather and 13 narrative sections, `DailyLaborEntry` with clock times, GPS check-in/out, OT engine, payroll runs, photos with GPS, field issues → tasks, offline drafts); permits and inspections as one record with alert tasks; code-violation cases (items, hearings, agency inspections, fines ledger computed on read, deadlines and escalations); files with job ownership, preview, missing-on-disk state, receipts, gallery; notifications v2 (recording, digests, delivery switch off); nurture engine (off pending SPF); attention dashboard (count and list share one `where`); canvassing with Zylow scoring and route optimisation.

**Vendors.** `Vendor`/`VendorAlias` with word-start payee matching run on every expense write, compliance derived from documents on read (GL, WC, W-9, licence), expiry tasks, commitments with open amount, `vendorId` on expenses, crews, labour contracts, roofing materials.

**Roofing (P0 on prod).** Pure library `src/lib/roofing/*`: Roofr PDF parser (pdfjs, per-field confidence, waste read from glyph positions), `RoofMeasurement`, ~45 default takeoff rules with company deltas in `RoofRule`, `RoofMaterialItem` + append-only `RoofMaterialPrice` in force by day, `generateEstimate` producing a **materials list only** (no labour, fees, margin or price) reachable only through a preview route. The import of the estimator's catalogue is on prod and not yet run.

### 2.3 Strengths, partials, duplicates, gaps, debt

**Done well**: explicit role lists everywhere; one cost formula; one task write path; pure engines with tests (1,536 tests); contract snapshots and single-use signing; G702 math; cc-allocator intake with twin detection; vendor compliance on read; the field labour/OT/payroll chain; audit trail on money.

**Partial / started, not finished**: roofing takeoff with no consumer; `RoofEstimate.materialCost` typed by hand; import script not run; `BudgetAllocation.dailyLaborEntryId` written but not surfaced; `labor-summary` route's comment promises budget-vs-actual "in the financial-integration phase"; `CostCode` used only by field labour; lump-sum invoices without lines; QBO export with a blank Account column; Twilio inbound webhook unreachable; Outlook intake with no scheduler; phone-routing lead endpoint keyless; Code Violations Stage 4 reports; notifications Stages 3–4; `PermitConnector` with a mock only; `ManagerAlertSettings` with no verified UI.

**Duplicated**: two estimate calculators, two PDF renderers, two brand loaders and two admin brand routes over one table; `getFinancialSummary` cost formula beside `computeCostSummary`; `overview.ts` fallback sum; route-local expense enums repeated four times; four generations of automation (`FollowUpRule` never scheduled, auto-tasks, nurture, alert-runs); `JobPermit` vs lead-level `Permit`/`PermitLookupRun` vs retired `Inspection`; `NotificationEvent` vs `Notification` vs `TaskEvent EMAIL_SENT`; `Job.scheduledDate` vs `targetStartDate` vs `CrewAssignment.installDate`; `FieldPhoto` vs image `File`; three materials catalogues across the fleet (knu-estimator, roofestimator, CRM) and six `Property` tables across apps joined only by address strings.

**Missing** (0 hits in `src`): purchase orders, RFIs, punch-list items, equipment/fleet assets, Gantt/durations, subcontractor pay applications and lien waivers (W-9 is a document type only), cost-to-complete, cost codes on money, estimate line → budget line link, price history on anything but roofing prices, supplier quotes, any AI.

**Dead**: `AiSession`, `PasswordResetToken`, `DashboardMetricSnapshot`, `Inspection`, `PermitLookupRun` (0 callers each); `User.passwordHash` sentinel; `@auth/prisma-adapter`, `@zxcvbn-ts/*`; `scripts/follow-up-tick.sh`; `/admin/follow-up-rules` for an engine that never runs on prod.

**Technical debt**: `Job.laborCost` overloaded (manual figure vs rollup; on cost-plus jobs it sets what the customer owes); `Job.contractAmount` mutated by increments from four places rather than derived; FIXED_PRICE original contract reconstructed arithmetically when no contract was signed; destructive budget import; budget line POST without `guardJob`; local-disk uploads on the same box as backups; in-memory rate limiter; `AuditAction` free strings; ~46 raw `fetch().json()` call sites; lint baseline 5–6 errors; `prisma migrate dev` unusable on dev.

### 2.4 Data the CRM already collects that can power the proposed features

- Quoted cost, quoted price and margin per job frozen in `CustomerContract.snapshot`; actuals in `JobExpense` (typed, dated, vendor-matched, APPROVED-gated), `LaborPayment`, `DailyLaborEntry.totalCost` (hours × rate, cost-coded), `PayrollPayment`. Everything for a per-job "estimated margin → realised margin" series exists; what is missing is a join from estimate lines to cost categories.
- Line-level quantities: `EstimateLineItem` {description, unitType, quantity, unitPrice}; roofing `roofTypesJson` {squares, laborRatePerSquare}; `RoofMeasurement` geometry; takeoff `EstimateResult.items` with `ruleKey` per category.
- Per-worker, per-day, per-job labour hours with cost code, phase, OT split, late/absent flags and GPS — the actuals side of a productivity loop.
- Price history: `RoofMaterialPrice` append-only by day; every purchase as `JobExpense.vendor/vendorId/amount/incurredDate`; `Commitment.amount` vs linked expenses; labour contract vs payments per crew.
- Physical progress proxies: `LaborContractTask.status/paymentPercent`, `InvoiceLine.workCompleted ÷ SovLine.scheduledValue`, workflow milestone completion, daily-log narrative.
- Timing: permit submitted/approved/expired per jurisdiction; workflow step `activatedAt/completedAt`; stage history; daily-log weather and delay text.
- Prod scale (read-only checks recorded in CLAUDE.md): 26 jobs, 456 expenses, labour contracts $1.52M, approved expenses $0.80M, 3 of 17 open billable jobs carry a budget, 1,357+ tasks, 106 daily-log photos on one job.

---

## 3. OpenConstructionERP Architecture

### 3.1 Stack and shape

Python ≥ 3.12, FastAPI, SQLAlchemy 2 async, Alembic (380 migrations), Pydantic v2, JWT (HS256), bcrypt; PostgreSQL only (an embedded cluster via `pixeltable-pgserver` when no `DATABASE_URL`); pandas/pyarrow/DuckDB for parquet lookups; PyMuPDF, pdfplumber, pypdf, OpenCV, ezdxf, trimesh, reportlab in the base install; optional Celery+Redis, LanceDB/fastembed, Qdrant + BGE-M3, paddleocr. Frontend React 18 + Vite + TanStack Query + Zustand + AG Grid + pdfjs + three.js + cesium, 44 locales (~2.2M lines of locale files). Desktop: Tauri shell around a PyInstaller sidecar bundling the SPA, the catalogue and PostgreSQL.

### 3.2 Module system

`backend/app/core/module_loader.py` discovers `app/modules/*/manifest.py` (194 found; `MODULES.md` says 193), topologically sorts by `depends`, mounts `router.py` at `/api/v1/<kebab>`, imports `models.py`, `hooks.py`, `events.py`. The "marketplace" is a static in-code catalogue of 65 free entries; partner packs (48) are pip packages of JSON rule descriptions and onboarding YAML. The frontend has one hand-written feature directory per backend module (192), not generic CRUD.

### 3.3 Core model, auth, tenancy

`User` (role string, OIDC columns, per-session revocation), `Project` (region, classification standard defaulting to **DIN 276**, currency, contract value, budget estimate, contingency %, address JSON), `ProjectWBS`, `Team`/`TeamMembership`. RBAC is a seven-role hierarchy with a permission registry mapping permission strings to a minimum role; `APIKey.permissions` is the only per-principal override. **Not multi-tenant**: `core/tenant_scope.py` states "There is no separate Tenant/Org entity… The 'tenant' is simply the owning user's id"; RLS is default off and the embedded cluster runs as superuser.

### 3.4 Background jobs

A Celery factory exists, but `submit_job()` falls back to `asyncio.create_task` in-process when no broker answers within 2 s; the desktop build has no Redis, so BIM extraction, imports and AI runs execute on the API event loop. No scheduler/beat; a 24-hour loop in `main.py` fills KPI snapshots.

### 3.5 AI layer

httpx-only client, no SDKs; 20 provider ids (most via one OpenAI-compatible path); per-user keys; graceful degradation when no key. Vectors via local sentence-transformers into LanceDB or Qdrant. Output handling is a three-stage `extract_json` with no structured-output validation. Audit is uneven: agent runs and chat persist prompts; `AIEstimateJob` keeps outputs, not prompts. `ai_agents/sandbox.py` seeds fake pre-scored runs so the accuracy board looks populated.

### 3.6 Maturity (194 modules, LOC-tiered and hand-checked)

| Tier | Count | Examples |
|---|---:|---|
| Real, large (≥ 8K LOC) | 32 | boq 57K, property_dev 36K, contracts 26K, costs 25K, schedule 25K, finance 17K, takeoff 17K, match_elements 14K, variations, changeorders, procurement, subcontractors, assemblies |
| Real, mid (3–8K) | 58 | full_evm, field_time, postcalc, punchlist, rfi, risk, methodology, bid_management, supplier_catalogs, crm, equipment, safety |
| Thin-but-functional CRUD (1.5–3K) | 47 | labor_rates, markups, catalog, cvr, compliance_docs, tasks |
| Thin / plumbing / facade / static config | ~50 | waste_factors (849), preliminaries (851), estimate_rollup, us_pack (a 376-line dict), 12 regional config packs, cad (two helpers, converters are external) |
| Developer tooling | 3 | module_builder, architecture_map, global_presence |

Verified defects worth knowing: four EVM engines that disagree (one counts POs and client receipts as actual cost); labour likely posted twice to the budget (timesheet approval and payroll finalisation under different idempotency keys); materials actuals never posted; `delay_analysis` passes the live schedule as its own baseline so two of five methods always return 0; CRM won → project hook reads the wrong payload key; CDE "content hash" is a hash of the file name and size, not the bytes.

### 3.7 Data

No work-item data ships in the repo. The "120,000+ cost items" = a Russian GESN/FER/TER norm catalogue (55,719 items) machine-translated and repriced into 30 markets, including a `USA_USD` variant pinned to New York, plus eight non-US national bases — all downloaded at runtime from the author's GitHub or a Hugging Face snapshot. The shipped `DDC_CWICR_USA_USD_Catalog.csv` has 68 labour rows of the form "Worker Category 1 … $17.72–25.04/hr" with no trade and roofing expressed as Soviet roofing felt. `packs/us-costdata/README.md`: "No commercial cost database is bundled, and none can be… this pack is the structure, not the data." There is no Florida pack. The two US docs are a methodology how-to and a tutorial over six recipes.

### 3.8 Provenance

397 releases and ~2M lines of application code in six months, one committer, external PRs "rewritten from scratch", 17 core files carrying invisible zero-width fingerprints in their docstrings, and the same essayistic comment style throughout. Read it as a large LLM-assisted codebase with one human integrator. The code is competent and defensive; breadth outruns integration.

---

## 4. Feature Comparison

Legend for Recommendation: **A** keep CareyOS · **B** improve CareyOS module borrowing the concept · **C** build native, concept-inspired · **D** external service · **E** direct reuse · **F** do not use. Licence risk is for the *recommended* action, not for copying code (always RED).

| Feature | CareyOS state | OCE state | Overlap | OCE advantage | CareyOS advantage | Value | Difficulty | Licence | Rec. |
|---|---|---|---|---|---|---|---|---|---|
| Estimating (line items) | Two families; template lines qty × price; roofing lump materials | BOQ hierarchy, per-unit resource split, snapshots, revision chain | Medium | Resource split invariant, provenance, snapshots | Contract integration, signing, simpler UX | High | Med | Green (clean room) | B |
| Cost databases | `RoofMaterialItem/Price` only; estimator catalogue pending import | Engine real; data Russian-derived, NC upstream, no US book | Low | `price_as_of`, usage ledger, region tag | Append-only by-day prices, vendor link | Med | Low | **Red for data** | C (own book) |
| Assemblies | None (takeoff rules are the roofing analogue) | Real: components, factors, waste/burden uplift, parametric, regional × bid × FX | Low | Expansion math, parameter graph | Rules already calibrated per roof type | High | Med | Green | C |
| Quantity takeoff | Roofing from Roofr PDF; preview only | Manual click-to-draw on PDF/DXF, server recompute, review status | Low | Measurement model, scale rules | Roofr parse at 0.84+ confidence on 23 real PDFs | High | High | Green (concepts); **Red** PyMuPDF | C |
| PDF takeoff | None beyond Roofr reports | pdfjs viewer, vector heuristics, Otsu/Hough on scans, VLM proposals | None | Scale detection regex, plausibility belt | — | Med | High | Green concepts | C (Phase 3) |
| CAD takeoff | None | ezdxf native DXF; DWG via proprietary converter | None | — | — | Low | High | **Red** (converter EULA) | F |
| BIM takeoff | None | Large, converter-dependent | None | — | — | Low for residential | Very high | Red | F |
| Roofing estimating | Pure engine, rules, price book, waste from Roofr | Nothing roofing-specific (waste = one scalar) | None | — | Far ahead | — | — | — | A |
| Plumbing estimating | None | Nothing trade-specific; parametric "electrical points = area × 0.6" style proxies | None | Parametric project-type idea | — | Med | Med | Green | C |
| Interior renovation estimating | Template estimates (Drywall, Interior, W&D) | Kitchen/bathroom parametric project types | Low | Parameter sheet → quantities | Seeded templates in use | Med | Med | Green | B |
| Labour estimating | `laborRatePerSquare`; template lines | Norm hours/unit + all-in rate template + crew composite | Low | Norm library separate from money | Real crew rates from payroll | High | Med | Green | C |
| Material estimating | Roofing rules | Norm materials, waste factor, exact-before-fuzzy match | Medium | Match provenance, `needs_review` | Calibration notes per rule | Med | Low | Green | B |
| Subcontractor estimating | Labour contracts after the fact | Sub as a resource type; RFQ comparison | Low | RFQ model | Labour contract documents | Med | Med | Green | C |
| Supplier pricing | `RoofMaterialPrice.source = vendor/invoice` reserved | Vendor price lists with validity; "best" = sort by price then lead time, no FX/validity filter | Low | Price list with window | Append-only by day | Med | Low | Green | B |
| BOQ | n/a (US residential uses estimates + SOV) | Core of the product | Low | — | SOV already feeds G702 | Low | — | — | F (keep SOV) |
| Project budgeting | Flat `BudgetLine`, destructive import, manual allocations | Two budget tables; buckets; placement cascade; sync markers | Medium | Buckets + derived commitment | One cost formula | **Very high** | Med | Green | B |
| Committed costs | `Commitment` typed amount; labour contracts | Derived from PO/subcontract vs invoices/receipts | Medium | Derivation | Simpler | High | Med | Green | B |
| Actual costs | Approved expenses, labour paid, field labour | Event-fed; labour double-posted; materials not posted | High | — | Cleaner and correct | — | — | — | A |
| Cost-to-complete | None (`max(estimate, committed)`) | Typed `forecast_final`; four EVM EACs | None | Formula vocabulary only | — | **Very high** | Med | Green | C |
| Change orders | Customer COs with token approval, SOV lines, labour COs | Two engines; items with cost_delta; pending vs agreed buckets; CO never touches subcontract | High | Item model, pending bucket | Approval UX, SOV link, deletion unwinds | Med | Low | Green | B |
| Purchase orders | None | PO → GR → invoice, OTIF, 3-way match (two stacks) | None | Chain model | — | High | Med | Green | C |
| Procurement | None | Three bid engines, RFQ with adjustments and coverage | None | RFQ comparison record | — | Med | Med | Green | C (Phase 4) |
| Vendor management | Vendor, aliases, matching, compliance on read, expiry tasks | Vendor master, rating, scorecard, three expiry trackers | High | Scorecard formula | Matching on every write; compliance never stored | — | — | — | A |
| Subcontractor management | Labour contracts, schedule lines, payment requests | Prequal, certificates, agreements, pay apps, retention ledger, rating | Medium | Pay-app + retention + waiver gates | Payment-request task flow | High | Med | Green | B |
| Subcontractor billing | `LaborPaymentRequest` → `LaborPayment` | Per-period gross/retention/net with finance approval | Medium | Retention ledger | Task-driven | High | Med | Green | B |
| Retainage | On customer side (G702); `LaborContract.retainagePercent` stored | Both sides; tiered release; US caps declared but unenforced | High | Release formula | Working G702 | Low | Low | Green | B (payable side) |
| Draws | Progress applications on PROGRESS jobs | Progress claims (prime side) | High | Stored materials column | Shipped and backfilled | — | — | — | A |
| Project scheduling | Calendar on tasks; workflow durations unused | CPM/Gantt (three copies), baselines, XER/MSP, LPS, takt, delay analysis | Low | CPM maths | Dispatch + field day | Low–Med | High | Green | F now; C later (phase Gantt from workflow edges) |
| Field operations | Deep (see §12) | Three daily-report modules, timesheets, equipment | High | Equipment model, entry-row diary | Payroll-grade labour, GPS, offline | — | — | — | A |
| Daily logs | Unique per job+date, weather, 13 sections, approval, PDF | Three implementations | High | Typed entry rows with source refs | Approval + payroll link | — | Low | — | A (+ B for typed entries) |
| Punch lists | Stage name only | Punch item with sheet pin, four-eyes, reopen history, rework cost | None | Item model | — | Med | Low | Green | C |
| Inspections | Permit inspections as one record with workflow effects | Generic + forms with frozen template snapshot | Medium | Form snapshot | Workflow effects | Low | Low | Green | A (+ form idea later) |
| Photos | FieldPhoto + File merged on read, GPS, replace | Project photos, diary media, drone | High | — | Missing-state handling | — | — | — | A |
| Document management | Files by job, preview, generated docs protected | Five subsystems, ISO 19650 CDE, fake content hash | Medium | Revision chain idea | Simpler, protected generated docs | Low | — | — | A |
| Permit management | Permits + inspections + alert tasks + fees from costs | `authority_submission` thin CRUD | Low | — | Far ahead | — | — | — | A |
| Equipment | Expense type + free text | Assets, telemetry, maintenance, rental billing, health score | None | Asset + usage model | — | Low–Med | Med | Green | C (Phase 4, light) |
| Fleet | None | Telemetry/odometer | None | — | — | Low | — | — | F |
| Labour/time tracking | Clock times, GPS, OT engine, payroll | Timesheets, OT at straight time, no multiplier | High | XOR worker/equipment line, reversal rows | Correct OT, payroll | — | — | — | A |
| Reporting | Funnel, workflow, financials, field labour, attention rows | Four dashboard stacks, 35 KPIs, scheduled reports (never scheduled) | Medium | KPI registry with drill path | Count = list invariant | Med | Low | Green | B |
| Project profitability | Cost summary card, Collections table | EVM/CVR | Medium | Snapshot history | One formula | High | Low | Green | B |
| Development feasibility | None in CRM (landdev-analyzer and fl-buyback economics elsewhere) | Unwired RICS residual helpers; sales CRM only; no IRR/draws | None | Residual formula (public method) | Fleet has parcel analysis | Med | Med | Green | C (native, not from OCE) |
| AI functionality | None | httpx client, grounded estimator, legacy price-inventing path, proposal queues | None | "LLM extracts, code computes" pattern | — | Med | Med | Green (own prompts) | C (Phase 5) |

---

## 5. Licensing Analysis

_This is a technical risk analysis, not legal advice. Items marked **[COUNSEL]** need a lawyer's ruling._

### 5.1 Facts

- **Licence**: `AGPL-3.0-or-later` (`LICENSE`, `COPYRIGHT`, `backend/pyproject.toml`, all 48 packs). Copyright "Artem Boiko / DataDrivenConstruction.io and OpenConstructionERP Contributors"; `AUTHORS.md`: "There is a single author." A CLA document exists but `CONTRIBUTING.md` says no external PRs are accepted and `signatures/cla.json` is empty.
- **Commercial licence**: `docs/legal/COMMERCIAL-LICENSE.md` is "a template… not itself a binding licence." It lifts AGPL §13 on DDC's own code only: "It is not, and cannot be, a grant of rights in code Licensor does not own." German law, Berlin forum, sole-trader licensor.
- **AGPL cascade**: `NOTICE` states PyMuPDF (Artifex, AGPL or commercial) "is present in every artefact Licensor publishes… no configuration switch that removes it." Confirmed imported in nine files including `core/pdf_branding.py`, which rasterises logos on every branded PDF export.
- **Proprietary converters**: all DWG/RVT/IFC/DGN import goes through DDC cad2data, closed-source binaries on the Open Design Alliance SDK, fetched at runtime from the author's GitHub at a pinned SHA. Upstream `LICENSE-PROPRIETARY`: "Commercial use in a revenue-generating capacity, use in a software-as-a-service offering, or redistribution to third parties requires a separate commercial license." Not covered by the OCE commercial licence.
- **Data**: in-repo `data/catalog/README.md` claims the compilation is AGPL but says the global CWICR base's basis "is PENDING and is deliberately left open." Upstream `OpenConstructionEstimate-DDC-CWICR/LICENSE`: all data CC BY-NC 4.0 plus EU database right for non-commercial use only; "Any use in or for a commercial product, service, or paid engagement requires a separate commercial license." The Italian Toscana base is CC BY 4.0 with a required attribution block.
- **Other non-permissive items**: psycopg2 LGPL (unmodified), MUSE dictionaries CC BY-NC (optional translation tier), OpenCV wheels carrying FFmpeg LGPL and Intel IPP, Cesium ion terms if a key is supplied, OSM tiles under ODbL. Frontend otherwise permissive (dompurify and jszip dual-licensed, permissive branch).
- **Trademarks**: OpenConstructionERP, OCERP, OpenEstimate, DDC, CWICR claimed; forks must change the product name; API responses carry `X-DDC-Engine` headers.

### 5.2 AGPL §13 and SaaS

Trigger = **modify + network interaction**. Running an unmodified copy over a network imposes no §13 duty; configuration, env vars and data loaded through the API are not modifications; patching any file, locale or template is. A proprietary client calling an unmodified AGPL server over REST is generally treated as a separate program (FSF arm's-length view), but the boundary is contested when the proprietary product's core function exists only through the AGPL service **[COUNSEL]**. Corresponding Source for a modified OCE is the whole modified tree, not the diff.

### 5.3 Derivative-work implications

Reading for ideas: not restricted. Line-by-line porting Python → TypeScript: a translation is a derivative work; language change is no defence. Schema: names and ordinary relational structure are thin; wholesale copying of a 152-model schema risks compilation copyright **[COUNSEL]** if more than vocabulary is borrowed. Prompts (43 files with DDC headers), locale strings and docs are AGPL literary works if copied verbatim; the techniques are free.

### 5.4 Classification

| # | Candidate use | Rating | Reason | Counsel? |
|---|---|---|---|---|
| i | Reading code for architectural ideas | **GREEN** | Ideas and methods are not protected; keep a reading log | No |
| ii | Clean-room re-implementation of an algorithm (postcalc, waste, bid levelling, EVM, cascade) | **GREEN** | Public methods; protected expression is DDC's code; follow §5.5 | Only if numeric tables are copied |
| iii | Re-using names/structure of a DB schema | **YELLOW** | Vocabulary fine; wholesale table copying risks compilation copyright | If more than a handful |
| iv | Copying a CWICR cost CSV into CareyOS | **RED** | CC BY-NC + database right upstream; AGPL claim in-repo conflicts; basis "PENDING"; USA file is Russian norms repriced | Mandatory |
| v | Copying JSON templates / dashboards / bim_rules | **YELLOW** | AGPL authored content; write your own | If verbatim |
| vi | Running an **unmodified** OCE as a separate service over HTTP | **YELLOW** | Generally outside §13 but contested; PyMuPDF and converter EULA still apply (converter forbids SaaS) | Yes |
| vii | Running a **modified** OCE that way | **RED** (YELLOW with a commercial licence) | §13 source offer for the whole tree plus Artifex independently | Yes |
| viii | Vendoring one Python module into CareyOS | **RED** | Combined work under AGPL §5/§13 | Yes |
| ix | Porting a Python module to TypeScript line by line | **RED** | Translation is a derivative work | Yes |
| x | Using PyMuPDF anywhere in CareyOS | **RED** under AGPL / GREEN with Artifex licence | CareyOS already uses pdfjs-dist (Apache-2.0); pypdfium2 is a permissive alternative | If adopted |
| xi | Using the DDC cad2data converter | **RED** | SaaS and revenue use need a separate licence; ODA pass-through | Yes |
| xii | Buying the OCE commercial licence | **YELLOW** | Template only; excludes marks, PyMuPDF, converters, data; German law; sole trader | Yes |
| xiii | Copying UI copy / translations | **RED** verbatim / GREEN rewritten | Locale files are literary works | No if rewritten |
| xiv | Copying AI prompts | **RED** verbatim / GREEN own prompts | Prompt files carry DDC copyright | No if rewritten |
| xv | Using the public demo / hosted API | **YELLOW** | Hosted terms, "AS IS", no SLA, data carries CWICR terms | For production only |

### 5.5 Clean-room protocol for CareyOS

1. **Two roles.** A specifier may read OCE and writes functional specs in their own words (inputs, outputs, formulas citing public sources such as the PMI EVM standard or CareyOS's own cost history). An implementer writes CareyOS code and never opens the OCE clone or its upstream repos. Record the roles in a dated memo. This document is the specifier's output.
2. **Spec rules.** No code, no pseudocode mirroring OCE control flow, no identifiers, table or column names, locale strings, prompt text or numeric tables transcribed from OCE. Every constant cites a non-OCE source.
3. **Provenance log.** The clone stays in the session scratch directory outside every CareyOS repo; log the commit read (`3c00e672…`, 2026-10-07); delete the clone when the review ends; never add OCE as a submodule or dependency.
4. **Tooling.** Add a CI grep for `pymupdf`, `fitz`, `openconstructionerp`, `cwicr`, `DDC_CONVERTER` and a licence scanner with AGPL/GPL/LGPL/SSPL/CC-BY-NC in the deny list; snippet-compare finished implementations against the OCE tree and file the clean result with the memo.
5. **Data.** Import no `DDC_CWICR_*` or `cwicr_*` file. Build the price book from CareyOS's own job history, the roofing estimator import, supplier invoices and public US series, recording `source` per row — which is exactly what OCE's own US methodology doc tells its readers to do.

### 5.6 Items for legal review

(1) §13 boundary for a proprietary client of an unmodified AGPL service; (2) any use of CWICR data; (3) the converter EULA; (4) PyMuPDF under AGPL vs an Artifex licence if a vector-PDF feature is ever wanted; (5) scope and enforceability of the commercial licence template; (6) schema copyrightability if more than vocabulary is borrowed; (7) trademark wording for any factual reference; (8) MUSE/Cesium/OSM terms if geo or translation features were ever enabled; (9) the CLA contradiction, only if CareyOS ever sends specs upstream (they would ship under both licences).

---

## 6. Gap Analysis

Ranked by the distance between what the business needs and what the CRM does today, with OCE's relevance noted.

| # | Gap in CareyOS | Evidence | OCE relevance |
|---|---|---|---|
| 1 | **No cost-code spine.** `CostCode` has 8 fields and one relation (`DailyLaborEntry`); expenses, budget lines, commitments, estimate lines, change orders and invoices carry none | `prisma/schema.prisma:3086`; grep `costCode` hits only labour files | OCE's own codes are unenforced strings with no MasterFormat table — the lesson is what not to do |
| 2 | **No cost-to-complete / forecast.** `projectedCost = max(estimatedCost, committed)`; no remaining-work input, no history table | `src/lib/jobs/cost-summary.ts` | Vocabulary (ETC, EAC, VAC) and the budget-bucket shape; the EVM engines themselves are not needed |
| 3 | **Estimate and actual never meet at line level.** `EstimateLineItem` ↔ `BudgetLine` have no relation; nothing seeds a budget; roofing takeoff writes nothing | `lib/estimates/*`, `lib/budget/*` | Resource split, snapshot baseline, estimate → budget by code |
| 4 | **No learning loop.** The estimator's `JobComparison` / `RuleChangeRecommendation` were not absorbed; the CRM has no variance classification | roofestimator `lib/calibration/*`; CRM `features/roofing.md` "P2" | postcalc design (high) |
| 5 | **Commitments are typed, not derived.** No PO, no goods receipt, no sub pay application, no retention ledger on the payable side, no lien waivers | `model Commitment`, `LaborContract` | finance `cost_position` derivation, subcontract pay-app + waiver model |
| 6 | **Two estimate calculators, one typed material number.** Roofing materials and labour are not line items | `lib/estimates/calc.ts`, `generic-calc.ts` | One line model with resource rows |
| 7 | **Margin/overhead/contingency are flat percentages** inside each calculator; no allowances, no contingency drawdown | `calculateEstimate` | Cascade with explicit bases; allowances with drawdowns |
| 8 | **No plan takeoff** beyond Roofr reports | `lib/roofing/parsing` | Measurement model, scale rules (concepts only; PyMuPDF RED) |
| 9 | **No punch list, RFI, equipment, supplier quotes** | 0 hits | Punch item, RFI ball-in-court, equipment asset + usage, price list with validity |
| 10 | **Reporting has no cost history** | `DashboardMetricSnapshot` unused | Daily/monthly KPI snapshot per project |
| 11 | **No AI anywhere** | grep | "LLM extracts, code computes" pattern; proposal queues a person confirms |
| 12 | **Property identity is an address string** across six apps | fleet survey | Not an OCE lesson; a fleet decision |

---

## 7. Estimating Opportunities

### 7.1 Where the CRM estimator stands against the target pipeline

| Stage | CRM today | Blocker |
|---|---|---|
| Plans / property info | Lead address, Roofr report, Zylow enrichment | No plan sheets |
| Measurements | `RoofMeasurement` (ROOFR/MANUAL/FIELD) | Roofing only |
| Quantity takeoff | `generateEstimate` → materials list, preview only | No consumer, no labour |
| Assemblies | Takeoff rules per category (per_square, per_lf, per_count…) | Roofing only; no notion of a reusable assembly for interior/W&D |
| Materials / labour / equipment / subs | `RoofEstimate.materialCost` lump + `laborRatePerSquare`; template lines qty × price with no kind | No resource kind on a line |
| Overhead / contingency / margin | Nine fee columns + margin % + discount + tax | Flat; not auditable per base |
| Estimate → proposal → contract | Template estimate status, contract snapshot, signing | Works |
| Project budget | Flat lines, destructive import | Not seeded from the estimate |
| Actual cost | Expenses, labour, field labour | No code to join on |
| Variance / learning | None | — |

### 7.2 What OCE teaches (concepts, not code)

1. **Per-unit resource split on every priced line.** A line's unit rate is the sum of its resource rows (kind, quantity per line unit, unit rate, provenance). Direct edits of the unit rate scale the rows; an untrusted build-up refuses to re-derive. This single structure powers the cost breakdown, the markup bases and the learning loop.
2. **Productivity norms separate from money.** A norm is hours per unit (labour, machine) and net material quantities per unit; price is a view over norm × rates × prices. One norm serves every price book, region and year. The roofing engine already has the quantity half (rules); it lacks the labour-hours half and the money view.
3. **Provenance copied onto the line at pricing time** (rule/norm key, assembly id, bid factor, region, parameter values, `price_as_of`, match confidence, `needs_review`). A mutable upstream row is not provenance.
4. **Markup cascade with explicit bases.** Each step names the leaf bases, composites or earlier steps it compounds on; `gross_up` handles taxes inside the price; round per step and feed forward. The US template OCE ships (GC 8%, overhead 7%, profit 5%, GL 1%, bond 1.5% cumulative, contingencies 5%/3%) is a demo, not data — but the shape is right for a residential contractor who today has nine fee columns.
5. **Allowances with drawdowns**: provisional sums and contingency as held amounts; only the remaining amount rolls into the estimate, so drawn money is assumed to have moved into measured work.
6. **Estimate basis document**: inclusions/exclusions/assumptions generated from what the estimate covers, with a suggested AACE-style class derived from how much value came from measured quantities, never written automatically.
7. **Exact-before-fuzzy matching** of a material or line description to a price item, with a decision ledger that keeps the suggested item's snapshot and separates "suggested" from "confirmed" even above the auto threshold.
8. **Waste**: OCE's is one scalar per category; the CRM's per-rule waste on WASTEABLE categories with Roofr's recommendation held as a suggestion is already better. Keep it, and add lap/coverage and pack rounding where the rules already do `ceil`.
9. **Regional pricing**: for a single-county contractor a `region` tag and `price_as_of` on price rows suffices; indices and FX are not needed.
10. **Supplier quotes**: a quote is a price list with a validity window per vendor; a comparison record carries freight/tax/discount adjustments and a coverage ratio.

### 7.3 How this integrates with the current estimator instead of creating a second one

- Keep `Estimate` / `EstimateSection` / `EstimateLineItem` as the one line model. Add `kind` (labor | material | equipment | subcontract | fee | allowance) and `costCodeId` to the line, and a child `EstimateLineResource` for lines that are priced from a build-up. A line with no resources is priced as today (qty × unitPrice).
- Retire `RoofEstimate` by generation, the way workflow templates moved: a roofing estimate becomes an `Estimate` whose lines are written by the takeoff engine (materials from `generateEstimate` with `ruleKey` provenance, labour from a roofing norm set, fees as fee lines). `signedEstimateCost`, the contract snapshot and the two PDF renderers then collapse to one path. The nine fee columns become fee lines; margin/discount/tax become cascade steps.
- Replace `marginPercent` + fee columns with `EstimateMarkupStep` rows seeded from a company default (overhead, contingency, insurance, bond, profit, tax). Keep the true-margin formula as the `profit` step's `gross_up` kind so numbers do not move for existing estimates.
- The import script's materials and prices land in `RoofMaterialItem`/`RoofMaterialPrice`, which become the roofing section of a general `PriceItem` table (or stay as-is with a view); do not create a parallel catalogue.
- `EstimateSnapshot` is taken on SENT and on contract generation; the contract's existing JSON snapshot is already that for the customer-facing side.

---

## 8. Takeoff Opportunities

### 8.1 Target pipeline vs what exists

| Step | Exists in CareyOS | Exists in OCE | Reusable concept | Needs independent build | Needs AI/CV | Human-verified |
|---|---|---|---|---|---|---|
| Upload plans | Files on job/lead; preview | `TakeoffDocument` with page text/tables, scale per page | Document + page model | Yes | No | — |
| Identify sheets | No | Regex title-block parsing (number, title, scale, revision; discipline from prefix) | Yes | Yes (pdfjs text layer) | Optional VLM | Yes |
| Detect scale | No | Regex on text layer (`1:N`, `1/4" = 1'-0"`, confidence by keyword window), two-click calibration, VLM proposal with a plausibility belt; user calibration always wins | Yes | Yes | Optional | **Always** |
| Rooms / walls | No | Vector: closed loops and long segments as proposals; scans: Otsu + components, Canny + Hough (max 8 walls) | Proposal-queue shape | Yes | Real room segmentation needs a trained model OCE does not ship | Yes |
| Doors / windows / fixtures | No | "Count by example" from a clicked shape signature on vector PDFs; nothing on scans; YOLO is a stub | Count-by-example | Yes | **Yes** for scans — genuine CV gap | Yes |
| Roofing geometry | Roofr parse (23 real PDFs ≥ 0.84), pitch bands, waste | Nothing roofing-specific | — | Keep | No | Review state exists |
| Areas / LF / counts | Roofing only | Shoelace and polyline in page units; server recomputes from points × scale; deductions; wall height × length − openings; slope; wastage; multiplier | **Yes** | Yes | No | — |
| Create takeoff → assemblies | Preview only | Push quantity to a BOQ position with dimension check and unit conversion; opt-in; revision cost = Δqty × rate | Yes | Yes | No | Yes |

### 8.2 Recommendation

Build a `PlanTakeoff` subsystem natively in Phase 3: `PlanDocument` (file, pages, per-page scale with source and confidence), `PlanMeasurement` (page, type, raw points in page units, `scalePixelsPerUnit`, `scaleSource`, `isDeduction`, modifiers, `reviewStatus`, `source`, `confidence`, link to an estimate line), server-side recompute before any quantity reaches a line. Rendering with pdfjs-dist (already in the CRM, Apache-2.0); vector geometry from pdfjs's operator list rather than PyMuPDF (RED). Start with manual click-to-draw plus text-layer scale detection; add proposal queues (rooms, counts) later and only ever as `proposed` rows a person confirms. Trained symbol detection on scans is the one place a model would earn its place and should wait until there is a labelled set from the company's own plans. CAD/BIM: not for this business.

---

## 9. Construction Financial Controls

### 9.1 Design for CareyOS

The CRM's one-formula principle stays. `computeCostSummary` gains buckets and a forecast, and gets its inputs from a cost-code spine instead of job-wide sums.

**Cost code.** Extend the existing `CostCode` (code, name, phase, division/parent for a two-level tree, `kind` labor | material | equipment | subcontract | other, `isActive`). Seed a company list from `JobExpenseType`, `Estimate` template sections, `WorkflowPhase` keys and the roofing rule categories — a residential list of 40–80 codes, not MasterFormat (OCE ships no MasterFormat table either; the methodology is "your own codes keyed to your own history").

**Budget line = cost code × job**, with buckets:

| Bucket | Derived from |
|---|---|
| Original budget | Estimate snapshot at contract signing, by code |
| Approved changes | Σ approved `ChangeOrder` cost side (new `crewCost`/`costDelta` by code) + labour change orders |
| Pending changes | Σ SENT change orders' cost side (shown, never added to revised) |
| Revised budget | original + approved changes |
| Committed (open) | Σ open commitment amounts − Σ approved expenses linked, per commitment (existing `openAmount`), plus labour contract − labour paid |
| Actual | Σ approved expenses + labour paid + unposted field labour, by code |
| Estimate to complete | `max(revised − actual, committed_open)` by default; overridable per line by a person with a reason; or `remainingQty × unitRate` where the line has a quantity and progress |
| Estimate at completion | actual + ETC |
| Variance | revised − EAC (negative = over) |

**Commitment derived from documents.** `Commitment` gains `kind` (PURCHASE_ORDER | SUBCONTRACT | OTHER) and `CommitmentLine` (cost code, description, qty, unit, unitRate, amount). A labour contract is a subcontract commitment of its own kind (already the rule) and keeps its tables. Committed open per document = max(document amount, invoiced) − actual, with over-commitment shown separately. Every posting writes a sync marker keyed by source document so replays never double-post — the one OCE idea that would have prevented OCE's own labour double-posting.

**Monthly snapshot.** `JobCostSnapshot` (job, asOf, the full summary JSON, per-code rows) written by a cron on month end and on contract signing; this gives the margin-erosion trend the dashboard needs and the history the learning loop reads.

**Margin erosion surfaced early.** An attention row "Margin erosion" (projected margin below the signed margin by more than a threshold, or EAC above revised budget on any code) using the existing `lib/attention` builder; a job health reason; a digest line. All deterministic.

### 9.2 Worked example (the brief's numbers)

Contract $250,000; original estimated cost $175,000 → expected GP $75,000. Commitments and actuals: actual to date $126,000; open commitments $55,000 → committed-to-date $181,000; ETC = max(revised $175,000 − $126,000, $55,000) = $55,000 by the default rule, or $61,000 when the superintendent sets remaining quantities on two lines. EAC = $126,000 + $61,000 = $187,000; projected GP $63,000; variance −$12,000 on two codes, visible the day the second PO is entered, not at closeout.

### 9.3 What OCE contributes and what not to take

Take: the bucket vocabulary; derived commitment; sync markers; the placement cascade idea (line by code, else the job-level "unallocated" row — the CRM should keep an explicit "Unallocated" line per job so nothing hides); contingency as a budget line with drawdowns tied to a reason. Leave: four EVM engines, TCPI, S-curves from typed plan points, strings for money, cost codes as unenforced strings, "AC = Σ payments + Σ POs."

---

## 10. Procurement

**Today**: none. Expenses arrive after money moves (cc-allocator) or are typed; `Commitment` is a promise with an amount; roofing prices are append-only by day with a `source` reserved for `vendor` and `invoice`; the estimator had `SupplierProfile`, ABC/SRS SKU prices (seed placeholders) and supplier-ready list exports; `homedepotscraper` is an empty directory; cc-allocator matches Home Depot receipt CSVs to card rows but holds no SKU prices.

**OCE's relevant architecture**: vendor price lists with validity windows and lead times; a quote as a price list; an RFQ comparison record with signed adjustments (freight, tax, discount, provisional sums), `included_in_bid`, excluded lines, coverage ratio, best-value scoring, recommended bid plus override with reason and an immutable basis snapshot; PO → goods receipt → invoice with OTIF per vendor and 3-way match tolerance (percentage plus an absolute floor). It has **no price history and no price-change detection**; its "best price" sort ignores currency and validity. Those two gaps are precisely what the brief asks for, so the CRM's design here is its own.

**Design for CareyOS (Phase 4)**:
- `PriceItem` (generalising `RoofMaterialItem`): category, unit, SKU map per vendor (`VendorSku`: vendor, sku, packSize), active flag.
- `PriceQuote` rows (append-only, like `RoofMaterialPrice`): item, vendor, unit price, `effectiveDate`, `validTo`, `source` (manual | invoice | quote | import | scrape), `jobId` when job-specific, lead time, delivery cost basis. The existing by-day "later entry wins" rule stays.
- Derived views: current price per vendor, 90-day average, change since last quote, "stale" over 90 days (the roofing library already has `STALE_PRICE_DAYS`).
- `MaterialPackage` for a takeoff: lines by item and quantity; per-vendor pricing = Σ qty × current price + delivery − discount, coverage % of lines the vendor can price, best package by total with coverage ≥ threshold, shown as a recommendation with the per-line comparison. Deterministic.
- Price capture: supplier invoices parsed into quotes (the estimator's `parsing/invoice.ts` and `JobComparison` were built for this; re-specify, do not port from the estimator without review either — that code is Richard's, so it is fine to reuse, but it is unversioned seed-era code); receipts attached to expenses (already stored) become the OCR source later.
- Alerts: price change over X % on a preferred item → attention row.

---

## 11. Subcontractors

**Today**: `LaborContract` (crew or typed label, vendor link, amount, retainage % stored, delay damages), `LaborContractTask` schedule lines with payment amount/percent and inspection status, `LaborChangeOrder`, `LaborPaymentRequest` → task for the accountant → `LaborPayment`. Vendor compliance (GL, WC, W-9, licence) derived on read, warned wherever the vendor is used, never blocking. No pay application, no retention ledger on the payable side, no lien waivers, no "remaining commitment" column (it is computed in `computeCostSummary` as labour contract − paid).

**OCE's model** (subcontractors + contracts): agreement with total value, retention %, `requires_lien_waiver`; SOV work packages; per-period pay applications (gross, retention, net; foreman then finance approval; paid stamp); retention ledger (accrued/released with reason); `LienWaiver` (conditional/unconditional × partial/final, through date, amount, pay-app link); gates: active agreement, certificates not lapsed, waiver amount ≥ net before finance approval and payment, prior periods need unconditional waivers. Gaps OCE itself has: no approved-variations or revised-value column on the agreement, COs never touch the subcontract, released retention raises no payable, US retention caps declared but unenforced, no statutory waiver forms.

**Design for CareyOS (Phase 2)** — extend, do not replace:

| Concept | CareyOS object |
|---|---|
| Subcontract | `LaborContract` (+ `originalAmount`, `requiresLienWaiver`) — already a commitment of its own kind |
| Original value / approved changes | `contractAmount` + Σ `LaborChangeOrder` (exists); add pending (`DRAFT`/`SENT`) labour COs as a shown bucket |
| Work completed | `LaborContractTask` lines → `SubcontractPayApplication` (number, period, Σ line claimed, retention held at the contract rate, net, status REQUESTED → APPROVED → PAID) replacing the single-line `LaborPaymentRequest` for contracts that bill by period; the task-for-the-accountant flow stays as the approval UX |
| Previous payments / current draw | Σ `LaborPayment` by application |
| Retainage | `RetentionLedger` rows (accrue on each application, release on a final application; `retainageReleased` on the contract becomes derived) |
| Remaining commitment | derived: revised − Σ approved applications |
| Insurance / licences / W-9 | `VendorDocument` (exists) |
| Lien releases | `LienWaiver` (contract, application, type conditional_partial / conditional_final / unconditional_partial / unconditional_final, through date, amount, signed date, file). Gate: when the contract requires it, recording a payment needs a waiver with amount ≥ net for the period; prior paid periods need an unconditional one. Warn-not-block by default, block when the admin turns it on — consistent with how compliance already behaves |
| Tie to project cost | the same `LaborContract` rows already feed `computeCostSummary`; applications refine "spent" (certified) vs "paid" |

Florida specifics (Chapter 713 notice to owner, waiver forms, prompt payment on private work left to contract) are reference data the operator supplies; the CRM should hold the forms as contract templates, not compute lien deadlines until Richard rules on it.

---

## 12. Field Operations

**CareyOS is ahead.** `DailyLog` unique per job and date with weather, 13 narrative sections, safety checklist, signature and approval; `DailyLaborEntry` with clock times, GPS check-in/out, OT allocation across all jobs in a week, rate snapshots, cost code, phase and budget line; payroll runs posting one LABOR expense per job; `FieldPhoto` with GPS and category; `FieldIssue` → task; offline drafts; PDF packages; `/field/day` with gloves-friendly actions. OCE has three daily-report modules, timesheets that never price OT and probably double-post labour, mocked SMS, unsalted PINs, and no customer sign-off.

**What would materially improve CareyOS** (borrowed shapes, built natively):
1. **Typed daily-log entries** beside the narrative: `DailyLogEntry` (type delivery | visitor | delay | incident | inspection | completion | note, free text, optional `sourceModule/sourceRef`, photo ids, hours for delays). Delay entries with a cause enum are the raw material for schedule-risk and claims later; today delays are one text field.
2. **Materials delivered** as entry rows that can reference a commitment line (closing the PO → received loop without a warehouse module).
3. **Equipment usage**: `EquipmentAsset` (owned/rented, rate per day/hour) and `EquipmentUsage` (job, log date, hours, operator) posting to the job's EQUIPMENT cost by code. Light; no telemetry.
4. **Punch list**: `PunchItem` (job, area, description, trade/vendor, photo, status OPEN → DONE → VERIFIED with `resolvedBy ≠ verifiedBy`, reopen count, optional rework cost and back-charge to a vendor). The "Punch List" stage and workflow milestone already exist; items make the phase measurable.
5. **RFI** (small): question, ball-in-court (owner / architect / inspector / vendor), response due, cost and schedule impact flags, link to a change order. Residential needs are modest; make it a task kind with a few fields rather than a module.
6. **Customer approvals** on site: the change-order token page exists; add a "customer acknowledgement" photo/signature line on the daily log for owner-present decisions.
7. **Form templates with a frozen snapshot per submission** (safety checklists, inspection forms) — later; the current checklist booleans suffice until an incident form is asked for.

Not worth taking: Last Planner, takt, drone/360/point-cloud media, three weather providers, OCE's safety module (CRM's checklist plus a future incident form covers it), certified payroll (Davis-Bacon is not this business).

---

## 13. Development Functionality

**OCE's `property_dev` is real (35.6K LOC, 34 tables, ~275 tests) but it is a developer's *sales* system**: plots, house types, buyer options, reservations with cooling-off, sales contracts with revisions and multi-party ownership, payment schedules with milestone-triggered instalments and late fees, brokers and ladder commissions, escrow with reconciliation, versioned price matrices, handover and snagging, RERA/214-FZ regulatory reports. **Absent entirely**: land acquisition, development budget or proforma, construction loan, draw schedule or draw requests, lender, interest reserve, stabilised value, cap rate, IRR/NPV, equity waterfall, cost per unit or per SF. Two residual-land-value helpers (RICS method: RLV = GDV − (construction + fees + contingency + finance + sales + profit)) exist with unit tests and **no route**.

**Verdict: F — do not force it.** Nothing in OCE accelerates a feasibility, draw or IRR module. The residual method is a public textbook formula; the instalment-by-milestone shape is a reasonable pattern for a *draw schedule* (draws keyed to construction milestones the CRM's workflow already emits), but that is a design note, not a dependency.

**Where it should live in the fleet**: landdev-analyzer already holds parcels, scenarios, assemblages and comparables with PostGIS and a feasibility PDF; fl-buyback-docs holds closing waterfalls and exit scenarios; the CRM holds construction cost history. A native development module belongs beside landdev-analyzer and should read construction budgets and actuals from the CRM by API (cost per SF by code from `JobCostSnapshot`), not duplicate them. Build order when it is wanted: development budget by category → draw schedule tied to milestones → proforma with stabilised value and simple IRR/equity multiple → feed from CRM actuals. No OCE input needed.

---

## 14. AI Opportunities

The CRM has no AI; the fleet has a working Anthropic pattern in closing-brain (structured outputs, every sensitive action gated by a Human Approval Center, prompt/response captured per run). OCE's useful lesson is one sentence from its newer estimator: *rates come only from the database, never from the model*; its legacy path that lets the model invent unit prices and writes them to lines is the anti-pattern. Construction money stays deterministic; AI interprets.

| Opportunity | Value | Mode | Notes |
|---|---|---|---|
| Plan sheet identification and scale proposal | Medium | **Human review required** | Text-layer regex first; VLM only when the text layer is empty; plausibility belt; never auto-applied |
| Room / count proposals on plans | Medium later | Human review required | Proposal rows; a trained detector only after a labelled set exists |
| Estimate scope generation from a lead description | Medium | Human review required | LLM extracts parameters and asks clarifying questions; code computes quantities from the parameter sheet; every proxy flagged `estimated` |
| Cost-code matching of expenses and invoice lines | **High** | Human review (auto above a threshold, still shown as suggested) | Exact → fuzzy over the company's own codes and history; decision ledger learns prior picks; cc-allocator already does rules → history → fuzzy for accounts |
| Invoice / receipt line extraction into price quotes | High | Human review required | Receipts are already stored on expenses; extraction feeds `PriceQuote` rows with `source = invoice` |
| Supplier quote comparison | Medium | **Advisory** | Deterministic comparison; AI only to explain differences or flag missing lines |
| Change-order detection from daily-log text | Medium | Human review required | Keyword/regex first (OCE's delay-signal detector is keywords); LLM drafts a CO with `cost_impact` left blank for a person |
| Project risk / schedule risk | Medium | **Advisory** | Rules over data the CRM holds (open steps overdue by role, permit waiting days, delay entries, weather); AI writes the rationale, never the score |
| Margin erosion | High | **Deterministic**; AI advisory explanation | The cost spine computes it; a digest line explains which codes moved |
| Document classification on upload | Medium | Human review required (auto for high-confidence categories) | Category suggestions for `FileCategory`; generated documents excluded |
| Daily-log summarisation for the owner report | Medium | Human review required | Summarise typed entries + narrative; the PM edits before send |
| Permit document validation | Low | Advisory | Jurisdiction checklists first |
| Historical project comparison ("jobs like this one") | Medium | Advisory | Similarity over structured fields (service, squares, pitch, county, contract size) before any embedding |
| Estimate generation end to end | Low now | Human review required | Only after the resource-split model and own price book exist; the model proposes lines from candidates, never rates |
| Voicemail → lead | Done in the fleet | Automatic (summary only) | knu-phone-routing already summarises; lead creation into the CRM is the keyless endpoint waiting on `PHONE_ROUTING_API_KEY` |

Platform requirements before any of this: one `lib/ai` module in the CRM following closing-brain's pattern (structured outputs validated by zod, an `AiRun` table with prompt, response, model, tokens, cost, actor and the record it touched, a kill switch per feature), prompts written in-house, and a rule that AI writes only `proposed` rows or suggestions, never money.

---

## 15. Proposed CareyOS Architecture

Everything below is inside the existing CRM; no new service, no Python, no queue.

```
Lead ──► Estimate (one family) ──► CustomerContract (snapshot) ──► Job
            │  lines: kind, costCodeId, qty, unit, unitPrice
            │  EstimateLineResource (labor hrs/unit, material, equipment, sub)
            │  EstimateMarkupStep (overhead, contingency, insurance, bond, profit, tax)
            │  EstimateAllowance (+ drawdowns)
            │  EstimateSnapshot (immutable; the contract baseline)
            ▼
      Takeoff engines write lines:
        roofing (RoofMeasurement → rules → materials + labour norms)
        plan takeoff (PlanMeasurement → quantities → assemblies)   [Phase 3]
        templates (Drywall / Interior / W&D seeded assemblies)

Job ──► BudgetLine = CostCode × Job  (original · approved Δ · pending Δ · revised · committed · actual · ETC · EAC)
   ├── Commitment (kind PO | SUBCONTRACT | OTHER) + CommitmentLine (costCodeId)
   │     LaborContract (subcontract) → SubcontractPayApplication → RetentionLedger, LienWaiver
   ├── JobExpense (+ costCodeId, commitmentLineId)        ← cc-allocator, manual, payroll
   ├── DailyLaborEntry (costCodeId exists)                ← field
   ├── EquipmentUsage (costCodeId)                        [Phase 4]
   ├── ChangeOrder (+ items with cost side by code; pending vs approved)
   └── JobCostSnapshot (monthly + on signing)             → attention rows, digests, reports

Learning loop (read-only reports + recommendations):
   EstimateSnapshot lines × resources  vs  actuals by code (hours, cost, quantity installed)
   → ProductivityObservation (job, code, planned hrs/unit, earned hrs, actual hrs, factor, coverage, cause)
   → NormRecommendation (current, observed, suggested, confidence, status PROPOSED | ACCEPTED | REJECTED)
   → accepted values update RoofRule / LaborNorm / PriceItem with provenance; never automatic

Procurement intelligence [Phase 4]:
   PriceItem + VendorSku + PriceQuote (append-only, source, validTo) → current / 90-day avg / change
   MaterialPackage (from a takeoff) → per-vendor totals + coverage → recommendation
```

**Principles carried over from the CRM's rules**: one calculation for cost and profit (`computeCostSummary` extended, never a second formula); every money write through its existing service; explicit role lists; pure engines under `src/lib/*` with tests; records that complete gates by themselves (a received PO line ticks "materials ordered"); every automated recommendation is a row a person accepts.

---

## 16. Database Changes

All changes extend existing models; the only wholly new families are the plan takeoff, price quotes, pay applications and the learning tables. Nothing named `ERP*` or `Construction*`.

### 16.1 Extensions

| Model | Change |
|---|---|
| `CostCode` | `parentId`, `kind` (LABOR · MATERIAL · EQUIPMENT · SUBCONTRACT · OTHER), `division`, `isDefault`; relations to every row below |
| `BudgetLine` | `costCodeId` (unique per job), `originalAmount`, `approvedChanges`, `pendingChanges` (derived), `etcOverride` + `etcReason` + `etcSetBy`; `amount` becomes `revised` (migration keeps the value); an explicit "Unallocated" line per job |
| `JobExpense` | `costCodeId`, `commitmentLineId`, `syncKey` (source document marker) |
| `Commitment` | `kind`, `issuedAt`, `expectedDeliveryAt`, `terms`; new `CommitmentLine` (costCodeId, description, qty, unit, unitRate, amount, receivedQty) |
| `LaborContract` | `originalAmount`, `requiresLienWaiver`, `retentionHeld` (derived view) |
| `ChangeOrder` | new `ChangeOrderItem` (costCodeId, description, qty, unitRate, customerAmount, costDelta); `crewCost` stays as the sum for existing rows |
| `Estimate` / `EstimateLineItem` | `kind`, `costCodeId`, `source` (manual · roofing_takeoff · plan_takeoff · assembly · template), `provenance` JSON (ruleKey, assemblyId, parameters, priceAsOf, matchConfidence, needsReview) |
| `RoofEstimate` | frozen by generation; a migration script converts open ones to `Estimate` with a roofing section; the family is retired after the click-through |
| `RoofMaterialItem` / `RoofMaterialPrice` | become `PriceItem` / `PriceQuote` (rename + `vendorId`, `validTo`, `jobId`, `source` widened); roofing rules keep pointing at them |
| `DailyLog` | new `DailyLogEntry` (type, text, hours, cause, sourceModule, sourceRef, photo ids) |
| `AuditEvent` | typed actions added for budget, commitment, pay application, waiver, norm acceptance |

### 16.2 New tables

| Table | Key fields | Relationships |
|---|---|---|
| `EstimateLineResource` | lineId, kind, name, code, unit, qtyPerLineUnit, unitRate, priceItemId?, normId?, priceAsOf, matchConfidence, needsReview | line ∈ Estimate |
| `EstimateMarkupStep` | estimateId, key, label, category, kind (PERCENT · FIXED · GROSS_UP), rate, baseKeys[], sortOrder | ordered; validated acyclic |
| `EstimateAllowance` + `AllowanceDrawdown` | estimateId/jobId, type, heldAmount; drawdown amount, reason, expenseId? | remaining rolls into totals |
| `EstimateSnapshot` | estimateId, takenAt, reason (SENT · CONTRACT · MANUAL), lines JSON, markups JSON, totals | pointed at by `CustomerContract.estimateSnapshotId` |
| `Assembly` + `AssemblyComponent` | code, name, unit, category, serviceCategoryId?, parameters JSON; component kind, priceItemId?/normId?, qtyPerUnit or formula, wastePct, burdenPct | expands to lines + resources |
| `LaborNorm` + `NormMaterial` | workKey, unit, laborHoursPerUnit, machineHoursPerUnit, serviceCategoryId, isActive; material priceItemId, netQtyPerUnit | unpriced by design; roofing rules remain the roofing norm set |
| `PriceItem`, `VendorSku`, `PriceQuote` | see §10 | vendorId → `Vendor` |
| `SubcontractPayApplication` + `SubcontractPayApplicationLine` | laborContractId, number, periodFrom/To, gross, retentionHeld, net, status, approvedBy, paidAt; line → `LaborContractTask`, claimed, approved | `LaborPayment.payApplicationId` |
| `RetentionLedger` | laborContractId, applicationId, kind ACCRUED · RELEASED, amount, reason | derived balance |
| `LienWaiver` | laborContractId, applicationId?, type, throughDate, amount, signedAt, fileId | gate on payment |
| `PlanDocument`, `PlanPage`, `PlanMeasurement` | see §8 | measurement → estimate line |
| `EquipmentAsset`, `EquipmentUsage` | asset: name, ownership, ratePerDay/Hour, vendorId?; usage: jobId, dailyLogId?, costCodeId, hours/days, amount | posts an EQUIPMENT cost row by code |
| `PunchItem` | jobId, areaId?, description, vendorId?, status, resolvedBy, verifiedBy, reopenCount, reworkCost, backChargeVendorId? | photos via `File.punchItemId` |
| `JobCostSnapshot` | jobId, asOf, summary JSON, lines JSON | monthly cron + on signing |
| `ProductivityObservation` | jobId, costCodeId, normId?/ruleKey?, plannedQty, installedQty, plannedHoursPerUnit, earnedHours, actualHours, factor, status, coverage, causeCode?, note | read-only report persisted on job close |
| `NormRecommendation` | normId / ruleKey / priceItemId, currentValue, observedValue, suggestedValue, confidence, basis (observations), status, decidedBy, decidedAt | acceptance writes the target with provenance |
| `AiRun` | feature, model, prompt, response, tokens, costUsd, actorId, subject (type, id), outcome | every AI call |

### 16.3 Constraints and invariants

- `BudgetLine @@unique([jobId, costCodeId])`; one "Unallocated" code per job.
- `EstimateLineItem.unitPrice = Σ resources.qtyPerLineUnit × unitRate` enforced in the service when resources exist (DB CHECK not practical on JSON-free rows; a test and a nightly invariant query instead, as the CRM did for file ownership).
- `PriceQuote` append-only (no UPDATE route; corrections are new rows), as `RoofMaterialPrice` is today.
- `LienWaiver` gate enforced in `recordLaborPayment`, not in the route.
- `NormRecommendation.status` transitions audited; no path writes a norm or rule without an ACCEPTED row.
- `JobCostSnapshot` immutable.

### 16.4 Migration concerns

Backfill `JobExpense.costCodeId` from `type` and `category` text (mapping table reviewed by Richard; unmapped → Unallocated); `BudgetLine.costCodeId` from `category` text; `BudgetLine.originalAmount` = current amount for jobs without a signed contract snapshot; convert `RoofEstimate` rows to `Estimate` rows only for leads still open (closed ones stay readable through the frozen renderer, as the workflow v1 specs stay readable). Every backfill is a dry-run-first script, as the CRM's prod scripts already are.

---

## 17. Top 10 Opportunities

Scores 1–10. Difficulty, integration risk and licensing risk are inverted in the priority sum (10 − score), so Priority = value + time + margin + data + strategic + (10 − difficulty) + (10 − integration risk) + (10 − licence risk); maximum 80. Licence risk is for the clean-room native build.

| # | Concept (from OCE, built natively) | Business value | Dev difficulty | Integration risk | Licence risk | Time savings | Margin impact | Data advantage | Strategic value | **Priority** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Cost-code spine + budget buckets + ETC/EAC inside `computeCostSummary` | 10 | 5 | 4 | 1 | 6 | 10 | 9 | 10 | **65** |
| 2 | One estimate line model with per-unit resource split; roofing takeoff writes it; `RoofEstimate` retired | 9 | 6 | 5 | 1 | 7 | 8 | 9 | 9 | **60** |
| 3 | Estimate snapshot → budget seeding by code (estimate ↔ actual chain) | 9 | 3 | 3 | 1 | 7 | 8 | 9 | 8 | **64** |
| 4 | Post-calculation learning loop (productivity factor, coverage-gated recommendations, accept/reject) | 8 | 5 | 3 | 1 | 5 | 9 | 10 | 10 | **63** |
| 5 | Commitments derived from documents: PO + lines + receipts, sync markers | 8 | 5 | 4 | 1 | 6 | 7 | 7 | 7 | **55** |
| 6 | Subcontract pay applications, retention ledger, lien waivers on `LaborContract` | 8 | 5 | 4 | 1 | 6 | 6 | 6 | 7 | **53** |
| 7 | Markup cascade with explicit bases + allowances with drawdowns | 6 | 3 | 3 | 1 | 4 | 7 | 5 | 6 | **51** |
| 8 | Price quotes with validity + supplier package comparison + price-change detection | 7 | 5 | 3 | 1 | 6 | 7 | 8 | 7 | **56** |
| 9 | Plan takeoff: measurement model, scale rules, server recompute (manual first) | 7 | 8 | 4 | 2 | 7 | 5 | 6 | 8 | **49** |
| 10 | Monthly cost snapshot + margin-erosion attention row + KPI history | 7 | 2 | 2 | 1 | 4 | 6 | 7 | 6 | **55** |

Honourable mentions that did not make the ten: punch items (value 5, difficulty 2), typed daily-log entries (5/2), equipment usage (4/3), RFI-as-task (3/2), match decision ledger for cost-code suggestions (6/4), contingency EMV over a small risk list (4/4), cost-risk Monte Carlo on proposals (3/4).

Order of execution follows dependencies rather than raw score: 1 → 3 → 10 → 2 → 7 → 4 → 5 → 6 → 8 → 9.

---

## 18. Implementation Roadmap

Complexity scale: S (days), M (one to two weeks), L (three to five weeks), XL (more). Every phase keeps the CRM's gate: typecheck, lint ≤ baseline, tests green, build clean, dry-run scripts, deploy with the env override, Richard's click-through before the next.

### Phase 0 — Prerequisites and cleanup

- **Objective**: make the money model safe to extend.
- **Features**: `Job.contractAmount` derived through one recompute instead of four incrementers (keep behaviour, change the mechanism); `getFinancialSummary` and `overview.ts` read `computeCostSummary` only; route-local expense enums centralised; `guardJob` on budget line POST/import; budget import non-destructive (upsert by name, preview diff); remove dead models (`AiSession`, `PasswordResetToken`, `DashboardMetricSnapshot`, `Inspection`, `PermitLookupRun`) and dead deps; decide `RoofEstimate`'s retirement path; run the roofing import on prod; licence scanner + deny-list grep in CI; the clean-room memo.
- **Modules affected**: `lib/services/{jobs,financials,job-pricing}.ts`, `lib/jobs/overview.ts`, `lib/budget/*`, expense routes.
- **New DB objects**: none beyond drops.
- **APIs / UI**: budget import preview.
- **Background jobs**: none.
- **Dependencies**: none.
- **Migration**: drops only; a read-only prod check that no code path reads the dropped tables.
- **Testing**: invariant tests that cost summary inputs are identical before and after (the pattern used for the commitments deploy).
- **Security**: the two unguarded budget routes.
- **Licensing**: memo and CI rules.
- **Complexity**: M.

### Phase 1 — Highest value, lowest risk: cost-code spine, buckets, forecast, snapshot

- **Objective**: every money row carries a cost code; the job's cost summary shows original, approved and pending changes, committed, actual, ETC, EAC and variance by code; margin erosion surfaces on the dashboard.
- **Features**: `CostCode` tree and seed; `costCodeId` on `JobExpense`, `BudgetLine`, `Commitment`, `DailyLaborEntry` (exists), `ChangeOrderItem`; buckets on `BudgetLine`; ETC rule with override; `JobCostSnapshot` monthly and on signing; attention row "Margin erosion"; job health reason; digest line; Budget tab by code with buckets; cost-code suggestion on expense entry (exact → fuzzy over the company's own history, decision ledger — deterministic, no AI yet); cc-allocator intake accepts an optional cost code and otherwise suggests.
- **Modules affected**: `lib/jobs/cost-summary.ts` (extended, still one formula), `lib/services/job-cost.ts`, `lib/budget/*`, `lib/expenses/*`, `lib/attention/*`, `lib/jobs/health.ts`, notifications digest, Budget panel, Cost summary card, Reports → Collections.
- **New DB objects**: `CostCode` columns, `BudgetLine` columns, `JobExpense.costCodeId/syncKey`, `ChangeOrderItem`, `JobCostSnapshot`, `CostCodeDecision` (suggestion ledger).
- **APIs**: `GET /api/jobs/[id]/cost-summary` gains `lines[]`; `PATCH /api/jobs/[id]/budget/lines/[id]/etc`; `GET /api/cost-codes` (exists) gains tree; `POST /api/cron/cost-snapshots`.
- **Background jobs**: monthly snapshot cron wrapper.
- **Dependencies**: Phase 0.
- **Migration**: backfill by mapping table, dry run first; prod has 456 expenses and 3 budgets — small.
- **Testing**: pure tests for buckets and ETC; invariant: Σ lines = job totals; prod read-only before/after comparison.
- **Security**: money roles unchanged; snapshot read restricted to `canViewCompanyFinancials`.
- **Licensing**: none (public formulas).
- **Complexity**: L.

### Phase 2 — Construction financial controls: estimate chain, commitments, subcontracts

- **Objective**: the estimate that was signed is the budget; commitments come from documents; subcontractor money has applications, retention and waivers.
- **Features**: `EstimateLineItem.kind/costCodeId/source/provenance`; `EstimateSnapshot` on SENT and on contract; budget seeded from the snapshot by code at signing (original bucket), with the existing budget replaced only on an empty budget or with confirmation; `EstimateMarkupStep` + `EstimateAllowance` replacing the fee columns and margin % (seeded from company defaults; existing estimates migrated to equivalent steps so totals do not move); `Commitment.kind` + `CommitmentLine` + received quantities ("Record delivery" from the job and from a daily-log entry); sync markers; `SubcontractPayApplication`, `RetentionLedger`, `LienWaiver`, payment gate; change orders carry a cost side by code (approved → approved-changes bucket; SENT → pending).
- **Modules affected**: `lib/estimates/*` (one calculator), `lib/customer-contracts/{snapshot,sign-service}.ts`, `lib/vendors/commitment*.ts`, `lib/labor/*`, `lib/services/change-orders.ts`, panels for Estimates, Commitments, Labor, Change Orders.
- **New DB objects**: as §16.
- **APIs**: estimate markup/allowance routes; `POST /api/commitments/[id]/receipts`; `POST /api/labor-contracts/[id]/applications` (+ approve, pay), `/waivers`; `GET /api/jobs/[id]/budget/seed-preview`.
- **UI**: estimate builder gains a markup panel and line kinds; Budget "Seed from contract" preview; Commitments with lines and received; Labor contract card with applications, retention and waivers; Change order dialog with cost lines.
- **Background jobs**: none new.
- **Dependencies**: Phase 1.
- **Migration**: fee columns → markup steps (pure conversion, tested against every existing estimate's stored total); `RoofEstimate` conversion for open leads.
- **Testing**: golden tests that every prod estimate's total is reproduced to the cent through the cascade; G702 untouched; payment gate tests.
- **Security**: waiver files follow `fileReadWhere`; applications under money roles.
- **Licensing**: none.
- **Complexity**: XL (split into three deploys: estimates, commitments, subcontracts).

### Phase 3 — Advanced estimating and takeoff

- **Objective**: one estimating engine for every trade: roofing from Roofr, interior/W&D from assemblies, plumbing from parametric counts, all producing lines with resources; plan takeoff for measurements the reports do not give.
- **Features**: `LaborNorm` + `NormMaterial` (roofing norms seeded from `laborRatePerSquare` history and the crew payroll; interior norms from the template defs and field hours once Phase 1 has run a quarter); `Assembly` with parameters and a safe formula evaluator (allow-list AST, as the CRM's existing pure modules would do it); the roofing takeoff writes a full estimate (materials with rule provenance, labour from norms, fees as steps); `RoofSystem` as the named material pick per category (the P1 item already planned); `PlanDocument/Page/Measurement` with pdfjs rendering, two-click calibration, text-layer scale detection, server recompute, push-to-line; estimate basis (inclusions/exclusions/assumptions generated, class suggested); proposal PDF from the one renderer.
- **Modules affected**: `lib/roofing/engine`, `lib/estimates`, new `lib/takeoff`, new `lib/assemblies`, Files preview (plans).
- **New DB objects**: as §16.
- **APIs**: `/api/estimates/[id]/lines/from-takeoff`, `/api/plans/*`, `/api/assemblies/*`, `/api/norms/*`.
- **UI**: takeoff viewer (canvas over pdfjs), assembly picker in the estimate builder, norms admin beside Roofing Prices.
- **Background jobs**: none (PDF text extraction runs in the request as the Roofr parse does; move to a job if plans exceed the limit).
- **Dependencies**: Phase 2.
- **Migration**: none destructive.
- **Testing**: engine golden files from the 23 real Roofr PDFs; takeoff recompute tests; formula evaluator fuzz tests.
- **Security**: plan files under job scope; the viewer frames the file route (`FRAMED_BY_SELF` already covers it).
- **Licensing**: pdfjs only; no PyMuPDF, no converters; own norms and prices.
- **Complexity**: XL.

### Phase 4 — Procurement and subcontractor intelligence

- **Objective**: know what things cost now, who sells them cheapest for this package, and how each subcontractor performs.
- **Features**: `PriceItem/VendorSku/PriceQuote` generalising the roofing price book; quote capture from supplier invoices and receipts (parser first, human confirm); current / 90-day average / change; `MaterialPackage` per takeoff with per-vendor totals, coverage and a recommendation; price-change attention row; vendor scorecard from data the CRM holds (on-time deliveries from receipts, change-order rate, pay-app disputes, compliance gaps); `EquipmentAsset/Usage`; `PunchItem` with back-charges to vendors; typed daily-log entries including deliveries that receive commitment lines.
- **Modules affected**: `lib/roofing/price-book.ts` → `lib/pricing`, `lib/vendors/*`, field daily-log routes, expenses panel.
- **New DB objects**: as §16.
- **APIs**: `/api/price-items/*`, `/api/vendors/[id]/quotes`, `/api/estimates/[id]/packages`, `/api/jobs/[id]/punch`, `/api/equipment/*`.
- **UI**: Pricing admin (replaces Roofing Prices), vendor page Pricing and Performance cards, package comparison on the estimate, punch list tab, equipment on the daily log.
- **Background jobs**: nightly stale-price and price-change scan.
- **Dependencies**: Phases 2–3.
- **Migration**: rename roofing price tables with views for compatibility.
- **Testing**: comparison math pure tests; scorecard tests against staged data.
- **Security**: who sees cost (Richard's open ruling) decides the role list for pricing.
- **Licensing**: scraped supplier prices need each site's terms checked; invoice-derived prices are the company's own data.
- **Complexity**: L–XL.

### Phase 5 — AI and predictive intelligence

- **Objective**: AI assists interpretation on top of deterministic numbers, every output a proposal.
- **Features**: `lib/ai` with `AiRun` audit and per-feature switches; cost-code suggestions upgraded with an LLM rerank among real candidates; invoice/receipt line extraction into price quotes; scope extraction from lead text into a parameter sheet (code computes quantities); CO draft from daily-log delay entries; owner daily report summary; margin-erosion and risk narratives in the digest; "jobs like this one" over structured fields; plan sheet identification and scale proposal when the text layer is empty; later, room/count proposals.
- **Modules affected**: notifications digest, estimates, expenses, daily logs, attention.
- **New DB objects**: `AiRun`, proposal rows on the relevant tables (`proposed` status), `ProductivityObservation`/`NormRecommendation` if not landed in Phase 2's learning-loop deploy.
- **APIs**: `/api/ai/*` behind role lists; every write still through the ordinary routes.
- **UI**: suggestion chips with accept/reject and the reason shown.
- **Background jobs**: nightly batch for summaries and comparisons.
- **Dependencies**: Phases 1–4 (the loop needs codes, snapshots and resources).
- **Migration**: none.
- **Testing**: zod-validated outputs; golden prompts; a mocked provider in tests (the CRM's test setup has no network).
- **Security**: PII (SSNs never leave the box; personnel data excluded from prompts); per-feature allowlists; cost caps.
- **Licensing**: own prompts; provider terms.
- **Complexity**: L, spread across quarters.

**The learning loop** (opportunity 4) is built at the end of Phase 2 as a read-only report over Phase 1 and 2 data: `ProductivityObservation` per job and code on close, `NormRecommendation` with accept/reject under Admin → Roofing/Norms, acceptance writing the rule or norm with provenance. It is listed under Phase 2 because it is deterministic and needs no AI.

---

## 19. Features Not Recommended

| OCE feature | Reason not to adopt |
|---|---|
| Any OCE code, module, schema copy, port or vendored file | AGPL; PyMuPDF cascade; derivative-work exposure (§5) |
| CWICR / "120K cost items" / `USA_USD` catalogue | CC BY-NC upstream, basis "PENDING", Russian norms repriced; useless for Florida residential trades anyway |
| DDC cad2data converters; DWG/RVT/IFC/DGN import; BIM hub, clash, BCF, OpenCDE, 3D Tiles, point cloud | Proprietary EULA forbids SaaS; irrelevant to roofing/interior/W&D/plumbing jobs |
| PyMuPDF-based PDF handling | AGPL; the CRM already has pdfjs-dist |
| EVM (four engines), TCPI, S-curves from typed points, CVR | Heavy-industrial vocabulary; the CRM's bucket model plus ETC is what a residential contractor reads; OCE's own engines disagree |
| CPM/Gantt (three copies), Last Planner, takt, forensic delay analysis, XER/MSP | Over-engineered for jobs of this size; the workflow's dependency edges and durations can draw a phase Gantt natively later |
| ISO 19650 CDE, suitability codes, five document subsystems, transmittals, signing with no cryptography | Institutional; the CRM's protected generated documents and token signing are stronger where it matters |
| GAEB / BC3 / ÖNORM exchange, 44 locales, FX and PPP, price indices (Russian FSNB method), VAT gross-ups by country | Not applicable |
| Three bid engines and two PO/GR stacks | Duplication; the CRM should build one RFQ comparison and one commitment chain |
| `property_dev` (plots, reservations, escrow, RERA/214-FZ reports) | A developer-sales CRM, not feasibility/draws/IRR; the fleet's landdev-analyzer is the right home |
| OCE's CRM, portal, webhook_leads, contacts | Weaker than the CRM's leads, nurture, canvassing and token pages |
| Multi-provider LLM layer, Qdrant/BGE-M3 vector stack, ReAct agents with text tool-calls, sandbox-seeded accuracy boards | One provider with structured outputs suffices; vector search not needed for a company price book |
| Legacy `quick_estimate` / `photo_estimate` that write model-invented unit prices to lines | The anti-pattern this report exists to avoid |
| ROM estimate constants, waste factors as one scalar, 25 generic assembly templates, three placeholder norms | Demo data; the CRM's roofing rules are already calibrated |
| Certified payroll, Davis-Bacon, tax withholding regimes, e-invoice clearance (Mexico CFDI etc.), carbon/ESG, accommodation, prefab, formwork, rebar schedules, temporary works, commissioning, authority submissions | Not this business |
| Desktop/Tauri build, embedded PostgreSQL, module marketplace | The CRM is one hosted app under SSO |
| OCE's safety, HSE, forms, site logistics, inventory/warehouse | The CRM's checklist, field issues and a future incident form cover residential needs; stock control is not a need |

---

## 20. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Licence contamination from reading OCE (an implementer "remembers" code) | Medium | High | Clean-room protocol (§5.5): separate specifier/implementer, this document as the only spec, snippet comparison, CI deny-list |
| Someone imports a CWICR CSV "just to seed" | Low | High | CI grep for `cwicr`/`DDC_`; price book seeded only from own data |
| A second cost formula creeps in with the buckets | Medium | High | Extend `computeCostSummary`; invariant tests; the CLAUDE.md rule already forbids new sums |
| Cost-code backfill maps expenses wrongly | Medium | Medium | Mapping table reviewed by Richard; Unallocated line; dry run and read-only prod comparison |
| Retiring `RoofEstimate` moves a number on an open lead | Medium | Medium | Golden test: every stored total reproduced to the cent; generation-based retirement; closed leads frozen |
| Field data too sparse for a credible learning loop (prod: 3 budgets, cost codes on labour only) | High now | Medium | Phase 1 first; recommendations gated by coverage ≥ 10% and shown with their basis; nothing auto-applied |
| Lien-waiver gate blocks a legitimate payment | Low | Medium | Warn-not-block default, admin switch, override with reason audited (the compliance pattern) |
| Plan takeoff in the request path exceeds limits on large plan sets | Medium | Low | Page-at-a-time extraction; job table later; the CRM has no queue today |
| AI outputs written as facts | Low with the proposed design | High | `proposed` rows only; zod validation; `AiRun` audit; money never written by AI |
| Scope creep toward "an ERP" | High | High | §19 list; each phase ends with a click-through; initiatives stay inside existing models |
| Fleet duplication (materials in three catalogues, properties in six tables) grows | Medium | Medium | Phase 4 makes the CRM the price-book owner; a fleet property registry is a separate decision |
| Operator items still pending (SPF, workflow roles, vendor directory) starve the new features of signal | High | Medium | They remain on the next-prompt list; Phase 1's attention rows work without email |

---

## 21. Final Recommendation

OpenConstructionERP is worth the read and not worth a byte of its code. Its licence stack makes every form of incorporation RED for a proprietary SaaS; its data is unusable and non-commercial; its breadth is produced faster than it is integrated. What it does offer is a handful of well-designed financial shapes that CareyOS is missing: cost codes on every money row, budget buckets with a derived commitment and a forecast, a per-unit resource split on estimate lines, an immutable estimate baseline that seeds the budget, a post-calculation loop that recommends and never applies, subcontract pay applications with retention and lien waivers, and a markup cascade that names what it compounds on. All of these are public methods; all fit inside the CRM's existing models and its one-formula rule; none needs OCE at runtime.

### If CareyOS could adopt only FIVE concepts in the next 90 days

Figures are estimates from the prod facts recorded in this repository's memory (26 jobs, 456 expenses, $1.52M in labour contracts, 3 of 17 open billable jobs with a budget, one job already paid $2,350 over its labour contracts) and from ordinary office practice; they are stated so they can be checked, not as promises.

1. **Cost-code spine + budget buckets + ETC/EAC in the existing cost summary (Phase 1).**
   Margin erosion becomes visible when a PO or labour CO is entered rather than at closeout. Visibility: every open job gets a forecast; today 14 of 17 have no budget at all. Margin: catching a 5% overrun on one code a month earlier on a typical $60–250K job is worth $1–5K per job; across ~17 open jobs that is the whole year's margin on one small job. Hours: the Collections review stops needing a spreadsheet (est. 2–3 h/week for the office). Cost: zero licensing, one migration.

2. **Estimate snapshot → budget by code, with one estimate line model (Phase 2, first deploy).**
   Every signed job starts with a budget it did not have; the roofing takeoff finally writes the estimate it was built to write. Estimating accuracy: the typed `materialCost` is replaced by quantities × current prices, removing the single largest manual number on a roofing quote; hours saved per roofing estimate est. 30–45 minutes (the estimator's own sprint notes put the manual material list at that). Visibility: estimated vs actual by code on the job page from day one.

3. **Commitments derived from documents (POs with lines and receipts) and sync markers (Phase 2, second deploy).**
   Today "committed" is whatever was typed; with POs the number is auditable and receipts close the loop with the field. Cost reduction: unapproved or duplicate supplier charges surface at receipt instead of at cc-allocator posting (the reconciliation found 19 duplicates worth $16K once already). Hours: fewer reconciliation rulings per month.

4. **Post-calculation learning loop: productivity factor by code, coverage-gated recommendations, accept/reject (end of Phase 2).**
   Uses labour hours the field already books with cost codes and the estimate's hours per unit. Estimating accuracy: after one quarter of closed jobs the company has observed hours per square and per opening by crew; the brief's drywall example (+18.9%) becomes a recommendation with its cause recorded. Margin: a 3–5 point improvement in labour estimating accuracy on labour that runs at ~$1.5M in contracts is $45–75K a year of avoided under-pricing or over-pricing. Strategic: the data advantage compounds with every job and belongs to nobody else.

5. **Subcontract pay applications, retention ledger and lien waivers on labour contracts (Phase 2, third deploy).**
   Cost control and legal exposure on the payable side: no payment without the waiver when the contract requires it; retention held and released from a ledger instead of a stored flag; the JOB-00002 overpayment pattern ($17,380 paid against $15,030) is blocked at entry. Revenue opportunity: cleaner waivers and applications are what a lender or commercial customer asks for on the next Towne Place-sized job (the CRM already carries that project's 11 applications), so this is also what makes progress-billed commercial work repeatable.

Together these five turn the CRM's strongest asset, a complete operational record from lead to payroll, into a financial control system with memory. Everything else in this report waits on them.

---

### Appendix A — Source material

- CRM repository `construction-crm/constructioncrm` at `ea5ce0a` (2026-10-07), schema `prisma/schema.prisma` (126 models), `docs/project-memory/*`, 180 test files.
- Fleet repositories read: `careyos`, `cc-allocator`, `knu-estimator`, `roofestimator`, `knu-phone-routing`, `TitleLedgerv2`, `closing-brain`, `equifirst-site`, `fl-buyback-docs`, `constructioncrm.old` (dead ancestor), `homedepotscraper` (empty), `fairfield` (empty).
- OpenConstructionERP clone at commit `3c00e672bc3bfcbaf3dec7ab363592a46bb6cc9b` (2026-10-07, v18.4.0), read under the session scratch directory; upstream `OpenConstructionEstimate-DDC-CWICR` and `cad2data-Revit-IFC-DWG-DGN` licence files fetched for the licensing section.
- Nothing from OCE was executed, installed or copied; the clone should be deleted when this review closes.

### Appendix B — Open rulings this plan needs from Richard

1. Who sees cost and margin (already open from the roofing plan) — decides role lists for pricing, budgets and the learning loop.
2. Whether the lien-waiver gate blocks or warns by default.
3. The company cost-code list (a draft of ~60 codes can be generated from existing types, template sections and roofing categories for review).
4. Whether `RoofEstimate` retires in Phase 2 or stays for one more season beside the new line model.
5. Whether supplier price scraping is wanted at all, or invoice/receipt capture is enough for the first year.
