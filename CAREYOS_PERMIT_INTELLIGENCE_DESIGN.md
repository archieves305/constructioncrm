# CareyOS — AI Permit Intelligence: technical design

_Approved plan: `~/.claude/plans/reactive-tickling-pony.md` (2026-10-18). This document is the full design behind it: the 12 phases of the brief, answered against the code and production as they stand._

---

## 0. Starting point (production, read only, 2026-10-18)

| Fact | Value | Consequence |
|---|---|---|
| Permits ever recorded | **3** — City of Boynton Beach (Interior Renovation, issued), City Of Miami (Electrical/Mechanical/Plumbing/Building, issued), "City of Palm Beach" (Re-Roof, applied) | Three jurisdictions, one permit each: there is no history to learn from yet. |
| Inspections | 0 | — |
| Jobs / lead cities | 27 jobs; leads in 10+ cities (Palm Beach Gardens, Lake Worth, Miami Gardens, Miami, West Palm Beach, …) | Jurisdictions are many and thin. Requirements are entered per jurisdiction as they come up. |
| Files | 102 (58 estimates, 36 other, 3 signed, 2 labor contracts, 1 plan set, 1 measurement); 0 permit-category files | The repository starts empty. |
| `ANTHROPIC_API_KEY` on prod | **not set** (dev has one) | Every AI feature answers "AI is not set up" until it is. Stage 1 works without it. |

**Design consequence.** The knowledge base starts as **structured records captured by the workflow itself**: correction items with their category and outcome, and requirement entries per jurisdiction × permit type. It does **not** start as a vector store. Retrieval is a SQL filter over jurisdiction, permit type and category. Vector search is added once there are a few hundred correction items (§8).

---

## 1. Integration map (Phase 1)

| Need in the brief | What exists | Verdict |
|---|---|---|
| Job-linked permits, several per job | `JobPermit` (`job_permits`: municipality string, type string, permitNumber, dates, `PermitStatus`, assignedUserId, inspector, fee quote, notes, finalPassedDate); `lib/permits/{rules,service,effects}.ts` | **Extend.** No parallel "PermitApplication". |
| Inspections | `JobPermitInspection` + `taskId` link to the workflow step; `lib/workflows/inspections.ts`; a failed result raises a correction task | **Reuse as is.** |
| Deadlines and reminders | `lib/permits/alerts.ts` (waiting 7/14 d, expiring 30 d, "be ready" before an inspection) + `alert-run.ts` (raise once per sourceKey, `settlePermitAlerts`); crons `permit-aging`, `inspection-reminders` | **Extend** with resubmission-due, corrections-received and closeout alerts. |
| Tasks, calendar, assignment, notifications | `createTask` / `updateTask` / `closeAutoTask`; Task link columns (lead, job, estimate, invoice, prospect, dailyLog, vendor, violationCase, organization); calendar overlays `permit_inspection` / `permit_date`; Notifications v2; digests | **Reuse.** Add a `Task.permitId` link and `SubjectKind "permit"`. |
| Workflow | Core v2 `permit_required` phase: `prepare_permit_documents` → `submit_permit_application` → `confirm_permit_issued` (PERMIT_NUMBER gate); `stage-sync.ts`; `gates.ts` held facts | **Reuse.** New held facts: "Preflight passed", "Package submitted". |
| Roles | `RoleName` (7 roles); `canWriteProduction` (ADMIN/MANAGER/OFFICE_STAFF/SALES_REP) covers permits; `guardJob`; workflow role `PERMIT_COORDINATOR` resolved by `userForJobRole` | **Reuse.** New permit-intel role lists live in one `access.ts`. |
| Audit | `AuditEvent` + `recordAudit` (never throws) | **Reuse** for every confirm, edit, approval and AI-proposed write. |
| Documents | `File` (lead/job/task/… links, `FileCategory` includes PERMIT, INSPECTION, PLAN_SET), `POST /api/files` (25 MB, MIME allow-list), `fileReadWhere`, `canDeleteFile`, `FilePreviewDialog`, `UPLOADS_DIR` + nightly backup | **Extend:** `File.permitId`, `File.permitDocType`, extracted text. |
| Company papers (licence, COI, registration, W-9) | Company document vault (`CompanyDocument`, versions, expiry alerts, RESTRICTED encryption, `approvedForExternal`) | **Reuse.** Permit packages reference vault documents and never copy them. |
| Architects, engineers, building departments | `Organization.kind` already has ARCHITECT, ENGINEER, MUNICIPALITY; `Contact` | **Reuse.** Permit parties link to them. |
| Company name, address, licences | `RoofingBrand` singleton (`gcLicense`, `roofingLicense`, address, phone) → `companyBlockFromBrand` | **Reuse** as the contractor source for form filling. |
| Roofing materials | `RoofMaterialItem` (no approval fields) | **Link** product approvals to it. |
| Anthropic | `runAiCall` (zod structured output via `betaZodOutputFormat`, refusal / max_tokens / schema-mismatch handling, input-hash cache, cost log, dollar cap) — **only on the unmerged `takeoff-m3` branch**, tied to a takeoff | **Lift to `src/lib/ai`** (Stage 0) with a polymorphic owner. |
| PDF in | `pdfjs-dist` (`roofing/parsing/pdf.ts` `extractPdfText`; takeoff extract worker in a forked child; page PNG render with `@napi-rs/canvas`) | **Reuse.** Scanned pages go to the model as page images (there is no OCR). |
| PDF out | `@react-pdf/renderer` (`src/lib/pdf/*`) | **Reuse** for the response letter and the readiness report. |
| Filling official forms | **nothing** | **New dependency: `pdf-lib`** (MIT) for AcroForm read and fill. |
| Zip packages | `fflate` (`partners/package.ts` prequal package with audit) | **Reuse.** |
| Background work | `PlanJob` / `PlanJobStep` tick runner (SKIP LOCKED, 40 s budget, 3 attempts, stale-lock reclaim, cron every minute) | **Generalise** (Stage 0). |
| Email out | `sendEmail` (MailerSend, attachments), `reportDelivery`; `Communication` rows on the lead | **Reuse.** New: a draft record, because no DRAFT state exists. |
| Email in | MailerSend inbound webhook (HMAC) → `InboundEmailEvent` → `BidIntake` triage (ITB pattern) | **Pattern for** municipal email intake (Stage 2b). Attachments are not stored today. |
| Search | ⌘K (`lib/search`), no tsvector / pg_trgm / pgvector | **Add** Postgres full-text on extracted text (Stage 2). |
| Dashboard | Attention rows `permits-expiring`, `permits-waiting`; Permit Center (`/permits`, status columns + Inspections tab) | **Extend** Permit Center with metrics; add `/permits/[id]`. |

**Must be built:** jurisdictions, requirement and knowledge entries, permit parties, review cycles, frozen submissions, correction notices and items, message drafts, form templates, mappings and fills, product approvals, preflight runs, the shared AI layer and the AcroForm filler.

---

## 2. Architecture

