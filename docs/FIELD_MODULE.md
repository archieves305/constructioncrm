# Field Mode & Crew Module — Architecture Scaffold

Shipped 2026-07-03 (commits `c3c9164` → `c8d5398`). iPad-first field operations:
personnel roster with encrypted SSNs, daily labor sheets with cross-job weekly
overtime, daily jobsite logs with photos, field-labor job costing, and
report/payroll delivery — built as six independently shipped phases plus
follow-up field features.

## 1. Surface map

### Field Mode (`(field)` route group — touch-first shell, no office sidebar)

| Route | What it is |
|---|---|
| `/field` | Home: my-jobs tiles with today's log status, "yesterday not submitted" nudges, weekly-hours-to-bookkeeper card |
| `/field/jobs/[jobId]/daily/[date]` | The daily log editor — Crew / Work Log / Photos pills, autosave, submit |
| `/field/jobs/[jobId]/logs` | Log history for a job: open, PDF, email to anyone, delete drafts |

Who gets in: ADMIN, MANAGER, OFFICE_STAFF, CREW_LEAD, READ_ONLY. CREW_LEAD is
**confined** to `/field` by middleware and only sees jobs they're field-assigned
to (or PM of).

### Office (dashboard) surfaces

| Surface | What it does |
|---|---|
| `/personnel`, `/personnel/[id]` | Roster CRUD; masked SSN with audited reveal; W-9/ID docs; rates (grant-gated) |
| Job → **Daily Logs** tab | Field-access assignments, field-labor KPIs/budget-vs-actual/burn, log list, report-package PDF |
| Job → **Photos** tab | Gallery with category/date filters + lightbox |
| `/jobs/[id]/daily-logs/[date]` | Per-day review: crew table, narrative, approve / return / reopen / delete, PDF |
| `/field-logs` | Cross-job approval queue |
| `/reports/labor` | Hours/cost by job/worker/trade/week, CSV, payroll export, bookkeeper email setting (admin) |
| `/admin/users` | Role assignment + per-user field grants (audited) |

## 2. Data model (all in `prisma/schema.prisma`, migrations `20260703*`)

```
Personnel ──< DailyLaborEntry >── DailyLog >── Job
    │                │                │
    │ (crewId?)      │ (budgetLineId?)│ (unique jobId+logDate)
    ▼                ▼                ▼
  Crew        BudgetAllocation    FieldPhoto / FieldIssue ── Task (one-way sync)
              (system-mirrored,
               1:1 per entry)
```

- **`Personnel`** — one table for W-2 employees AND sub-crew workers
  (`employmentType`, optional `crewId`). SSNs stored as
  `ssnCiphertext/ssnLast4/ssnKeyVersion` (AES-256-GCM, versioned keyring,
  AAD-bound to the row id). Soft-delete; labor entries FK `Restrict`.
- **`PersonnelDocument`** — W-9/ID/cert files. Distinct from the lead-anchored
  `File` model on purpose; same gate as SSN reveal.
- **`DailyLog`** — ONE per (job, date): the shared header for the labor sheet
  and the narrative sections, plus weather, safety checklist, signature, and
  the DRAFT → SUBMITTED → APPROVED workflow columns (`returnNote` for
  send-backs).
- **`DailyLaborEntry`** — one row per worker per day (split shifts allowed).
  Client-generated ids (offline-idempotent). Times are minutes-from-midnight
  (`endMinutes > 1440` = crossed midnight). Stores **snapshots**: rate, OT
  rate, computed reg/OT/total hours and cost. Check-in/out timestamps + GPS.
- **`FieldPhoto`** — job-scoped, optionally pinned to log/entry/issue/area;
  client-downscaled to ≤2000px JPEG before upload.
- **`FieldIssue`** — field-flagged items (follow-up / CO review / safety /
  material request / inspection reminder); creates a linked office `Task`;
  resolving the issue completes the task, never the reverse.
- **`CostCode`** (global), **`JobArea`** (hotel room/floor/unit),
  **`JobFieldAssignment`** (crew-lead ↔ job), **`LaborSettings`** (singleton:
  OT policy + `bookkeeperEmail`).
- **`User`** grants: `canViewSensitivePersonnel`, `canEditPayRates`,
  `canViewPayrollReports` — read fresh from DB per request, admin-set, audited.
- **`BudgetAllocation.dailyLaborEntryId`** — system-maintained mirror rows
  (amount = entry cost) whenever an entry names a budget line. Never hand-edit.

## 3. Load-bearing invariants — do not break these

1. **Field labor is a separate cost stream from `Job.laborCost`.** Contract
   labor (lump-sum `LaborContract`s) and hourly field labor both count toward
   job cost but never merge — hotel jobs run both simultaneously.
2. **Labor saves are full-sheet replaces** keyed by client-generated entry
   ids: a retried request is a no-op. `DailyLog` is unique on (job, date).
3. **Weekly OT allocates across ALL of a worker's jobs** for the payroll week
   (`src/lib/labor/hours.ts`, pure + tested). Editing Monday on job A can
   re-split Friday on job B.
4. **Approval freezes numbers.** A recompute that would touch an approved
   day's entries fails with 409 + `lockedDates`; ADMIN reopens first.
5. **Costs are stripped server-side** for non-cost roles via one serializer
   choke point (`src/lib/labor/serialize.ts`). Emailed PDFs are ALWAYS the
   cost-free variant. Payroll gates use **explicit role lists**, never
   `hasMinRole` (SALES_REP outranks OFFICE_STAFF numerically).
