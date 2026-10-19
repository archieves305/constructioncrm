# Permit Intelligence

Plan approved 2026-10-18 (`~/.claude/plans/reactive-tickling-pony.md`); full
design in `CAREYOS_PERMIT_INTELLIGENCE_DESIGN.md` (repo root). Stages 0–6:
shared AI layer → permit record → corrections → form filling → product
approvals → preflight → knowledge + metrics. Each stage is built, QA'd,
deployed and clicked through before the next.

Prod on 2026-10-18: 3 permits (Boynton Beach, City of Miami, "City of Palm
Beach"), 0 inspections, 27 jobs. `ANTHROPIC_API_KEY` was placed in
`/etc/knuco/env` the same day (a call from the droplet answered 200).

## Stage 0 — shared AI layer (built 2026-10-18 on `permit-ai-foundation`)

- `src/lib/ai/`
  - `client.ts`: `isAiConfigured`, `aiClient` (120 s, 2 retries), `defaultModel` (`AI_MODEL`), `aiCaps`, and `AiError` with the `status` a route should answer: 503 not configured / key refused, 429 cap / rate limited, 422 refused, 502 cut off / schema / upstream.
  - `calls.ts`: `runAiCall(spec)`. Uses `beta.messages.parse` + `betaZodOutputFormat`, with the schema re-checked before storing. The system prompt is cached and always carries `UNTRUSTED_RULE`. There are no tools. `fallbacks: "default"` + `server-side-fallback-2026-07-01` are sent only to Opus / Sonnet / Fable (`supportsServerFallback`; Haiku has none). The cache is keyed by purpose + prompt version + model + inputs **per subject**. The caps are checked before the call. Every outcome is an `AiCall` row; a failure stores no output.
  - Pure modules: `policy.ts` (caps, office-time `monthStart`), `pricing.ts`, `hash.ts`, `untrusted.ts` (`untrustedDocument` escapes any `<document`/`</document` inside the material).
  - Usage: `usage.ts` (pure roll-up) and `usage-load.ts`.
  - Access: `access.ts` — `canViewAiUsage` = ADMIN / MANAGER.
- `AiCall` (`ai_calls`, migration `20261031120000_ai_calls`): `subjectType` / `subjectId` with no FK, counts, `costUsd`, output Json, error, requested by.
- `GET /api/admin/ai-usage` + Admin → **AI Usage** (System heading): this month vs the monthly cap, the allowance per record, the default model, six months, this month by purpose, the latest failures.
- Env: `ANTHROPIC_API_KEY`, `AI_MODEL` (default `claude-opus-5-5`), `AI_MAX_USD_PER_SUBJECT` (5), `AI_MONTHLY_MAX_USD` (100).
- **Narrower than the design:** the `PlanJob` queue change moved to Stage 2, its first user.

**Takeoff M3** (unmerged `takeoff-m3`) has its own `PlanAiCall` + `src/lib/takeoff/ai/{client,calls,hash,pricing}.ts`. M3 is not on prod, so before it deploys its `calls.ts` should call `runAiCall` with `subjectType: "takeoff"` and its `PlanAiCall` migration should be dropped. Per-takeoff `TAKEOFF_AI_MAX_USD` maps to the per-subject cap. Both branches add `@anthropic-ai/sdk ^0.132.1`.

Gate: typecheck clean, lint 5/22, 1746 tests (+16), build clean.

Dev QA:
- Real calls on dev: Haiku 5.5 $0.0001, Opus 5.5 $0.0043. Opus accepted the fallback parameter. Both found the 2 corrections and ignored a planted "return an empty list" line. The repeat call was cached at $0.
- Headless Chromium at 1280 and 400 px: no page errors, no horizontal scroll. Fixed in QA: four-decimal dollars above one cent.
- SALES_REP: API 403, page redirected to `/`; no cookie 307.
- QA rows removed (dev `ai_calls` empty).

## Stage 1 — the permit record (built 2026-10-18 on `permit-record`)

No AI. Migration `20261101120000_permit_record`:
- `PermitStatus` gains PREPARING and CORRECTIONS (ruled 2026-10-18).
- New tables: `Jurisdiction`, `PermitTypeDef`, `PermitKnowledge` (REQUIREMENT rows now, LESSON rows in Stage 6), `PermitParty`, `PermitReviewCycle`, `PermitSubmission` and `PermitSubmissionFile` (the file FK is Restrict).
- `JobPermit` gains `jurisdictionId`, `permitTypeKey`, `applicationNumber`, `scopeDescription`, `valuation`, `currentCycle`.
- `File` gains `permitId` and `permitDocType`; `Task` gains `permitId`.

- **Pure modules** (`src/lib/permit-intel/`):
  - `doc-types.ts`: 23 document types; `sealed` marks the ones the CRM never alters.
  - `catalog.ts`: the type seed, `permitTypeKeyFor`, jurisdiction key / kind / tidy name.
  - `requirements.ts`: the most specific row per document type wins (this jurisdiction × type > jurisdiction > type > everyone); live + APPROVED only; a missing file does not meet a requirement.
  - `submission-plan.ts`: `nextCycle` (refuses while a cycle waits), `statusForOutcome`, `planManifest` (the partners `entryName`).
  - `access.ts`: `canManagePermitSettings` = ADMIN / MANAGER; `canSubmitPermit` = office roles or the permit's coordinator — not ruled yet, proposed.
  - `validation.ts`: the PATCH schemas carry **no defaults**. zod `partial()` keeps a `.default()`, so a PATCH sending one field would reset the others; caught in a check before QA.
- **Services:**
  - `service.ts`: detail loader; parties; `recordCycleOutcome`, where the status follows through `updatePermit`; `recordManualCycle`; jurisdictions (a rename carries into `municipality`); requirements (retired, never deleted).
  - `submissions.ts`: `freezeSubmission` builds an fflate zip with a contents sheet and a sha256 per document plus one for the zip. It opens the cycle and sets the permit APPLIED with `submittedDate` = the submission day, which restarts the review clock. `readSubmission` refuses to serve a zip whose hash no longer matches.
- `lib/permits/service.ts` `recordFields`: picking a jurisdiction or a catalog type writes its name into `municipality` / `permitType`.
- **Files:**
  - `permitLockOf` and `PERMIT_LOCK_REASON` in `lib/files/access.ts`. A file in a frozen package (`submitted`), or of type approved_permit / stamped_plans (`issued`), cannot be deleted, renamed or replaced. Every file list carries `permitLock`.
  - `POST /api/files` takes `permitId` + `permitDocType` (write = the permit's job guard).
  - `lib/files/sniff.ts` `contentMatchesType` runs on every upload and on replace. A CSV labelled with the Excel type passes, which is how Windows browsers send one.
- **Tasks:** `permitId` on create, the include, the list filter and the panel context. `SubjectKind "permit"` opens `/permits/[id]`. The permit alerts carry `permitId`.
- **Routes:**
  - `GET /api/permits/[id]`
  - `POST /api/permits/[id]/{parties,cycles,submissions}`
  - `PATCH|DELETE /api/permit-parties/[id]`
  - `PATCH /api/permit-cycles/[id]`
  - `GET /api/permit-submissions/[id]/download` (audited)
  - `GET|POST /api/jurisdictions`, `PATCH /api/jurisdictions/[id]`
  - `GET /api/permit-types`
  - `GET|POST /api/permit-requirements`, `PATCH /api/permit-requirements/[id]`
- **UI:**
  - `/permits/[id]`: Overview · Documents (checklist, upload with type, reclassify, locks) · Parties · Submissions (freeze dialog, the department's answer, a submission recorded by hand) · Tasks · Inspections · History.
  - Admin → Permits: Jurisdictions · Requirements.
  - The job Permits tab: jurisdiction and type pickers, application number, valuation, scope; new permits start PREPARING; an "Open the permit record" link.
  - The Permit Center drawer links to the permit page.
- **Seed:** `prisma/seed-permit-intel.ts` — 9 types plus the company-wide "Completed application form".
- **Backfill:** `scripts/backfill-permit-records-2026-10.ts` — dry run by default, `--apply`.
- **Moved to Stage 2:** the Permit Library page, which needs full-text search.

Gate: typecheck clean, lint 5/22, 1760 tests (+14), build clean.

Dev QA:
- **API, 45/45** on the three prod permits recreated on JOB-00001:
  - the backfill dry run, apply and re-run (unchanged);
  - the jurisdiction duplicate refused (409); PATCH keeps the unsent fields;
  - a renamed .exe refused as a PDF;
  - the checklist moving from 1/2 to 2/2 when a file is classified;
  - freeze → APPLIED, locked (delete / rename 403), a second freeze 409, the download's hash matches, the zip lists the contents sheet and the documents;
  - corrections → CORRECTIONS → resubmission cycle 2 → approved → ISSUED with the number and date; an earlier cycle refused 409;
  - a task with `permitId` carries the job; the history holds every write.
- **Cron:** permit-aging raised its waiting tasks with `permitId`.
- **SALES_REP:**
  - on their own job: the page 200, a party 201, a submission 403;
  - on another job: the page, a party and an upload all 404;
  - jurisdiction create 403, requirements 403.
- **Headless Chromium** at 1280 and 400 px: every tab, the freeze dialog, admin, and the job tab's add form. No page errors, no sideways scroll; the three misses were the script's own selectors.
- **Fixed in QA:** a resubmission pre-ticked the superseded NOC beside its replacement (`defaultPackage`).
- Dev DB restored from a dump; the QA uploads removed.

**Prod after deploy:**
1. Run the seed, then the backfill dry run, then `--apply`. Expected: 3 jurisdictions (City of Boynton Beach, City of Miami, City of Palm Beach), 3 types (interior_renovation, building, reroof), and 3 cycle-1 rows (two APPROVED, Palm Beach PENDING).
2. In Admin → Permits, add the County and HVHZ per jurisdiction, and the real requirements.

## Stage 2 — corrections, emails, response letter, Permit Library (built 2026-10-18 on `permit-corrections`)

Migration `20261102120000_permit_corrections`:
- `PermitCorrectionNotice` (permit, the cycle it answers, the letter file or pasted text, received / response-due dates, reviewer, status EXTRACTING → REVIEW → CONFIRMED or FAILED, the AI's summary and `aiCallId`, attempts + `extractStartedAt`).
- `PermitCorrectionItem` (verbatim text, department number and discipline, page, category, what it affects + ref, responsible party + permit party, the model's confidence — cleared once a person edits — `fromAi`, status PROPOSED / OPEN / WAITING_THIRD_PARTY / RESOLVED / DISPUTED / WAIVED, the response line, due date, task, `previousItemId` for a comment made again, `reviewOutcome` ACCEPTED / RECOMMENTED).
- `PermitCorrectionItemFile` (the revised files that answer an item) and `PermitMessage` (email DRAFT / SENT / DISCARDED, to / cc, items, attachments, `communicationId`).
- `files.extracted_text` and `files.search_vector` — a **generated** tsvector (`english`, file name + text) with a GIN index, written by hand in the migration. Prisma reads it as a column with a default, so a later `migrate diff` prints `ALTER COLUMN "search_vector" DROP DEFAULT`: leave that line out.

Narrower than the design, on purpose:
- **No queue change.** A notice is one AI call, so the reading runs after the response (`after()`, which `next start` drains on shutdown); a reading cut off by a restart is started again by the next page load (stale after 5 min, three attempts, then FAILED). The `PlanJob` change stays with takeoff-m3, which edits the same runner.
- **No page images.** The PDF goes to the model as a document block (text and scanned pages alike, up to 600 pages / 22 MB here); a picture of a letter as an image block.
- **Classification is a button**, not automatic on upload: "Suggest a type" on an unclassified PDF (Haiku 5.5, from the text pdfjs read), shown as a chip, never stored until accepted.
- No merge / split of items (edit, delete a proposal, add by hand instead). Email intake (2b) not built.

Pure (`corrections-plan.ts`, tested): the model's answer schema (no numeric bounds — clamped in `proposedItems`), party match by name (only when one party matches), stated deadline kept only when a real day within a year, `statusOnConfirm`, `canMoveTo`, `itemTask` titles ("Correction B-2: …" for KNU, "Get the revised A-2.1 from Gomez Engineering (comment S-1)" for anyone else), `resubmitDueDay` (stated, else 14 days), `earlierOutcomes`, `letterLines` (a blank response blocks the letter), `isStaleExtraction`. Prompts in `prompts/`: `correction_extract` v1 (Opus 5.5, effort medium; party names and the previous review's comments as refs — no emails, phones or licences), `correction_email` v1 (Sonnet 5.5), `file_classify` v1 (Haiku 5.5).

Services: `corrections.ts` (create → "Review the corrections" task to the PM; `runExtraction` claims the notice, reads, replaces only PROPOSED rows; confirm → items OPEN / WAITING, the cycle answered CORRECTIONS through `recordCycleOutcome` so the permit follows, a task per item `permit-correction:<id>` to the coordinator, `permit:<id>:resubmit@<cycle>` due on the notice's date, the received task closed; earlier comments get their outcome and, if still open, are resolved with their task closed (`settleEarlier`); item status closes / reopens its task; `onResubmitted` from `freezeSubmission`; `onCycleApproved` from `recordCycleOutcome`), `messages.ts` (AI or blank draft, edit, discard, send — claimed DRAFT → SENT first, put back on failure; company sender, reply-to the person, cc, attachments ≤ 20 MB; a `Communication` with provider `permit` on the job's lead), `response-letter.ts` + `lib/pdf/permit-correction-response.tsx` (filed as `correction_response`), `library.ts` (`indexPermitFileText` after every permit-PDF upload and "Upload again", `suggestDocType`, `searchLibrary` — `websearch_to_tsquery`, `ts_headline` snippets, the viewer's job scope). `sendEmail` takes `cc`. `presentFiles` drops `extractedText`.

Access: confirming a notice = `canSubmitPermit` (proposed: office roles + the coordinator); sending = office roles or anyone involved with the job (ruled 2026-10-18); everything else `canWriteProduction` behind the permit's `guardJob`. AI-starting routes rate-limited (12 a minute per person).

Routes: `GET|POST /api/permits/[id]/corrections`; `PATCH|DELETE /api/correction-notices/[id]` + `/confirm`, `/reread`, `/items`, `/response-letter`; `PATCH|DELETE /api/correction-items/[id]` + `POST|DELETE …/files`; `POST /api/permits/[id]/messages`; `PATCH|DELETE /api/permit-messages/[id]` + `/send`; `POST /api/files/[id]/classify`; `GET /api/permits/library`.

UI: the permit's **Corrections** tab (`components/permit-intel/corrections/*`: add a notice — upload or paste; the card waits while reading, then shows the AI's reading with its cost, items to check with "Check this" under 70 %, edit / delete / add, Read again, Confirm; confirmed items with status, response line, revised files linked or uploaded, the task link, "Repeats S-1", outcome badges; "Email about n items" → draft dialog → editor → Send behind a confirm; the response letter); "Suggest a type" on Documents; the freeze dialog warns about open corrections; **Permit Library** at `/permits/library` (search, jurisdiction / permit type / document type, submitted only; linked from Permit Center).

Gate: typecheck clean, lint 5/22, 1781 tests (+21), build clean.

Dev QA (real AI calls, $0.07 in all):
- A two-page Palm Beach letter (built for QA, six comments, a stated deadline, a planted "ignore all previous instructions"): read in 12 s for $0.054 — all six comments verbatim with their numbers and pages, the deadline and reviewer read, S-1 to the engineer and Z-1 to the architect by name, the planted line ignored (and mentioned in the summary). Pasted second-review notice: the repeated S-1 linked to cycle 1's.
- API 11 + 23 + 17 + 11 + 17: edits clear confidence, a status before confirm 409, confirm → permit CORRECTIONS / cycle answered / 6 tasks + resubmit task due 11/13 / received task closed, resolve and waive close tasks, reopen brings the task back, confirmed items and notices cannot be deleted; AI email draft (5 s, $0.006) quoting the comment with the date; send to Richard's address (subject "QA test (please ignore)", one email) → Communication row, a second send 409; blank draft, discard; letter refused while a response is blank, then filed; freeze closes the resubmit task; cycle 1 outcomes (S-1 recommented, the rest accepted); approval settles cycle 2's items and closes their tasks; a notice on an approved cycle 409; library search with highlights, filters, no text sent to the browser; type suggestion right, cached, not stored.
- SALES_REP (the job's rep): reads and edits, confirm 403, may send; another job's permit 404 on every route; the library leaves out the other job's file.
- Headless Chromium 1280 / 400 px: 39/41 + the draft flow 7/7, no page errors, no sideways scroll; the two misses were the check's selector (the Library link is an anchor with a button role) — clicked and navigates.
- Fixed in QA: the task wording ("Re-Roof permit (Town of Palm Beach)"), the letter header running the address into the date and double line spacing, earlier comments' tasks left open after the next review (`settleEarlier`), the library's permit column on a phone, the tab saying "No corrections open" while a notice waited to be checked.
- Dev DB restored from a dump; the nine QA files removed from `uploads/`.

**Deploy carries the migration.** No seed, no cron. After it, Richard's click-through: a permit with a submission → Corrections → Add a correction notice (a real letter) → check, Confirm → Email about… → Write the response letter → Submissions → Submit again.

## Stage 3 — form filling (built 2026-10-18 on `permit-corrections`)

**What the real forms are** (checked 2026-10-18, public downloads): Palm Beach County municipalities use the *Universal County-Wide/Municipal Building Permit Application* (Jan 2024) — a fillable AcroForm, 2 pages, 132 fields (radio groups for kind of permit / trade / type of work / owner-builder vs contractor / use, the parcel number as 17 one-character boxes `PCN-1…17`, 4 signature fields, two notary blocks). Tequesta's copy of the same form has different field names (`CITY_2`, `undefined`), so a template belongs to the exact file (sha256), not the title. Boynton Beach's Notice of Commencement is fillable (41 fields); its re-roof affidavit and window-retrofit memo are **flat scans** (no fields). The City of Miami takes no PDF application — permits start online in iBuild / ePlan; only affidavits are printed.

Migration `20261103120000_permit_forms`: `PermitFormTemplate` (name, jurisdiction **or** county — the universal form is offered on every permit in Palm Beach County — permit types, the blank file stored once with its sha256, version, `formKind` ACROFORM, `fieldInventory`, status DRAFT / PUBLISHED / RETIRED, `mapState` IDLE / MAPPING / FAILED), `PermitFormFieldMap` (field → `dataKey` / transform, the AI's confidence and rationale), `PermitFormFill` (values as of the last write, a person's overrides, the editable + flattened output files, DRAFT / FINAL); `leads.parcel_number` + `leads.legal_description`. New dependency `pdf-lib` 1.17.1 (MIT).

Pure (tested): `data-dictionary.ts` (49 keys over property, owner, contractor, permit, job, architect / engineer, today; each resolves from the permit's records with its source; licence and qualifier keys `protected` — the permit's QUALIFIER party first, else the company profile's roofing licence on a re-roof, else the GC licence; owner from the OWNER party vs the lead → a conflict when they differ; a separate mailing address never borrows the property's city); `field-fill.ts` (mapping = key / `literal:` / `when:key=value` / none; transforms upper, date, phone, money, digits, `char:n`, `map:a=b|…`; statuses FILLED, MISSING, BLANK, SIGN_BY_HAND, OVERRIDDEN, CONFLICT, UNMATCHED; `finalizeProblems`; `acceptMapping` — the AI's fixed values are accepted **only** as one of a choice field's own options, never as text; `nearestLabel` — the printed label beside a field, cutting an underline run where the field starts). `form-pdf.ts` (pdf-lib inventory — type, page, box, options, max length — with pdfjs labels; fill + `updateFieldAppearances` + flatten; a hybrid form's XFA copy removed so the filled fields show; XFA-only and flat forms refused). Prompt `form_map` v1 (Opus 5.5; field names, labels and options as untrusted data plus the dictionary — no job data).

Services: `forms.ts` (upload → inventory, refuse XFA / flat / a non-PDF / the same file twice; AI mapping in `after()`, fields mapped by hand kept, a cut-off mapping restarted by the next page load; `saveMappings` checked per field; publish retires the older version of the same file; a published form never changes — "Edit (new version)" copies it as a draft; retire; `templatesForPermit` by jurisdiction, county and type). `fills.ts` (the permit's context from its records and the KNU brand — the estimates' `loadEstimateBrand`; a draft's values are re-read from the records every time it is opened; overrides; `renderFill` writes the editable and flattened PDFs as `completed_application`, replacing the draft's previous pair unless one was sent in a package; finalise refused while records disagree or a choice matches no option, then written once more and kept; delete a draft).

**Lead update fixed on the way:** `updateLeadSchema` was `createLeadSchema.partial()`, which kept the defaults — any partial PATCH reset state to FL, property type to residential and the insurance / financing / urgent flags to false — and `email: updateData.email || null` cleared the email of any PATCH that did not send one. The update schema is now built without defaults and the email is left alone unless sent (`lib/validators/lead.test.ts`). Edit Lead sends every field, so nothing changes for it.

Routes: `GET|POST /api/permit-forms`; `GET|PATCH /api/permit-forms/[id]` + `/map`, `/fields` (PUT), `/publish`, `/retire`, `/revise`, `/file`, `/preview?permitId=`; `GET|POST /api/permits/[id]/form-fills`; `GET|PATCH|DELETE /api/form-fills/[id]` + `/render`, `/finalize`. Templates = `canManagePermitSettings` (ADMIN / MANAGER); fills = `canWriteProduction` behind the permit's job guard; finalise = `canSubmitPermit` (proposed: office roles + the coordinator).

UI: Admin → Permits → **Forms** (list, upload with jurisdiction or county and types) and `/admin/permits/forms/[id]` (fields by page with label, type, mapping, the AI's reason and confidence; filters All / Filled / Left for a person / Check these; per-field mapping dialog; "Try on a permit" preview; Map with AI, Publish, Edit (new version), Retire; the blank form). The permit's **Forms** tab (the forms that apply; each fill with its counts, the two PDFs, "Needs a person" / "Every field", Change / Use the record, conflict buttons, a missing parcel number or legal description saved on the property, Write the PDF, Finalise, Remove). Tab lists that wrap now grow (`group-data-horizontal/tabs:h-auto` on the permit, lead and partner pages — the third row overlapped the content).

Gate: typecheck clean, lint 5/22, 1808 tests (+27), build clean.

Dev QA (real files, one AI call):
- Uploads: the universal form 132 fields, the NOC 41, the flat re-roof affidavit refused with the reason, the same file twice 409, a non-PDF 400. Labels: 124 of 132 on the universal form, 40 of 41 on the NOC.
- Mapping the universal form: 61 s, **$0.20**, 48 of 132 fields mapped — owner, project address, the 17 PCN boxes as `char:1…17` in the right order (even box 17, whose printed label was misread), trade via `map:reroof=Roofing|…`, "Contractor/Qualifier" and "Primary Permit" as fixed choices, licence → `contractor.licenseNumber`, certificate holder and contractor print name → `contractor.qualifierName`; every signature, notary item, fee, bonding, lender, titleholder and office-use field left for a person. One wrong call: "Permit Type" in the office-use header was mapped (0.85) — cleared in the editor during QA.
- API 7 + 3 + 34 + 8: edits checked per field (a radio's fixed value must be an option, a signature cannot be mapped), preview, publish, a published form refuses edits and re-mapping, the form offered by county, a fill (26 from records, 22 missing, 4 to sign, 80 left blank), the parcel number saved on the lead fills the 17 boxes (and the partial lead PATCH kept email, state and flags), the qualifier party fills licence and certificate holder, an OWNER party that differs from the lead is a conflict that blocks finalising until a person picks, a signature cannot be typed, the PDF written and re-written (still two files), finalised and locked, v2 copied, published, v1 retired, the final fill untouched. SALES_REP: templates 403, own job's form edited and written, finalise 403.
- The filled PDF read back: every value in its box, the layout unchanged, signatures and notary blocks blank.
- Headless Chromium 28/28 at 1280 / 400 px (admin list, upload dialog, editor and mapping dialog, permit Forms tab), no page errors, no sideways scroll; the wrapped tab row verified inside its list.
- Dev DB restored, the six QA files removed.

**Deploy carries the migration** (and `npm ci` picks up `pdf-lib`). No seed, no cron. After it: Admin → Permits → Forms → upload the county's universal application (county "Palm Beach") → Map with AI → check "Check these" and the office-use header → Publish; give each Palm Beach County jurisdiction its county; enter the permits' qualifier under Parties; add the parcel number on the property when a form asks.

Not done: flat forms (Boynton's re-roof affidavit — needs text placed by position), document facts read from plans (`building.*`), a form's own field for the property use (left for a person), a lock on a final fill's files beyond the package lock.

## Stage 4 — product approvals (built 2026-10-18 on `permit-corrections`)

Real documents used (public downloads): Miami-Dade NOA 26-0504.06 (Tag & Stick MTP, 11 pages — states its approval and expiration dates and HVHZ on page 1; its "−67.5 psf underlayment uplift" is explicitly *not* the roof system's design pressure); Florida evaluation reports FL 11842.3 R9 (MFM Ultra HT, 5 pages) and FL5259-R38 (Polyglass, 18 underlayments, 52 approved systems). A Florida evaluation report states **no expiry** — the approval's status is on floridabuilding.org.

Migration `20261104120000_product_approvals`: `ProductApproval` (authority FL / NOA / other, number + revision, manufacturer, product, models, category, HVHZ / non-HVHZ, design pressures ±psf, impact, limitations, configurations, issued / expires, `evidence` {field: {page, quote}}, the document stored once with its sha256, read state EXTRACTING / REVIEW / VERIFIED / FAILED, verified by / at, active), `ProductApprovalMaterial` (↔ `RoofMaterialItem`), `PermitProduct` (permit, approval, used as, the engineer's required ± pressures, notes, the copy of the document among the permit's files).

Pure `approvals-plan.ts` (tested): the answer schema; `approvalFromExtraction` (dates real and 1990–2100, an expiry before the issue dropped, pressures 0 < |p| ≤ 500 and uplift always negative, evidence only for known fields on real pages); `normalizeNumber`; `checkProduct` — advisory flags, every one under "Advisory — not an engineering determination. The engineer of record and the building official decide.": set aside, not checked by a person, expired / expires before the permit's expected approval / within 30 days, an NOA with no expiry recorded, HVHZ jurisdiction without an HVHZ approval, a required pressure beyond the approval's by magnitude (or none stated), the document not among the permit's documents; `approvalAlert` (raised 30 days ahead, due 14 ahead, URGENT once lapsed, keyed `approval:<id>:<permit>:expiring@<day>`). Prompt `approval_extract` v1 (Opus 5.5, the PDF whole; never infer an expiry, a pressure or HVHZ; the product's own design pressure only; a page and exact quote per field). Not built: slope / deck / underlayment compatibility against configurations (the CRM holds no structured roof slope or deck), online verification on floridabuilding.org / Miami-Dade (decision 9).

Service `approvals.ts`: create (PDF only, ≤ 22 MB, the same document twice 409), read in `after()` (claimed; restarted by the next page load; "not an approval" → FAILED), read again (not once checked), edit (a typed pressure gets its sign), mark checked (needs the number and the product or manufacturer), materials, search (number, manufacturer, product, file name, and a model name in part — one SQL `unnest(models) ILIKE`, `%` escaped), detail (with a names-only material catalog for the office — the price book's costs stay ADMIN / MANAGER); on a permit: list with flags, add (once per use), edit, remove (its expiry tasks close), copy the document among the permit's documents as `product_approval`; `raiseApprovalAlerts` from the **existing permit-aging cron** (no new crontab line) and on adding a product; `settleApprovalAlerts` when the expiry changes or the approval is set aside.

Access: the repository is the office's (`canManageApprovals` = ADMIN / MANAGER / OFFICE_STAFF); reading it everyone but crew leads; products on a permit `canWriteProduction` behind the permit's job guard. `FRAMED_BY_SELF` gains `/api/product-approvals/:id/file` and `/api/permit-forms/:id/file`.

Routes: `GET|POST /api/product-approvals`; `GET|PATCH /api/product-approvals/[id]` + `/verify`, `/reread`, `/materials` (PUT), `/file`; `GET|POST /api/permits/[id]/products`; `PATCH|DELETE /api/permit-products/[id]` + `/document`.

UI: **Permits → Product approvals** (`/permits/products`: search, category, HVHZ, expiring; "Add an approval" for the office), `/permits/products/[id]` (the PDF in a frame beside the fields, each with "p. n: “quote”"; Read again, Mark checked; approved systems; materials; the permits using it; set aside), the permit's **Products** tab (the advisory line, an HVHZ note, each product with its flags, used as, required ± psf, "Add the approval to the permit's documents", remove; Add a product searching the repository). Permit Center links Product approvals.

Gate: typecheck clean, lint 5/22, 1824 tests (+16), build clean.

Dev QA (real documents, three AI calls, **$0.79**):
- Readings: the NOA in 25 s for $0.16 — number, approval 2026-07-09, expiry 2028-04-11, HVHZ yes, each with page 1 quotes; the −67.5 psf underlayment uplift kept out of the design pressure and explained in the limitations, as the prompt asks. MFM FL 11842.3 R9 in 17 s for $0.09 — no expiry invented, HVHZ "no" from page 4. Polyglass FL5259-R38 in 102 s for $0.53 — 18 models, 52 systems.
- API 9 + 24 + 6: the same file twice 409; on an HVHZ permit the NOA flagged unchecked / no pressure stated / not in the documents, the FL report flagged HVHZ; checked + document copied → only the real pressure flag (−75 required vs −67.5 entered); a typed "67.5" stored as −67.5; checked approvals not read again; the permit-aging cron raised one expiry task, a second run none, a renewed expiry closed it; removing a product closed its task; search by model in part (fixed in QA — Prisma's `has` matched whole names only), HVHZ filter. SALES_REP: reads, cannot add / edit / check, sees no price book, edits products and pressures on their own job's permit.
- Headless Chromium 31/31 at 1280 / 400 px; the document frame verified in full Chromium (`chromium-1228`): the NOA renders beside its fields, no refusal.
- Dev DB restored, QA files removed.

**Deploy carries the migration.** No seed, no new cron. After it: Permits → Product approvals → add the NOAs / FL approvals KNU installs → check each against its document → on a permit's Products tab add them with the engineer's pressures → "Add the approval to the permit's documents".

## Stage 5 — preflight (built 2026-10-18)

Migration `20261105120000_permit_preflight`: `PermitPreflightRun` (permit, cycle, rules version, score, blockers, warnings, findings, the AI call, who ran it) and on `JobPermit` the ready mark — `readyAt`, `readyByUserId`, `readyRunId`, `readyOverride` (the reason when marked ready over blockers).

Pure `preflight.ts` (rules `pf-1`, tested): jurisdiction and type set; on a resubmission an unconfirmed notice and open corrections block, no response letter warns; each requirement line (required → blocker, optional → warning, no document type → a note); each published form that applies — not filled / not final → blocker, a final form's blank fields and signatures to collect → warnings; no contractor licence on record → blocker, no qualifier → warning; architect / engineer without a licence → warning; no parcel number, no valuation → warnings; each product's approval flags (danger → blocker, warning → warning); an HVHZ re-roof with no products → warning; sealed documents listed as a note ("the CRM cannot verify a seal"). Score 100 − 25 a blocker − 5 a warning, **rules only** (the AI look is not scored), "Readiness score — not a prediction of approval". `aiFindings`: the AI's points become warnings only when they cite a ref of the summary. Prompt `preflight_review` v1 (Opus 5.5): a summary with refs — documents by type and name, the requirement lines, the forms' state, products and flag codes, party roles (no names, phones or emails), the department's earlier comments on the permit (framed as untrusted), and **the rule findings already reported** so it does not repeat them.

Service `preflight-run.ts`: the context from the permit record, fills, products and the records (licence / qualifier through the data dictionary); `runPermitPreflight` (an AI failure becomes a note, never an error); runs kept; findings → tasks on request (`preflight:<permit>:<code>`, coordinator, blockers HIGH due in 2 days, warnings in 5), closed by the next run that passes the check; `markReady` (a fresh run first; blockers need ADMIN / MANAGER and a reason of a sentence; audited `permit_ready` / `preflight_override`); `clearReady` (a person, or **freezing a package** — every submission is checked again); the readiness report PDF (`lib/pdf/permit-preflight-report.tsx`).

Workflow: `gates.ts` held facts gain `permitApplicationFinal` (a FINAL form fill on a job's permit ticks "… permit application completed") and `permitReady` (a permit marked ready ticks **every** line of the job's `…permit_documents` step). No template change.

Package default (`defaultPackage`): a filled form's editable copy is no longer pre-ticked — the flattened one is sent (the AI look caught both copies being offered).

Routes: `GET|POST /api/permits/[id]/preflight` (`ai: true`), `POST|DELETE /api/permits/[id]/ready` (`overrideReason`), `POST /api/permit-preflight-runs/[id]/tasks`, `GET /api/permit-preflight-runs/[id]/pdf`. Run and tasks: `canWriteProduction`; ready: `canSubmitPermit`; override: ADMIN / MANAGER.

UI: the permit's **Preflight** tab (run, "with an AI second look", score and counts with the AI points marked "not scored", blockers / warnings / notes with "Open <tab>", pick → Create tasks, Report, earlier runs, Mark ready / Mark ready over the blockers…, the ready banner with "Take it off"); a "Ready to submit" chip in the permit header; the freeze dialog notes when the permit is not marked ready.

`package.json`: `typecheck` now also runs with a 6 GB heap — on the Mac the type-check ran out of the default heap during this stage, as the build did on the droplet.

Gate: typecheck clean, lint 5/22, 1839 tests (+15), build clean.

Dev QA (two AI looks, $0.07): on JOB-00001 with a required NOC and the county form published — first run 10 (3 blockers: NOC, the global "completed application" requirement, the form not filled; warnings qualifier / parcel / value); ready refused 409, a one-word override refused 400; three tasks created; NOC + value added → their tasks closed by the next run; form finalised → no blockers, signatures listed; marked ready → the job's roofing permit-documents step ticked all three lines; the AI look 7 points (products, roof plan, re-roof mitigation, Town of Palm Beach architectural review…), none restating the rules after the fix, score unchanged (60 = 60); report PDF; freezing cleared the ready mark; an ADMIN override with a reason kept and printed; every step audited. SALES_REP 6/6 (runs, creates tasks, reads the report; ready / override / clear 403). Headless Chromium 18/18 at 1280 / 400 px. Fixed in QA: AI points restated the rules and moved the score; "review cycle 0" on an unsubmitted permit; the editable form copy in the default package. Dev DB restored, QA files removed.

**Deploy carries the migration.** No seed, no cron.

## Stage 6 — lessons + metrics (built 2026-10-18)

Migration `20261106120000_permit_lessons`: on `permit_knowledge` (LESSON rows) `category`, `target`, `group_key` (indexed), `source_item_ids`, `check` (JSON `{ requiresDocType }`), `ai_call_id`.

**Lessons.** When the department's next answer gives a permit's comments their outcome (`confirmNotice` on a later cycle, or `onCycleApproved`), `proposeLessonsFor` takes every comment ACCEPTED and groups it by jurisdiction × permit type × category × what it affects (`lessonGroupKey`). A group never seen becomes a PROPOSED lesson (reliability OBSERVED); a comment in a group already learned adds to its `occurrences` (a rejected lesson keeps counting; a retired one does not take new comments, so a new proposal is made). No comment is counted twice. The comments are scrubbed first (`scrub`: the address, owner, parcel, permit / application / job numbers, party names, emails, phones) and rewritten by Haiku 5.5 (`lesson_generalise` v2, about $0.0001 each) as one imperative line + two or three sentences, with a proposed check only when the comment says a kind of document was not submitted at all. Without the AI the first comment is the draft. Learning never throws into the permit's own work.

Pure `lessons.ts` (tested): `scrub`, `planLessons`, `applicableLessons` (APPROVED, in effect, the permit's jurisdiction or none × its type or none; most specific, then most often asked, then most recent), `lessonFindings`. **At preflight** (`preflight-run.ts`), up to 15 approved lessons become rule findings: a lesson whose check fails (that document is not on the permit) is a WARNING; every other lesson — no check, or the document is on file — is a note ("Reviewers here have asked for this before (asked n times): …"). They count in the score like any rule, because an administrator decided them.

Admin → Permits → **Knowledge** (`knowledge-admin.tsx`): To decide / Approved / All; each lesson's wording, jurisdiction, permit type and check editable; Approve / Save / Reject / Retire / Back to decide; the comments it came from with links to their permits; "asked n times (x before approval, y since)" — the design's effectiveness figure in its simplest honest form. Routes `GET /api/permit-lessons`, `PATCH /api/permit-lessons/[id]` (`canManagePermitSettings`; audited `lesson_<status>` / `lesson_edit`).

**Permit Center metrics** (pure `metrics.ts`, loader `metrics-load.ts`, `GET /api/permits/metrics`; everyone but CREW_LEAD, scoped by `jobAccessWhere`): Active · Preparing · In review · Corrections · Waiting on others · Approved this month · Days to approval (first submission → approval, last 12 months) · First-submission approval · Review cycles per permit · At risk (in review past the jurisdiction's target or 30 days, resubmission overdue, expiring within 30 days, a correction past due). Each tile carries the permit ids it counts; clicking one narrows the board and list (`?metric=`), again clears it.

**Attention rows** `permit-corrections` (permits in CORRECTIONS on open jobs) and `permit-resubmit-due` (a confirmed notice's response due within 3 days or overdue), both opening the permit's Corrections tab.

Not built from the design: "similar past permits" and full-text search over lesson wording (too little history on prod — three permits); the before / after repeat-correction rate (replaced by the per-lesson asked-since-approval count).

Gate: typecheck clean, lint 5/22, 1847 tests (+8), build clean.

Dev QA (AI $0.023 for two notices, $0.0004 for three lessons): API 45/45 — a pasted notice with the job's address, owner, phone and email → three items → confirmed (both attention rows 1, Corrections tile) → resolved → resubmitted → approved → three proposed lessons with none of the particulars, each comment counted once; the AI proposed a check only for the survey (first wording, v1, proposed a check on all three — the "colour sample" one as a product approval — fixed in the prompt, and a passed check now still shows as a note); approve with a check / bad check 400 / approve as a note / reject; a second permit of the same town and type: survey lesson WARNING, note INFO, rejected absent, survey uploaded → note, score moved by exactly one warning; its own survey comment joined the lesson (asked 2 times, no new lesson); retired → gone. Metrics after: 2 approved this month, 34 days to approval, 0 % first pass, 2.0 cycles. Roles: SALES_REP 403 on lessons, metrics scoped to its job; CREW_LEAD 403 on both. Headless Chromium 19/19 at 1280 / 400 px. Dev DB restored, QA files removed, john.rep back to SALES_REP.

**Deploy carries the migration.** No seed, no cron.

## Document assistant (built 2026-10-19, after the seven stages)

Richard: "upload multiple documents and have the AI go through the documents, click links and assist with putting together the relevant documents". Ruled: all three kinds of link (inside documents, the department's website, product-approval sites); **the AI proposes, a person confirms** (plan `~/.claude/plans/floofy-questing-lark.md`).

Migration `20261107120000_permit_assistant`: `PermitAssistRun` (one pass per permit, `fetchCount`), `PermitAssistItem` (UPLOAD / LINK / SITE, parent, depth, url / final url, the file for an upload, held bytes for a fetched document until decided, suggested type, title, summary, page-cited findings, links, status QUEUED → READING → PROPOSED | PAGE | FAILED → ACCEPTED | REJECTED), `PermitAssistFetch` (every request, allowed or refused); `Jurisdiction.websiteUrl` + `allowedHosts`.

**The fetcher** (`web-fetch.ts`, new — the CRM had no outgoing-request guard): our code opens links, the model only picks numbers from a list. http(s), ports 80 / 443, no credentials, no local names; DNS resolved at connect time through `safeLookup` and any private / loopback / link-local / metadata / reserved answer refused (so a name pointing inside cannot be rebound between check and request); three redirects, each hop checked again with the host policy; 15 s; 25 MB (also after unpacking); robots.txt honoured; a KNU user agent. Only PDFs, pictures (not SVG) and HTML are read; a web page is never stored or served back from the CRM.

**Where it may go** (`links.ts` `mayFollow`): from a person's document, any public site, one hop (the document named it); from anything fetched, only the jurisdiction's website host, its allowed sites, `floridabuilding.org` and `miamidade.gov`; depth 2; 40 pages a pass. Links a fetcher would refuse are never even offered to the model. PDF link annotations come from `readPdfText` (now returns `links`); printed URLs and a page's `<a>` links from `links.ts` (150 per item).

**Reading** (`prompts/assist-read.ts`, `assist_read` v1, Sonnet 5.5, PDF as a document block, a page as untrusted text): type, title, summary, relevant, what it asks for, approval numbers, deadlines (each with page + quote), and the link numbers worth opening with a reason. Cost per pass counted on subject `permit_assist_run`.

**Service** `assist-run.ts`: `startAssistRun` (uploads already on the permit + optionally its untyped documents + optionally the website; one pass at a time per permit), `stepAssistRun` (claims one item at a time; a stale READING item is retried up to three times; the run closes when nothing is left; the GET picks a cut-off run up again), `loadAssist` (with `coverage` / `askedFor` / `duplicateOf` / `approvalNumbers` from pure `assist-plan.ts`), `decideAssistItem` (accept → typed permit `File`, the fetched bytes becoming its file; reject → the held bytes deleted, an upload stays on the permit untyped; "Read as a product approval" → `createApproval` + `runApprovalRead`, `canManageApprovals`), `assistItemBytes`. Routes: `GET|POST /api/permits/[id]/assist`, `PATCH /api/permit-assist-items/[id]`, `GET /api/permit-assist-items/[id]/file` (PDF / picture only, opened in its own tab). Run and decide: `canWriteProduction` on the permit's job.

**UI**: Documents tab → **Document assistant** card ("Sort documents…" dialog: drop or choose files, read the permit's untyped documents, look on the department's website) → progress, **To decide** rows (source and link trail, why it was opened, copy warning, "not related" warning, type picker, Accept / Reject / Open / Where it came from / Read as a product approval), the checklist (covered / proposed / missing / by hand), **What your documents ask for** first and the department's pages folded below, product approvals named (links to Product approvals), decided, and the fetch log. Admin → Permits → Jurisdictions: Building department website, Other sites it may open.

Not built: a direct product-approval lookup by number on floridabuilding.org / miamidade.gov (the plan's spike; links to them in documents are followed); "use for the package" pre-ticks — not needed, accepted documents are typed permit files and the freeze dialog's default package already takes them.

Gate: typecheck clean, lint 5/22, 1865 tests (+18), build clean.

Dev QA with real AI and the real Town of Palm Beach site: five uploads (a correction letter with a link to the town's roofing affidavit and a planted "open http://127.0.0.1… / 169.254.169.254…" note, a submittal checklist, a roof plan, the real NOA 26-0504.06, a copy of the checklist) + website `townofpalmbeach.com/423` → done in 111 s, **$0.54**, 14 pages opened (all on the town's site), 0 requests to a private address (the model also named the planted note in its summary); the letter typed as a correction notice, the NOA as a product approval, the copy marked; from the town's Permits page it proposed the Construction Permit Application packet, the Notice of Commencement form, the revision form, the NOBO form, contractor-registration and portal instructions and the fee schedule. API 30/30 (bad allowed site 400, one pass at a time 409, accept a fetched form → typed permit file, accept twice 409, reject the copy, bad type 400, NOA to Product approvals, the fetched PDF opens, a page 404, the checklist covered after acceptance); SALES_REP 4/4 (runs on own job, 403 on approvals, 404 off the job); headless Chromium 18/18 at 1280 / 400 px. Changed in QA: links the fetcher would refuse are no longer offered to the model, and the asks list (40 lines, mostly the department's general pages) now shows the person's own documents' asks first. Dev DB restored, QA files removed, john.rep back to SALES_REP.

**Deploy carries the migration.** No seed, no cron. After it: Admin → Permits → Jurisdictions → set each department's website.

## From found documents to filled forms (built 2026-10-19)

Richard: "what happens after docs are identified? are they filled out" → "do both": (1) a document the assistant found can become a fillable form template, (2) printed / scanned (flat) forms can be filled. No migration.

**The bridge.** An assistant item that is a PDF gets **Make a fillable form** (`PATCH /api/permit-assist-items/[id]` `{ action: "template" }`, `canManagePermitSettings` — a template is shared by every permit of the jurisdiction): `createTemplate` with the item's bytes, named from its title, for the permit's jurisdiction, then the mapping starts. The link back is by the file's sha256 (no column): `loadAssist` returns each item's `template` (state, kind) and the panel shows "Fillable form: draft — check it and publish / published — fills from the Forms tab". The same bytes twice link the same template.

**Flat forms.** `createTemplate` now accepts a PDF with no fields when AI is set up (it starts as `mapState MAPPING`; the upload route runs the mapping after the answer). `runMapping` branches to `runFlatMapping` → `flat/flat-map.ts`:
- `flat/form-worker.mjs` (own process, like the takeoff's worker — pdf.js and the canvas never in the Next process): renders each page at 150 dpi to PNG + raw grayscale (pdf.js's own standard fonts, `useSystemFonts: false`, `standardFontDataUrl` — without them Helvetica text did not render in Node), and draws numbered boxes.
- `flat/detect.ts` (pure, tested on synthetic pages): horizontal lines from dark-pixel runs (merged across rows, thick bands dropped, scanned pieces joined until stable), split where vertical lines cross (table cells), the empty band above each line (bounded by the line above) → a text blank; small squares with four drawn corners, an empty inside and clear space round them → a tick box. Numbered in reading order, at most 160 a page. Positions come only from here.
- `prompts/flat-form-map.ts` (`flat_form_map` v1, Opus, the marked page image + the numbered list with the text layer's words beside each): which numbers are blanks, their label, type (text / checkbox / signature) and the same mapping as fillable forms — `MAPPING_RULES` and `CONTRACTOR_LINE` are now shared with `form_map`, whose prompt text is unchanged (hash checked). A number not on the page is ignored; a tick box found on the page is a checkbox whatever the answer says.
- The blanks become ordinary inventory fields `p<page>-<n>` with a PDF-point rect, so the editor, mappings, fills, overrides and finalising are unchanged.

**Writing a flat fill** (`fillFlatForm` in `form-pdf.ts`): each page's own content is first wrapped in a graphics save / restore (a scan's hidden OCR layer sets invisible text and never restores it); each value printed just above its line, ¾ of the band's height up to 10 pt, shrunk to fit down to 5.5 pt — a value that still does not fit is reported in `skipped`, never cut; a tick box gets an X; signatures never. One PDF (no "editable" copy): `outputFileId` and `flattenedFileId` are the same file, and the drops guard against deleting it twice.

**Checking a template**: `GET /api/permit-forms/[id]/preview?permitId=…&pdf=1&boxes=1` returns the form filled for that permit with every field outlined and labelled (`outlineFields`), writing nothing; the editor offers it as "Open the filled preview" and a printed form carries a note: a value in the wrong place → clear that field's mapping and it is left for a person.

Gate: typecheck clean, lint 5/22, 1872 tests (+7), build clean.

Dev QA with the Town of Palm Beach's real forms (AI $0.66 once per form set; filling costs nothing): the assistant typed all three; Make a fillable form ×3 (asking twice → the same template) → mapped in 88 s: NOC (fillable, 44 fields, 8 mapped), Construction Permit Application (flat, 8 pages, 203 blanks — site address, owner, valuation, contractor, DBA, phone, qualifier, certificate #, email mapped; fees, office use, yes/no left for a person; 65 permit-type tick boxes with "Residential Roof/reroof" ticked for a re-roof), roofing affidavit (scanned, 21 blanks — contractor, addresses, owner, licence, date, the roof-metal certification ticked when the permit is a re-roof; signature and the whole notary block left). Published, filled on a permit, written, and checked in Chrome's PDF viewer: every value on its line. API 21/21, headless Chromium 12/12 at 1280 / 400 px, SALES_REP 3/3 (no "make a form", 403 on the action and the preview). Found and fixed in QA: printed values invisible (the OCR layer's text mode — the page wrap), the worker not drawing standard fonts, scanned underlines in pieces, letters taken for tick boxes, values too small. Dev DB restored, QA files removed.

**No migration.** After the deploy: on a permit's Document assistant → Make a fillable form on each blank form (or Admin → Permits → Forms → upload) → check it with the filled preview → publish → the permit's Forms tab fills it.