- **One module**, `src/lib/permit-intel/*`, beside `src/lib/permits/*` (which keeps the record, inspections and alerts). Pure planners (no Prisma) get tests: `requirements.ts`, `data-dictionary.ts`, `field-fill.ts`, `correction-schema.ts`, `approval-check.ts`, `preflight.ts`, `lessons.ts`, `metrics.ts`. Services hold the database work: `service-*.ts`.
- **The AI proposes and a person decides.** Every model output lands as a *proposed* row (`aiCallId`, `confidence`, `sourceRef`). Nothing the model says moves a status, sends a message, fills a licence field or replaces a document until a person confirms it. Confirmations are audited.
- **Deterministic rendering.** Official forms are filled field by field with pdf-lib. The model only maps field names to data keys and reads documents. It never draws, re-types or "reconstructs" a municipal form.
- **Immutable records.** Blank form sources, submitted packages, approved permits and stamped plans are locked: the file guard refuses delete, rename and replace (the `generated` rule from job files, extended to "referenced by a submission or a template").
- **Long work off the request.** Extraction and classification run as queued steps on the tick runner. The UI polls the step, as the plan index does.

---

## 3. Data model (Phase 2)

All new tables use cuid ids, snake_case maps, `created_at` / `updated_at`. Each stage ships its own migration through `migrate diff` + `db execute` + `resolve` (never `--schema` on execute; verify with an empty diff).

### Stage 0 — AI and the queue
```prisma
model AiCall {            // replaces takeoff-m3's PlanAiCall before M3 is ever deployed
  id String @id @default(cuid())
  subjectType String      // "takeoff" | "permit" | "permit_file" | "correction_notice" | "form_template" | "product_approval" | "preflight"
  subjectId   String
  purpose String; promptVersion String; model String; inputHash String
  status AiCallStatus @default(OK)          // OK | FAILED
  inputTokens Int @default(0); outputTokens Int @default(0)
  cacheReadTokens Int @default(0); cacheWriteTokens Int @default(0)
  costUsd Float @default(0); durationMs Int @default(0)
  output Json?; error String?
  requestedByUserId String?
  createdAt DateTime @default(now())
  @@index([subjectType, subjectId, purpose, inputHash])
  @@index([createdAt])
  @@map("ai_calls")
}
```
**Queue (moved to Stage 2, its first user):** `PlanJob` gains `subjectType String?`, `subjectId String?`; `planDocumentId` becomes nullable; `PlanJobKind` gains `PERMIT_FILE_EXTRACT`, `CORRECTION_EXTRACT`, `FORM_INVENTORY`, `APPROVAL_EXTRACT`. A CHECK makes a job carry a plan document or a subject. Doing it with no consumer would only widen the merge with takeoff-m3, which also edits the queue.

### Stage 1 — the permit record
```prisma
model Jurisdiction {
  id String @id @default(cuid())
  key String @unique                  // "town-of-palm-beach"
  name String                         // "Town of Palm Beach"
  kind JurisdictionKind               // CITY | TOWN | VILLAGE | COUNTY | STATE | OTHER
  county String?; state String @default("FL")
  hvhz Boolean @default(false)        // Miami-Dade, Broward (High-Velocity Hurricane Zone)
  organizationId String?              // the building department as an Organization (kind MUNICIPALITY)
  portalUrl String?; submissionMethod SubmissionMethod @default(UNKNOWN) // PORTAL | EMAIL | IN_PERSON | MAIL | UNKNOWN
  reviewDaysTarget Int?               // "in review too long" threshold; null = the 7 / 14 defaults
  notes String? @db.Text; isActive Boolean @default(true)
  @@map("jurisdictions")
}

model PermitTypeDef {                 // the catalog; JobPermit.permitType text is kept and backfilled
  id String @id @default(cuid())
  key String @unique                  // "reroof", "building", "electrical", "plumbing", "mechanical", "windows_doors", "interior_renovation", "demolition"
  name String; sortOrder Int @default(0); isActive Boolean @default(true)
  @@map("permit_type_defs")
}

model PermitKnowledge {               // requirements (Stage 1) and lessons (Stage 6) in one table
  id String @id @default(cuid())
  kind KnowledgeKind                  // REQUIREMENT | LESSON | TIP
  jurisdictionId String?              // null = every jurisdiction
  permitTypeKey String?               // null = every permit type
  title String; body String? @db.Text
  documentType String?                // a PERMIT_DOC_TYPES key the requirement asks for
  required Boolean @default(true)     // REQUIREMENT: blocker vs warning at preflight
  reliability Reliability             // OFFICIAL (published rule) | OBSERVED (seen in reviews) | INTERNAL (KNU practice)
  sourceUrl String?; sourceFileId String?
  effectiveFrom DateTime?; effectiveTo DateTime?
  status KnowledgeStatus @default(PROPOSED) // PROPOSED | APPROVED | REJECTED | RETIRED
  occurrences Int @default(0); lastSeenAt DateTime?   // OBSERVED lessons
  check Json?                         // optional machine check for preflight (§7)
  proposedFrom String?                // "correction_item:<id>" | "manual"
  aiCallId String?
  createdByUserId String?; decidedByUserId String?; decidedAt DateTime?
  @@index([kind, status, jurisdictionId, permitTypeKey])
  @@map("permit_knowledge")
}

model PermitParty {                   // who is on the application
  id String @id @default(cuid())
  permitId String
  role PermitPartyRole                // OWNER | APPLICANT | QUALIFIER | ARCHITECT | ENGINEER_OF_RECORD | SUBCONTRACTOR | OTHER
  organizationId String?; contactId String?; vendorId String?
  name String; email String?; phone String?
  licenseNumber String?               // as recorded by a person, never by the model
  licenseSource String?               // "brand.gcLicense" | "vault:<docId>" | "manual"
  @@index([permitId])
  @@map("permit_parties")
}

model PermitReviewCycle {
  id String @id @default(cuid())
  permitId String; number Int         // 1 = first submission
  submittedAt DateTime?; submissionId String? @unique
  outcome CycleOutcome @default(PENDING) // PENDING | APPROVED | CORRECTIONS | DENIED | WITHDRAWN
  outcomeAt DateTime?; reviewerName String?; notes String? @db.Text
  @@unique([permitId, number])
  @@map("permit_review_cycles")
}

model PermitSubmission {              // frozen: no update route exists
  id String @id @default(cuid())
  permitId String; cycleNumber Int
  kind SubmissionKind                 // INITIAL | RESUBMISSION | REVISION
  storageKey String; sha256 String; sizeBytes Int
  manifest Json                       // [{fileId|vaultDocId|approvalId, name, sha256, docType}]
  method SubmissionMethod; confirmationRef String?
  submittedAt DateTime; submittedByUserId String
  preflightRunId String?
  @@map("permit_submissions")
}
model PermitSubmissionFile { submissionId String; fileId String; sha256 String; @@id([submissionId, fileId]); @@map("permit_submission_files") }
```
**JobPermit additions:** `jurisdictionId String?`, `permitTypeKey String?`, `applicationNumber String?` (the municipal application or process number; `permitNumber` stays the issued number), `scopeDescription Text?`, `valuation Decimal(12,2)?`, `currentCycle Int @default(0)`, `readyAt DateTime?`, `readyByUserId String?`.
**PermitStatus additions:** `PREPARING` (not yet submitted; the default for new permits created from the module) and `CORRECTIONS` (the municipality asked for corrections). The waiting clock in `alerts.ts` counts APPLIED from the latest cycle's `submittedAt`, so a resubmission restarts it. *(Decision 7.)*
**File additions:** `permitId String?` (FK SET NULL, indexed), `permitDocType String?` (a key from `PERMIT_DOC_TYPES`), `extractedText Text?` (Stage 2), `sha256 String?`. **Task addition:** `permitId String?`. `FileCategory` gains `PRODUCT_APPROVAL` and `PERMIT_FORM`.

