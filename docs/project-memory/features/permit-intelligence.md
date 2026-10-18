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