6. **Dates travel as `YYYY-MM-DD` strings end-to-end**
   (`src/lib/labor/dates.ts`); never local-parse them into `Date` on servers.
7. All file bytes flow through `src/lib/files/storage.ts` — the single seam
   for the planned S3/R2 migration.

## 4. Key code locations

| Area | Files |
|---|---|
| Hours/OT engine (pure, tested) | `src/lib/labor/hours.ts`, `recompute.ts`, `dates.ts`, `settings.ts` |
| Sheet save/workflow service | `src/lib/labor/log-service.ts` |
| Access control | `src/lib/labor/permissions.ts`, `serialize.ts`, `route-helpers.ts` |
| SSN encryption | `src/lib/crypto/field-encryption.ts` (+ `scripts/rotate-field-encryption.ts`) |
| Payroll shaping | `src/lib/labor/payroll.ts` |
| PDF data + renderers | `src/lib/labor/pdf-data.ts`, `src/lib/pdf/daily-log.tsx` |
| Weather | `src/lib/weather/open-meteo.ts` (keyless; device GPS first, job coords fallback) |
| Offline layer | `src/lib/field-store.ts` (IndexedDB drafts + photo queue), `src/hooks/use-labor-sheet.ts`, `use-log-narrative.ts`, `src/lib/photo-utils.ts` |
| Field UI | `src/components/field/*` (shell, time steppers, work-log cards, photos, signature pad) |
| API routes | `src/app/api/personnel*`, `src/app/api/jobs/[id]/daily-logs*`, `.../photos`, `.../field-issues`, `.../field-assignments`, `.../labor-summary`, `/api/reports/field-labor*`, `/api/field-logs`, `/api/field/today`, `/api/cost-codes`, `/api/admin/labor-settings` |

## 5. Daily workflow (as built)

1. Crew lead opens `/field` → job tile → today's log.
2. Crew pill: copy yesterday's crew / mark all present; per-worker time
   steppers, break presets, check-in/out (GPS), late/left-early flags, and a
   "what did they work on today?" note.
3. Work Log pill: weather auto-fill (device location), narrative cards,
   safety checklist, "flag an issue for the office" (creates a Task).
4. Photos pill: camera/library → downscale → batch-tag → persistent upload
   queue (survives dead spots).
5. Submit (optional signature) → office reviews at `/field-logs` or the job
   tab → approve (freezes) or return with a note.
6. Costs flow automatically: entry cost → job profitability (`fieldLaborCost`
   stream) → budget-vs-actual via mirrored allocations → burn rate.
7. Reporting: daily PDF (+ photos), multi-day package PDF (≤14 days),
   `/reports/labor` CSV exports, payroll CSV, weekly email to bookkeeper,
   per-log email to any recipient (cost-free PDF, audited).

## 6. Ops notes

- **`FIELD_ENCRYPTION_KEYS`** lives in `/etc/knuco/env` (v1 generated
  2026-07-03 on the droplet). Losing it = losing stored SSNs — keep a copy in
  the password manager. Rotate: append `v2:<key>`, restart, run
  `npx tsx scripts/rotate-field-encryption.ts`, drop v1.
- Weekly/daily email features require MailerSend env (already set in prod).
  Bookkeeper address: `LaborSettings.bookkeeperEmail`, set on `/reports/labor`.
- Droplet swap was doubled to 5GB (`/swapfile2`, fstab) on 2026-07-03 after
  `npm ci` OOM'd — the box also hosts eservice/roof-estimator/rentals; watch
  memory before adding more services.
- Photo storage grows on local disk (`uploads/`) — client downscaling keeps
  files ~½MB, but S3/R2 migration (v2.0 Sprint 3) becomes more pressing as
  photo volume grows.
- Cron pattern for automations: shell scripts in `/home/knuco/crm-cron/*.sh`
  (root crontab) curl `/api/cron/<name>` with `CRON_SECRET`. Only
  invoice-aging is wired today.

## 7. Proposed next sprints (field module roadmap)

Ordered by value ÷ effort; F1/F2 reuse existing cron + email plumbing.

- **F1 — Nudges & auto-delivery (small):** 5pm reminder to crew leads with
  unsubmitted drafts; morning office digest of logs awaiting approval;
  per-job "report recipients" list that auto-emails the approved daily PDF
  (replaces manual sends); stale-draft digest (>48h).
- **F2 — Payroll automation (small):** Monday-morning cron that auto-emails
  the prior week's payroll to the bookkeeper (same audited path as the
  button); missing-rate alert (hours computing at $0); optional
  "approved-logs-only" toggle on payroll exports.
- **F3 — Crew scheduling (medium):** plan tomorrow's crew from today's log
  (auto-create the next draft from "tomorrow plan" + roster); week-view of
  who's on which job (JobFieldAssignment + CrewAssignment); overlapping-hours
  conflict warnings for a worker across jobs.
- **F4 — Structured field docs (medium):** material-delivery and equipment
  logs as real tables (deferred from v1), inspection scheduling from the
  field, OSHA-shaped incident form.
- **F5 — Owner/client portal (medium):** tokenized read-only page (existing
  change-order-token pattern) where the owner sees approved daily reports +
  photo gallery; auto-notify on approval. Kills most manual PDF emailing.
- **F6 — Offline-first PWA (large):** installable app, service worker, full
  no-signal day, web-push for returned logs; plus server-side thumbnails.
  Revisit after real-world feedback on the current offline-friendly layer.