`PERMIT_DOC_TYPES` (code list, `permit-intel/doc-types.ts`) covers every category in the brief:
`blank_application, completed_application, contractor_registration, notice_of_commencement, owner_authorization, product_approval, installation_instructions, architectural_plans, structural_plans, engineering_letter, energy_calculations, wind_load, survey, site_plan, correction_notice, correction_response, revised_plans, approved_permit, stamped_plans, inspection_report, closeout, fee_receipt, other`. Each type carries `sealed` (architectural, structural, engineering, wind_load, energy → never altered by the system) and `immutableOnSubmit`.

### Stage 2 — corrections and communications
```prisma
model PermitCorrectionNotice {
  id String @id @default(cuid())
  permitId String; cycleNumber Int
  fileId String?                       // the letter or the marked-up set
  source NoticeSource                  // UPLOAD | PASTE | EMAIL
  receivedAt DateTime; rawText String? @db.Text
  status NoticeStatus @default(EXTRACTING) // EXTRACTING | REVIEW | CONFIRMED | RESPONDED | FAILED
  aiCallId String?; error String?
  confirmedByUserId String?; confirmedAt DateTime?
  @@map("permit_correction_notices")
}

model PermitCorrectionItem {
  id String @id @default(cuid())
  noticeId String; permitId String
  reviewerItemNumber String?           // "B-3", "Zoning 2"
  reviewerDiscipline String?           // "Building", "Structural", "Zoning", "Fire"
  text String @db.Text                 // verbatim from the letter
  sourcePage Int?; sourceQuote String? @db.Text
  category CorrectionCategory          // ADMINISTRATIVE | TECHNICAL | ARCHITECTURAL | ENGINEERING | CONTRACTOR | ZONING | FEE | OTHER
  affects CorrectionTarget             // FORM | PLAN_SHEET | PRODUCT_APPROVAL | SUPPORTING_DOCUMENT | FEE | SITE | OTHER
  affectsRef String?                   // "A-2.1", "NOA 21-0412.03", "Owner authorization"
  responsibleParty ResponsibleParty    // KNU | ARCHITECT | ENGINEER | OWNER | SUBCONTRACTOR | MANUFACTURER | MUNICIPALITY | OTHER
  partyId String?                      // a PermitParty
  confidence Float?                    // the model's, shown; null once a person edits the row
  status CorrectionStatus @default(PROPOSED) // PROPOSED | OPEN | WAITING_THIRD_PARTY | RESOLVED | DISPUTED | WAIVED
  response String? @db.Text            // the line for the response letter
  dueAt DateTime?; taskId String?
  reviewOutcome ItemOutcome?           // after the next review: ACCEPTED | RECOMMENTED
  @@index([permitId, status])
  @@map("permit_correction_items")
}
model PermitCorrectionItemFile { itemId String; fileId String; @@id([itemId, fileId]); @@map("permit_correction_item_files") } // the revised documents that answer an item

model PermitMessage {                  // an editable draft; becomes correspondence once sent
  id String @id @default(cuid())
  permitId String
  partyId String?; organizationId String?; contactId String?
  toEmails String[]; ccEmails String[]
  subject String; body String @db.Text
  purpose String                       // "correction_request" | "resubmission_notice" | "status_inquiry" | "owner_signature" | "other"
  correctionItemIds String[]; attachmentFileIds String[]
  status MessageStatus @default(DRAFT) // DRAFT | SENT | DISCARDED
  aiCallId String?
  createdByUserId String; sentByUserId String?; sentAt DateTime?
  communicationId String?              // the Communication row written on send (correspondence history on the lead)
  @@map("permit_messages")
}
```

### Stage 3 — forms
```prisma
model PermitFormTemplate {
  id String @id @default(cuid())
  jurisdictionId String; permitTypeKey String?
  name String; version Int
  sourceFileId String                  // the blank form; locked
  sourceSha256 String                  // a changed form is a new version, never an edit
  formKind FormKind                    // ACROFORM | XFA (refused) | FLAT (deferred)
  fieldInventory Json                  // [{name, type, page, rect, options, label (nearest text), maxLen}]
  status TemplateStatus @default(DRAFT) // DRAFT | PUBLISHED | RETIRED
  createdByUserId String; publishedByUserId String?; publishedAt DateTime?
  @@unique([jurisdictionId, name, version])
  @@map("permit_form_templates")
}

model PermitFormFieldMap {
  id String @id @default(cuid())
  templateId String; fieldName String
  dataKey String?                      // a DATA_DICTIONARY key, "literal:<text>", "check:<key>=<value>", or null = ask a person
  transform String?                    // "upper" | "date:MM/dd/yyyy" | "phone" | "money"
  protected Boolean @default(false)    // licence / signature / seal / notary / qualifier: records only, never the model
  aiSuggested Boolean @default(false); confidence Float?; rationale String?
  confirmedByUserId String?
  @@unique([templateId, fieldName])
  @@map("permit_form_field_maps")
}

model PermitFormFill {
  id String @id @default(cuid())
  permitId String; templateId String
  values Json                          // [{field, value, status FILLED|MISSING|CONFLICT|OVERRIDDEN|SIGN_BY_HAND, source, sourceRef, confidence}]
  outputFileId String?; flattenedFileId String?
  status FillStatus @default(DRAFT)    // DRAFT | FINAL
  createdByUserId String; finalizedByUserId String?; finalizedAt DateTime?
  @@map("permit_form_fills")
}
```

