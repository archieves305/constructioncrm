# Job documents and photos (audit initiative 7)

Three stages, plan approved 2026-10-03
(`~/.claude/plans/encapsulated-frolicking-possum.md`). Stage 1 (files belong
to the job, preview, missing state) is on prod (`d18d054`, BUILD_ID
`16_91QFu9eTLm0-ZEhAiC`; backfill gave 37 of 92 files a job); Stage 2 (one photo gallery from
two sources) and Stage 3 (receipts on expenses) follow.

Richard's rulings (2026-10-03): a record whose file is gone stays, **marked
missing, with "Upload again"** onto the same record; **any expense** (typed or
bank-fed) can carry receipts; **one gallery, two sources** — daily-log photos
and image files shown together, nothing moved or copied.

## Stage 1 — files belong to the job

Migration `20261016120000_file_job_link`: `files.job_id` (nullable,
`SET NULL`, indexed) and a hand-appended backfill, each rule filling only rows
still without a job: (1) a task's file takes the task's job; (2) a file a
`GeneratedDocument` points at takes that document's job; (3) any other file on
a lead with exactly one job takes that job — except files on a code-violation
case, and leads with no job or several.

### The rule

A file belongs to a job when it has `jobId`. A lead's file with none is a
**lead document** (an estimate, something uploaded before the job existed): it
shows on the lead, and on each of the lead's jobs in a "Lead documents" group
of its own. A file on a case stays with the case (`jobId` null).

### Where things are

- `src/lib/files/scope.ts` — pure, client-safe, tested: `CATEGORY_LABEL` /
  `CATEGORY_ORDER` / `UPLOAD_CATEGORIES`, `groupByCategory`,
  `categoryCounts`, `filterFiles`, `previewKind` (image / pdf / other; HEIC is
  "other"), `cleanFileName` (keeps the extension on a rename).
- `src/lib/files/access.ts` — `fileReadWhere` (own-only roles now also read
  files on a job they have a role on), `canDeleteFile` and new `canEditFile`,
  both taking `generated`.
- `src/lib/files/list.ts` — `FILE_LIST_INCLUDE`, `presentFiles`: every listed
  file carries `missing` (one `fs.access` per row via `fileExists` in
  `storage.ts`) and `generated`; the storage key never leaves the server.
- Routes: `GET /api/files?jobId=` → `{ files, leadFiles }` (`guardJob` read;
  other scopes still answer one array); `POST /api/files` accepts `jobId`
  (lead derived from the job) and copies a task's job;
  `GET /api/files/[id]` (+ `?download=1`, `?meta=1`);
  `PATCH /api/files/[id]` (rename, recategorise among the upload categories,
  attach a lead document to a job of the same customer or detach it);
  `POST /api/files/[id]/replace` ("Upload again": only when the file is
  missing — 409 otherwise; audited `file_replace`); `DELETE` unchanged apart
  from the generated rule.
- Writers that now set the job: the three labor-contract generators
  (`lib/contracts/generate.ts`), customer contract draft / regenerate
  (`customer-contracts/service.ts`) and signing (`sign-service.ts`). Estimate
  PDFs stay lead documents.
- UI: `components/files/file-preview.tsx` (`FilePreviewDialog`: image in
  place, PDF in an iframe on desktop and an Open button on phones, other kinds
  a download, missing → "Upload again", previous / next within the list);
  `components/files/files-panel.tsx` rebuilt (`FilesScope` may carry `jobId`;
  groups, category chips with counts, Missing chip, name search, row menu,
  edit dialog, confirm on delete with the server's reason). The job page
  passes `scope={{ leadId, jobId }}`. Task attachments, workflow-step files
  and the field task page open the preview instead of a new tab.

### Generated documents (the hole this closed)

A signed customer agreement is stored as `SIGNED_DOC`; the delete guard
protected only `CUSTOMER_CONTRACT`, and deleting the `File` unlinked the PDF
the contract itself reads. Now any file a `GeneratedDocument` references is
never deleted, renamed, moved or replaced through the file routes, whatever
its category. A `SIGNED_DOC` uploaded by hand is still an ordinary file.

### Not done in this stage

Violation hearing / inspection / fine file links, the estimate "open PDF"
buttons and the labor-contract document link still open a new tab. A missing
generated document can only be regenerated where it was made.

### Dev QA (2026-10-03)

API script 31/31 (a file uploaded on job A shows on A and the lead, not on job
B of the same customer; a lead document shows on both jobs in its own group
and can be attached / detached; another customer's job 400; rename keeps the
extension; a CRM-only category 400; a task upload takes the task's job and
cannot be moved; removed from disk → listed missing, meta, 410, replace
restores the same id, second replace 409; a generated contract 403 on delete /
rename / replace for ADMIN, including when stored as SIGNED_DOC; a generated
labor contract carries the job; audit `update`, `file_replace`, `delete`).
Headless Chromium 28/28 at 400 and 1280 px, no console errors. SALES_REP: own
job 200, another job's list and file 404, the office's file 403 on rename and
delete, upload to own job 201, to another job 404. Found in QA and fixed: a
link styled with the Button primitive raised a Base UI console error; a file
with no preview showed two Download buttons. Dev DB restored. Not exercised:
signing a customer contract end to end (the rule is unit-tested and was
exercised on a generated contract re-labelled SIGNED_DOC).

## Rules

- A file belongs to a job when it has `jobId`; a lead's file with none is a
  lead document. New code that writes a `File` for something on a job sets
  `jobId`.
- A file a `GeneratedDocument` references is never deleted or replaced through
  the file routes.
- A record whose file is missing is shown as missing and can be re-uploaded
  onto the same row; it is never hidden.
- New file links open `FilePreviewDialog`, not a new tab.