### Stage 4 — product approvals
```prisma
model ProductApproval {
  id String @id @default(cuid())
  authority ApprovalAuthority          // FL_PRODUCT_APPROVAL | MIAMI_DADE_NOA | OTHER
  approvalNumber String                // "FL12345-R7", "NOA 21-0412.03"
  revision String?
  manufacturer String; productName String; models String[]
  category ProductCategory             // UNDERLAYMENT | ROOF_COVERING | ROOF_ASSEMBLY | WINDOW | EXTERIOR_DOOR | GARAGE_DOOR | SHUTTER | SKYLIGHT | OTHER
  hvhzApproved Boolean?; nonHvhzApproved Boolean?
  designPressurePos Decimal? @db.Decimal(7,2); designPressureNeg Decimal? @db.Decimal(7,2) // psf
  impactRated Boolean?
  limitations String? @db.Text
  configurations Json?                 // roofing: [{deck, slopeMin, slopeMax, underlayment, fastening, maxDesignPressure}]
  issuedAt DateTime?; expiresAt DateTime?
  sourceFileId String                  // the approval document (a File, category PRODUCT_APPROVAL, no lead or job)
  installFileIds String[]
  extractedAiCallId String?
  verifiedByUserId String?; verifiedAt DateTime?
  verificationSource String @default("document") // "document" now; "online:<adapter>" later
  isActive Boolean @default(true)
  @@unique([authority, approvalNumber, revision])
  @@map("product_approvals")
}
model ProductApprovalMaterial { approvalId String; roofMaterialItemId String; @@id([approvalId, roofMaterialItemId]); @@map("product_approval_materials") }
model PermitProduct {
  id String @id @default(cuid())
  permitId String; approvalId String
  usedAs String?                       // "underlayment", "field tile", "front door"
  requiredPressurePos Decimal?; requiredPressureNeg Decimal? // from the engineer's wind-load document, entered by a person
  sourceFileId String?                 // that wind-load document
  @@unique([permitId, approvalId, usedAs])
  @@map("permit_products")
}
```

### Stage 5 — preflight
```prisma
model PermitPreflightRun {
  id String @id @default(cuid())
  permitId String; cycleNumber Int
  rulesVersion String; score Int
  findings Json                        // [{code, severity BLOCKER|WARNING|INFO, message, evidence:[{kind, ref, label}], suggestion, taskKey?, knowledgeId?}]
  aiReviewCallId String?
  ranByUserId String?; createdAt DateTime @default(now())
  @@index([permitId, createdAt])
  @@map("permit_preflight_runs")
}
```
Stage 6 adds no tables: lessons are `PermitKnowledge` rows of kind LESSON, and metrics are derived on read.

**Audit trail per permit.** Every write in the module calls `recordAudit({ entityType: "permit", entityId: permitId, action, before, after })`. Actions include `permit_party_*`, `cycle_*`, `submission_freeze`, `correction_confirm`, `correction_edit`, `message_send`, `form_fill_finalize`, `preflight_override`, `ai_proposal_accepted` and `ai_proposal_rejected`. The permit page's History tab reads them merged with `ActivityLog` and task events (the `mergeTimeline` pattern from the job Overview).

---

## 4. Document repository (Phase 3)

- **Storage:** ordinary `File` rows with `permitId` + `permitDocType`, so they live in the existing store with its backup and access rules. The job's Files tab shows them in a "Permits" group automatically, because they carry `jobId`.
- **Organisation:** the **Permit Library** (`/permits/library`) groups Jurisdiction → Permit type → Document type. It has filters for jurisdiction, type, doc type, date, "expiring" and "submitted / approved only", and searches name + metadata. From Stage 2 it also searches full text over `extractedText`, a generated `tsvector` column with a GIN index.
- **Reuse across jobs:** company papers come from the vault (a reference in the manifest, never a copy). Product approvals come from the approval repository. Blank forms are templates per jurisdiction. Job-specific documents are not reused: a NOC or a plan set belongs to its permit.
- **Classification:** on upload to a permit, a person may pick the type. When none is picked, a queued `PERMIT_FILE_EXTRACT` step:
  - extracts the text with pdfjs (DOCX and XLSX are stored but not read in the MVP — there is no reader for them in the app);
  - asks Claude Haiku 5.5 for `{docType, confidence, title, sheetNumbers?, sealed?, expiresAt?}`;
  - shows the result as a suggestion chip ("Looks like: Notice of Commencement — 92 %, Accept").
- **Versions:** "Upload a new version" on a permit file creates a new `File` with `supersedesFileId` and keeps the old one. Submitted and approved files are immutable: the file guard refuses delete, rename and replace when the file is in a `PermitSubmissionFile` row, is a template source, or is of type `approved_permit` / `stamped_plans`.
- **Expiry:** `expiresAt` on the file (NOC, owner authorization) feeds the existing permit alert run as a new key `permit-file:<id>:expiring@<date>`.
- **Upload validation:** the existing MIME + size check, **plus magic-byte sniffing** (`lib/files/sniff.ts`: PDF `%PDF-`, PNG, JPEG, HEIC `ftyp`, ZIP for DOCX/XLSX). A mismatch is refused. PDFs with JavaScript or `/Launch` actions are stored but never rendered by the server. Antivirus scanning is deferred *(decision 10)*.

---

## 5. AI form recognition and completion (Phase 4)

**Flow:**
1. **Upload a blank application** (Admin → Permits → Forms, or from the permit). It is stored locked, with its sha256.
2. **Inventory** (`FORM_INVENTORY` step, no AI): pdf-lib reads the AcroForm fields (name, type, page, rect, options, maxLen). pdfjs reads each page's text, and every field gets its nearest label (text left of or above the rect). XFA forms are detected and refused with a plain message. A form with no fields is `FLAT` and deferred.
3. **Map** (one AI call, Opus 5.5, `form_map` v1). The input is the field inventory with labels plus the **data dictionary** (key, description, example *format*), and **no job data at all**. The output is `[{fieldName, dataKey|null, transform, confidence, rationale}]`, schema-validated. Keys the dictionary marks `protected` (licence numbers, qualifier, signatures, seals, notary, dates of signing) are accepted only as a mapping. Their values always come from records.
4. **Review the mapping:** a person sees the form page image with each field outlined and its proposed key, then confirms or edits it and publishes the template. Publishing is versioned and immutable.
5. **Fill for a permit** (deterministic, `field-fill.ts`): the dictionary resolves each key from a loaded context — permit, job, lead/owner, parties, `RoofingBrand`, the vault, and confirmed document facts. Each value carries `source` (e.g. `job.lead.address`), `sourceRef` (the record link) and `confidence`: 1.0 from a record, the extractor's figure from a document fact.
   - **Missing** stays blank and is listed.
   - **Conflict** is two sources that disagree (the permit's address ≠ the plan's cover sheet). It is listed and blocks finalising until a person chooses.
   - Signature fields are always `SIGN_BY_HAND`.
6. **Document facts:** a `PERMIT_FILE_EXTRACT` on plans, the survey or the NOC can return facts such as `{key: "building.squareFeet", value, page, quote, confidence}`. They are shown for confirmation and only then used.
7. **Output:** pdf-lib sets values, `updateFieldAppearances`, and saves an editable copy plus a flattened copy (`form.flatten()`) as permit files of type `completed_application`. The original layout is untouched because only field values change. A person finalises; a final fill is locked.

**The data dictionary** (`permit-intel/data-dictionary.ts`, pure, tested) has about 60 keys in groups:
- `property.*`: address lines, city, zip, county, folio/parcel *(new `Lead.parcelNumber` field, entered by a person)*, legal description (document fact).
- `owner.*`: name, mailing address, phone, email.
- `contractor.*`: brand name, address, phone, email, `license.gc` and `license.roofing` (protected), qualifier name (protected).
- `permit.*`: type, scope, valuation, application number.
- `job.*`: number, start date.
- `architect.*` / `engineer.*`: from parties, licence protected.
- `building.*` (document facts): occupancy, construction type, stories, square feet, roof area, slope.
- `today`.

**Never invented:** a protected key with no record value is MISSING. The model is never asked for a value — only for which key a field means.

---

## 6. Product approval intelligence (Phase 5)

- **Repository** at `/permits/products`: search by number, manufacturer, product, category, HVHZ, expiry; one page per approval with its document, install instructions, configurations and the permits that used it.
- **Add an approval:** upload the FL PA or NOA PDF, then `APPROVAL_EXTRACT` (Opus 5.5, `approval_extract` v1) returns the fields of `ProductApproval`, each with page and quote. A person checks each field against the document, side by side, and saves; `verifiedBy` is set.
- **Expiry:** the planner from `document-alerts.ts` is copied in shape, not shared, because it is a different owner. It raises tasks once per `approval:<id>:expiring@<date>` for the permit coordinator default, plus a warning on every open permit that uses the approval.
- **Linking:** a roofing material item lists its approvals. Adding the item to a roof estimate can suggest the approval on the job's permit later; in the MVP it is linked by hand on the permit's Products tab.
- **Roofing compatibility check** (`approval-check.ts`, pure, tested). Every flag reads **"Advisory — not an engineering determination. The engineer of record and the building official decide."**
  - expired or expiring before the permit's expected approval;
  - jurisdiction is HVHZ and `hvhzApproved` is not true;
  - the required design pressure (entered from the engineer's wind-load document, never computed) exceeds the approval's;
  - the job's slope or deck is outside every configuration;
  - the underlayment in the configuration does not match the underlayment approval on the permit;
  - the approval document or install instructions are missing from the package.
- **Online verification:** an adapter interface `ApprovalVerifier { authority, verify(number): {status, expiresAt, url} }` with no adapter in the MVP. floridabuilding.org and Miami-Dade's NOA search are both public web pages; their terms of use are checked before any automated lookup *(decision 9)*.

---

## 7. AI pre-submission review (Phase 6)

**Engine** (`preflight.ts`, pure: `runPreflight(context, knowledge) → findings`). The rules are versioned (`PREFLIGHT_RULES_VERSION`), each with a code:

| Code | Check | Severity |
|---|---|---|
| `jurisdiction.set` | permit has a jurisdiction and a permit type | blocker |
| `requirement.<id>` | every APPROVED REQUIREMENT for the jurisdiction × type has a document of its type on the permit (or in the vault for company papers) | blocker if `required`, else warning |
| `form.complete` | a FINAL form fill exists for each published template of the jurisdiction × type; no MISSING required field, no CONFLICT | blocker |
| `data.address` | permit / form / plan cover-sheet addresses agree | blocker |
| `data.owner` | owner on the form = the owner party = the lead | warning |
| `data.contractor` | contractor and licence on the form = `RoofingBrand` | blocker |
| `data.valuation` | valuation set; NOC present when the jurisdiction's requirement says so (a REQUIREMENT with a `check: {valuationOver: n}`, not hard-coded) | blocker |
| `signature.*` | every SIGN_BY_HAND field and every notarised document is listed as a to-do | warning + task |
| `sealed.present` | the types the requirement asks to be sealed are present (the system cannot verify a seal; it lists them for a person to tick) | warning |
| `product.*` | every product on the permit passes `approval-check` | blocker for expired / HVHZ, warning otherwise |
| `party.licence` | architect / engineer parties have a licence number on record | warning |
| `lesson.<id>` | each APPROVED LESSON for the jurisdiction × type with a machine `check` is evaluated; without one it is shown as "Reviewer has asked for this before" | warning |
| `cycle.open_items` | on a resubmission, no correction item is still OPEN / WAITING | blocker |

- **Optional AI review** (Opus 5.5, `preflight_review` v1): the input is the package *summary* — doc types, sheet list, form field statuses, the products, and the open lessons. Raw documents, owner phone and email are not sent. It returns additional `WARNING` findings with evidence references to items in that summary, and **never blockers**.
- **Readiness report:** on the permit's Preflight tab, plus a PDF (react-pdf) for the file. It lists blockers, warnings, missing documents, suggested corrections, evidence links and "Create tasks" (one per finding, sourceKey `preflight:<permitId>:<code>`).
- **Score:** 100 − 25 per blocker − 5 per warning, floored at 0, labelled **"Readiness score — not a prediction of approval"**.
- **Mark ready to submit:** needs zero blockers, or an ADMIN/MANAGER override with a reason (audited). This sets `readyAt` and completes the workflow's `prepare_permit_documents` through a new held fact.

---

## 8. Corrections (Phase 7)

1. **Intake:**
   - **Upload or paste** on the permit's Corrections tab (MVP).
   - **Email (Stage 2b):** a municipal email forwarded to the inbound route is matched to a permit by application or permit number in the subject or body. Its attachments are stored (new: `InboundEmailEvent` attachments saved as Files), and a person confirms the match — the ITB triage pattern.
2. **Extract** (`CORRECTION_EXTRACT`, Opus 5.5, `correction_extract` v1):
   - Text from pdfjs. Pages with under 200 characters of text are sent as page images (the takeoff `render` helper).
   - The prompt carries the permit's party list and sheet list (names and roles only), so the model can name the responsible party and the affected sheet.
   - Output: `PermitCorrectionItem` fields per item, **with the verbatim text and page**; schema-validated.
   - Items are created `PROPOSED`.
3. **Confirm:** a review table lists each item beside its page image. A person edits the category, target, responsible party and due date, merges or splits items, deletes noise (letterhead, boilerplate), and confirms. The items become OPEN, or WAITING_THIRD_PARTY when the party is external, and the permit moves to `CORRECTIONS`. The cycle is marked `CORRECTIONS` too.
4. **Tasks:** one per item, `sourceKey permit-correction:<itemId>`, `permitId` + `jobId`. KNU items go to the coordinator; external ones get a task "Get <affectsRef> from <party>" for the coordinator. Plus one resubmission-due task (`permit:<id>:resubmit@<cycle>`, due on the jurisdiction's response window or 14 days). Closed by the item's status and the submission respectively (`settlePermitAlerts` grows the new keys).
5. **Drafts:** "Draft email" on a group of items with the same party (Opus 5.5, `correction_email` v1). The input is the items, the permit number, the address, the deadline, and the sender's name. The result is a `PermitMessage` DRAFT, fully editable, with the relevant revised files attachable.
6. **Document revisions:**
   - KNU-owned administrative documents (forms) are regenerated from the template with the changed values; this is a new fill and a new file version.
   - Sealed documents are **never** altered. The item waits until a revised file of the right type is uploaded and linked (`PermitCorrectionItemFile`), and "revised set received" is the record of that.
7. **Response letter:** react-pdf `permit-correction-response.tsx`. It carries the brand header, jurisdiction, application and permit numbers, address and cycle, then per item the reviewer number, the verbatim comment, the response, and the sheet or document revised. A person reviews it; it is stored as a permit file of type `correction_response`.
8. **Resubmission package:** preflight first (it includes `cycle.open_items`), then freeze → `PermitSubmission` kind RESUBMISSION. That opens cycle n+1 with `submittedAt`; the permit returns to APPLIED and the waiting clock restarts.
9. **Outcome:** when the next review comes back, each previous item is marked ACCEPTED or RECOMMENTED (the new notice's items can be linked to the old ones). The cycle outcome is recorded. This is the learning signal for §9.

**Human gates:** confirming items, sending any email, freezing a submission, marking ready, finalising a form, replacing a document.

---

## 9. Knowledge base (Phase 8)

- **Official rules** are REQUIREMENT / TIP rows with `reliability OFFICIAL`, a `sourceUrl` or source file, and `effectiveFrom/To`. They are entered by a person (Admin → Permits → Requirements). An expired rule (`effectiveTo` past) is not applied.
- **Observations:**
  1. When a cycle closes, a confirmed correction item that was ACCEPTED after a response proposes a LESSON (`lessons.ts` groups items by jurisdiction × type × category × target). One AI call (Haiku 5.5, `lesson_generalise` v1) rewrites the item as a general check, with no address, owner or permit number.
  2. A matching existing lesson increments `occurrences` / `lastSeenAt` instead of adding a row.
  3. Lessons are PROPOSED until an admin approves (optionally attaching a machine `check`), rejects or retires them.
- **Retrieval** (`knowledge.ts`): `APPROVED` and in effect, filtered by jurisdiction (exact, then county, then all) × permit type (exact, then all). Ranked by reliability (OFFICIAL > INTERNAL > OBSERVED), then jurisdiction specificity, then recency (`effectiveFrom` / `lastSeenAt`), then `occurrences`. "Similar past permits" are shown from structured history: the same jurisdiction × type, their cycles, and their correction categories.
- **Vector search** is deferred until there are ~200+ correction items. It needs `CREATE EXTENSION vector` on the shared Postgres cluster (one cluster for the fleet; see the connection-ceiling memory), plus an embeddings provider: Anthropic has no embeddings endpoint, so that is a separate vendor decision. Full text (`tsvector`) on lesson and item text covers "find similar wording" until then.
- **Effectiveness:** `metrics.ts` computes the **repeat-correction rate** per jurisdiction × category — the share of cycles whose notice contains an item matching an APPROVED lesson that preflight showed — before and after each lesson's approval date. It is shown on the admin Knowledge page.

---

## 10. Tasks and communication (Phase 9)

| Trigger | Task (sourceKey) | Owner | Settled by |
|---|---|---|---|
| Requirement document missing (preflight) | `preflight:<permit>:<code>` | coordinator | the document added / the next run passing |
| Signature or notarisation needed | `preflight:<permit>:signature.<field>` | coordinator | a person ticking it |
| Correction item (KNU) | `permit-correction:<item>` | coordinator | item RESOLVED / WAIVED |
| Correction item (architect, engineer, owner, sub) | `permit-correction:<item>` "Get … from …" | coordinator | revised file linked + item resolved |
| Corrections received | `permit:<id>:corrections@<cycle>` (HIGH) | PM | notice confirmed |
| Resubmission due | `permit:<id>:resubmit@<cycle>` | coordinator | submission frozen |
| In review too long | existing `waiting-7` / `waiting-14` (now per `reviewDaysTarget`, counted from the latest cycle) | coordinator / PM | issued / corrections |
| Inspection to schedule (permit issued, no inspection booked after n days) | `permit:<id>:schedule-inspection` | superintendent | inspection created |
| Permit expiring | existing `expiring` | PM | issued → final / renewed |
| Final closeout (final passed, closeout docs not on file) | `permit:<id>:closeout` | coordinator | `closeout` document added |

All go through `createTask` with `permitId` + `jobId`, appear on the calendar and in digests, and use existing assignment and notification.

**Drafts:**
- `PermitMessage` drafts to architects, engineers, subcontractors, owners and municipal staff (recipients from parties, `Organization` / `Contact`, or typed).
- Each carries the permit / application number, address, the correction items, the requested actions and the deadline.
- **Sent only by a person clicking Send** (decision 4 sets who may). Mail goes from the company sender with **reply-to the sender**, as nurture does. It is recorded as a `Communication` on the job's lead (correspondence history) and in the permit timeline.
- Never auto-sent; there is no "authorized workflow" in the MVP.

---

## 11. Dashboard and permit pages (Phase 10)

**Permit Center (`/permits`)** keeps its status columns and the Inspections tab, and gains a metrics strip:
- **Active** — not FINAL, EXPIRED or DENIED.
- **Preparing** — PREPARING.
- **In review** — APPLIED with an open cycle.
- **Corrections** — CORRECTIONS.
- **Waiting on others** — permits with an item WAITING_THIRD_PARTY.
- **Approved this month** — ISSUED with the date this month.
- **Average days to approval** — first `submittedAt` → `approvedDate`, over the last 12 months.
- **First-submission approval rate** — cycle 1 outcome APPROVED ÷ cycles 1 decided.
- **Average correction cycles** — over issued permits.
- **At risk** — in review past the target, a resubmission overdue, expiring within 30 days, or an item past due.

Every tile opens its list (the attention-row rule: one `where` for count and list). New attention rows: `permit-corrections`, `permit-resubmit-due`.

**Permit detail (`/permits/[id]`)** — header: status pill, jurisdiction, type, application number, permit number, assignee, job link, cycle. Tabs:
- **Overview** — timeline of cycles, submissions, status changes and key dates; next action.
- **Documents** — grouped by doc type; the requirement checklist with ✓ / missing; upload, classify suggestion, versions.
- **Parties.**
- **Forms** (Stage 3) — templates for this jurisdiction × type; fill and review; download.
- **Products** (Stage 4).
- **Preflight** (Stage 5).
- **Corrections** — notices, the items table, the response letter.
- **Submissions** — frozen packages, download, manifest.
- **Tasks** — `EntityTaskPanel` filtered by `permitId`.
- **Inspections** — the existing `PermitInspections`.
- **Messages** — drafts and sent.
- **History** — audit + activity.

The job's Permits tab keeps its editor and adds an "Open permit" link per permit. Admin → **Permits**: Jurisdictions · Permit types · Requirements · Form templates · Knowledge · AI usage.

Phone width: the tabs scroll, the item review stacks image over fields, and every grid child gets `min-w-0` (lesson from earlier stages).

**Municipal integration strategy:** manual status entry first. Email updates come second (Stage 2b, the inbound route). Portal adapters later, behind an interface (`PermitPortalAdapter { fetchStatus(applicationNumber) }`), one jurisdiction at a time, only where an API or the site's terms allow it. Automated submission is out of scope.

---

## 12. Security and quality (Phase 11)

- **Roles** (`permit-intel/access.ts`, explicit lists, never `hasMinRole`):
  - read: production-view roles, own-only roles limited to their jobs through `guardJob` on the permit's job;
  - write: `canWriteProduction`;
  - approve (send a message, freeze a submission, finalise a form, publish a template, confirm a correction notice): ADMIN / MANAGER / OFFICE_STAFF + the permit's coordinator *(decision 4)*;
  - knowledge and jurisdiction admin: ADMIN / MANAGER;
  - preflight override: ADMIN / MANAGER.
- **Private documents:** every byte goes through `/api/files/[id]` with `fileReadWhere` extended to permit files; vault RESTRICTED rules are unchanged; package downloads are audited (as the prequal package is).
- **Credentials:** `ANTHROPIC_API_KEY` only in `/etc/knuco/env`, read through `env.ts`, never logged, never sent to the client.
- **Prompt injection:**
  - Document text goes into a fenced `<document source="…">` block, with a system rule that its contents are data and instructions inside it are to be ignored.
  - Outputs are schema-only (no free-form actions), and the model has no tools.
  - Every output is a proposal a person confirms.
  - A field mapping never contains a value, so a document cannot plant a licence number.
- **Structured output:** zod schemas via `betaZodOutputFormat`; a schema mismatch is a FAILED `AiCall`, never a partial write.
- **Provenance:** every AI-proposed row stores `aiCallId`, `confidence`, `sourcePage` / `sourceQuote`. Accept and reject are audited (`ai_proposal_*`).
- **Data minimisation:**
  - form mapping sends labels, no values;
  - preflight review sends a summary;
  - correction extraction sends the letter (which contains the address — necessary) and party *names*;
  - owner phone, email and any SSN-bearing field are never sent.
- **Versioning:** templates, fills, submissions and approvals are versioned and immutable once final.
- **Retries and cost:**
  - SDK `maxRetries: 2`, 120 s timeout;
  - the queue step retries up to 3 times;
  - input-hash cache (the same document is never paid for twice);
  - a cap per subject (`AI_MAX_USD_PER_SUBJECT`, default 5) and a monthly cap (`AI_MONTHLY_MAX_USD`, default 100);
  - Admin → AI usage shows cost by purpose and month.
- **Evaluation:** `scripts/eval-permit-ai.ts` runs each prompt over a git-ignored fixtures folder (`permit-fixtures/`: real letters, NOAs, forms with expected outputs written by a person). It reports item recall and precision, category accuracy, and field-map accuracy, and is run before any prompt-version bump.

---

## 13. Prompt architecture and models

| Purpose | Model | Effort | Input | Output schema |
|---|---|---|---|---|
| `file_classify` v1 | Haiku 5.5 | low | first ~3 pages of text (or page 1 image) | `{docType, confidence, title, sheetNumbers[], sealedLikely, expiresAt?}` |
| `doc_facts` v1 | Opus 5.5 | medium | cover / data sheets as text + images | `[{key, value, page, quote, confidence}]` over dictionary keys |
| `correction_extract` v1 | Opus 5.5 | high | letter text / page images + party names + sheet list | `{items:[…PermitCorrectionItem fields, page, quote, confidence]}` |
| `correction_email` v1 | Sonnet 5.5 | medium | items, numbers, address, deadline, sender | `{subject, body}` |
| `form_map` v1 | Opus 5.5 | high | field inventory with labels + dictionary | `[{fieldName, dataKey, transform, confidence, rationale}]` |
| `approval_extract` v1 | Opus 5.5 | high | approval PDF text + images | `ProductApproval` fields with page / quote |
| `preflight_review` v1 | Opus 5.5 | medium | package summary + lessons | `[{message, evidenceRefs[], suggestion}]` |
| `lesson_generalise` v1 | Haiku 5.5 | low | grouped items | `{title, body, suggestedCheck?}` |

Model ids and prices are confirmed against the API reference when Stage 0 is built. Prompts live in `permit-intel/prompts/*.ts` with a `PROMPT_VERSION` each; the version is part of the cache hash.

---

## 14. Endpoints (new)

**Stage 0:**
- `GET /api/admin/ai-usage`

**Stage 1:**
- `GET /api/permits/[id]` (detail)
- `POST /api/jobs/[id]/permits` (exists; takes the new fields)
- `GET|POST /api/permits/[id]/parties`, `PATCH|DELETE /api/permit-parties/[id]`
- `GET|POST /api/permits/[id]/cycles`, `PATCH /api/permit-cycles/[id]`
- `GET|POST /api/permits/[id]/submissions` (POST freezes), `GET /api/permit-submissions/[id]/download`
- `GET /api/permits/[id]/files`; `POST /api/files` takes `permitId` + `permitDocType`
- `GET|POST /api/jurisdictions`, `PATCH /api/jurisdictions/[id]`
- `GET|POST /api/permit-types`
- `GET|POST /api/permit-knowledge`, `PATCH /api/permit-knowledge/[id]`
- `GET /api/permits/library`

**Stage 2:**
- `POST /api/permits/[id]/correction-notices` (upload / paste → queued), `GET /api/correction-notices/[id]`, `POST /api/correction-notices/[id]/confirm`
- `PATCH /api/correction-items/[id]`, `POST /api/correction-items/[id]/files`
- `POST /api/permits/[id]/messages` (draft, optional `ai: true`), `PATCH /api/permit-messages/[id]`, `POST /api/permit-messages/[id]/send`
- `POST /api/permits/[id]/response-letter`
- `POST /api/files/[id]/classify`
- `GET /api/plan-jobs/[id]` (status, reused)

**Stage 3:**
- `POST /api/permit-forms` (upload blank), `GET /api/permit-forms/[id]`, `POST /api/permit-forms/[id]/map` (AI), `PATCH /api/permit-forms/[id]/fields`, `POST /api/permit-forms/[id]/publish`
- `POST /api/permits/[id]/form-fills`, `PATCH /api/form-fills/[id]`, `POST /api/form-fills/[id]/finalize`

**Stage 4:**
- `GET|POST /api/product-approvals`, `GET|PATCH /api/product-approvals/[id]`, `POST /api/product-approvals/[id]/extract`
- `GET|POST /api/permits/[id]/products`, `DELETE /api/permit-products/[id]`
- cron `product-approval-alerts`

**Stage 5:**
- `POST /api/permits/[id]/preflight` (`?ai=1`), `GET /api/permits/[id]/preflight/latest`, `POST /api/permits/[id]/ready` (override reason)

**Stage 6:**
- `GET /api/permits/metrics`
- `POST /api/permit-knowledge/[id]/decide`

Every route: `requireSession` → a guard from `permit-intel/access.ts` + `guardJob` on the permit's job → `validateBody` (zod) → service → audit. Rate limits on the AI-starting routes.

---

## 15. Frontend

- **Pages:** `/permits/[id]`, `/permits/library`, `/permits/products`, `/permits/products/[id]`, `/admin/permits` (tabs).
- **Components:** `components/permit-intel/*`:
  - permit header and tabs; requirement checklist; doc-type upload with classify chip;
  - parties editor; cycle timeline; submission freeze dialog (preflight summary, manifest preview, method, confirmation ref);
  - correction review table (page image + fields, merge / split); message editor (to / cc from parties, send confirm);
  - form mapping canvas (page PNG + field rects + key picker); fill review (status per field, source link, conflict picker);
  - approval verify view (PDF beside the fields); product picker with the compatibility flags;
  - preflight report; knowledge admin table; metrics strip.
- Reuses: `FilePreviewDialog`, `EntityTaskPanel`, `ConfirmDialog`, `useSearchParamState`, `fetchJson`, `StagePill`-style status pills, the plan viewer's page renderer for page images.

---

## 16. Phased roadmap and effort

A "session" is one build + dev QA day, as in previous plans.

| Stage | Contents | Migration | Depends on | Effort |
|---|---|---|---|---|
| **0** | `src/lib/ai` (client, calls, hash, pricing, untrusted framing, caps), `AiCall`, Admin → AI usage; takeoff M3 switched to it before M3 deploys. **Built 2026-10-18** (the queue change moved to Stage 2) | yes | — | 1 |
| **1** | Jurisdictions, permit types, requirements, parties, cycles, statuses PREPARING / CORRECTIONS, `File.permitId` / `permitDocType`, `Task.permitId`, `/permits/[id]`, frozen submissions, sniffing, backfill of the 3 permits, admin pages. **Built 2026-10-18** (the Permit Library moved to Stage 2 with full-text search; per-file sha256 lives in the submission manifest) | yes | — | 2 |
| **2** | Queue generalised (subject on `PlanJob`); Permit Library; correction notices and items (AI extract + confirm), item tasks, resubmission task, drafts + send, response letter, resubmission, outcomes, file classify, full text; 2b: email intake with attachments | yes | 0 | 2 (+1 for 2b) |
| **3** | pdf-lib inventory, data dictionary, AI mapping, template publish, deterministic fill, review, finalise; `Lead.parcelNumber`; document facts | yes | 0, 1, sample forms | 2 |
| **4** | Product approvals, extraction, verify view, links, expiry cron, compatibility check | yes | 0 | 1–2 |
| **5** | Preflight engine, AI review, report PDF, ready gate, workflow held fact | yes (one table) | 1 (better with 3, 4) | 1 |
| **6** | Lessons, admin decisions, retrieval at preflight, metrics strip and attention rows, effectiveness | no | 2, 5 | 1 |

**MVP = Stages 0–6**, about 10–11 sessions. **Deferred:** automated portal submission, online approval verification, vector search, prediction of approval times, AV scanning, flat (non-fillable) forms, DOCX reading.

---

## 17. Testing and acceptance

- **Pure modules** with vitest:
  - `doc-types`, `requirements` (jurisdiction / type fallbacks, effective dates);
  - `data-dictionary` (every key resolves; protected keys never resolve from a document fact);
  - `field-fill` (missing / conflict / sign-by-hand, transforms);
  - `correction-schema` (mapping AI output to rows);
  - `approval-check` (each flag);
  - `preflight` (each rule, score, override);
  - `lessons` (grouping, generalisation input stripped of PII);
  - `metrics` (each tile on fixture permits);
  - `sniff` (magic bytes).
- **The AI layer:** cache hit, cap per subject and per month, refusal, max_tokens, schema mismatch, untrusted framing — with a mocked client.
- **Dev QA per stage:** API scripts plus headless Chromium at 1280 and 400 px. Role matrix: SALES_REP sees and edits only their jobs' permits, gets 403 on approvals; READ_ONLY reads; CREW_LEAD none.
- **Stage acceptance:**
  1. A permit with jurisdiction, parties and documents; requirement checklist ✓ / missing; freeze a package (sha256 matches a re-hash of the zip; the files can no longer be deleted); the 3 prod permits backfilled.
  2. A real correction letter → items match a person's reading (eval recall ≥ 90 % on the fixtures); confirm → tasks; draft → send to a test address; response letter; resubmission opens cycle 2.
  3. A real municipal application (fillable) → template → fill for a real permit; every protected field is from records or blank; the output opens in Acrobat with the layout unchanged.
  4. A real NOA → fields match the document; the HVHZ and pressure flags fire on fixtures.
  5. Preflight on the Stage 3 permit lists the expected blockers; ready gate refuses, then the override works.
  6. A closed cycle proposes a lesson; approving it shows it at preflight on another permit of the same jurisdiction × type.
- Gate every stage: typecheck clean, lint ≤ baseline, tests, build (in a shell that has not sourced `.env`).

---

## 18. Risks

| Risk | Mitigation |
|---|---|
| No prod AI key | Stage 1 is AI-free; AI routes answer 503 "AI is not set up" and the manual paths still work. |
| Scanned letters (no OCR) | Page images to the model; cost logged; the cap per subject. |
| XFA or flat municipal forms | Detected and refused with a message; flat-form overlay is a later stage. |
| A municipality changes its form | A new sha256 means a new template version; old fills keep theirs. |
| Model misreads an item or a field | Everything is a proposal with page and quote; a person confirms; evals before prompt changes. |
| Liability of "compatibility" or "readiness" | Fixed labels: advisory, not engineering; a score, not a prediction; sealed documents never touched. |
| Approval site terms | No automated lookup until checked. |
| takeoff-m3 has its own `PlanAiCall` | M3 is not on prod: Stage 0 lands `AiCall`, and M3's migration is changed to use it before M3 deploys (coordinate with that branch). |
| Shared Postgres cluster | No new extension in the MVP; GIN full-text only. |
| Concurrent sessions in the checkout | Each stage on its own branch / worktree; explicit-path staging. |

---

## 19. Decisions for Richard

1. **Prod AI key and models.** Set `ANTHROPIC_API_KEY` on prod. Models as in §13 (Opus 5.5 for reading letters, forms and approvals; Haiku 5.5 for classification). Caps: $5 per subject, $100 a month.
2. **Order.** Corrections (Stage 2) before forms (Stage 3) — recommended.
3. **Samples.** 2–3 blank applications (Palm Beach, Boynton Beach, Miami) and any correction letters KNU has received, plus one NOA and one FL PA, to put in `permit-fixtures/`.
4. **Who approves.** **Ruled 2026-10-18 for drafted emails:** anyone involved with the job (the "My jobs" rule, `jobsInvolvingUserWhere`) may approve sending one. Still proposed for freezing a submission, finalising a form, publishing a template and confirming a notice: ADMIN / MANAGER / OFFICE_STAFF + the permit's coordinator.
5. **No vector search in the MVP.**
6. ~~"City of Palm Beach"~~ — **ruled 2026-10-18:** the jurisdiction is named "City of Palm Beach".
7. ~~Statuses~~ — **ruled 2026-10-18:** `PREPARING` and `CORRECTIONS` approved.
8. **Sending.** Mail goes from the company sender with reply-to the person — the nurture pattern — rather than through the person's own mailbox.
9. **Online verification.** FL PA / NOA online verification is deferred until each site's terms are read.
10. **Antivirus.** Deferred (ClamAV needs ~1 GB RAM on the shared droplet); magic-byte checks meanwhile.
