# Job documents and photos (audit initiative 7)

Three stages, plan approved 2026-10-03
(`~/.claude/plans/encapsulated-frolicking-possum.md`). Stage 1 (files belong
to the job, preview, missing state) is on prod (`d18d054`, BUILD_ID
`16_91QFu9eTLm0-ZEhAiC`; backfill gave 37 of 92 files a job); Stage 2 (one photo gallery from
two sources) and Stage 3 (receipts on expenses) are on prod (`a03c698`,
BUILD_ID `SBnOF_n7Dfa0xpp-w6tyi`, deployed 2026-10-03). All three stages are
live.

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

## Stage 2 — one photo gallery, two sources

No migration. Nothing is moved or copied: a daily-log photo stays a
`FieldPhoto`, a task photo stays a `File`.

- `src/lib/photos/gallery.ts` — pure, client-safe, tested: `mergeGallery`
  (newest day first, then newest within the day), `logPhotoItem` /
  `filePhotoItem` (each item carries `origin` — "Daily log · Sep 3", "Task ·
  Final walkthrough", "Uploaded" — and `href`), `filterGallery` (source,
  daily-log category, missing; a category leaves files out, they have none).
- `GET /api/jobs/[id]/gallery` (`requireJobFieldAccess` read; `from` / `to`):
  the job's `FieldPhoto`s and its image `File`s (`jobId` = the job, type
  `image/*`, within `fileReadWhere`), `missing` per item, `canWrite`.
- `POST /api/photos/[id]/replace` — "Upload again" for a daily-log photo: only
  when its image is missing (409 otherwise), an image only, the taker or an
  office role with write access to the job. Restoring a lost image is not an
  edit to the log, so an approved log does not lock it. Audited
  `file_replace` on `FieldPhoto`.
- `src/components/photos/job-photo-gallery.tsx` rebuilt on the merged list:
  source chips (All / Daily logs / Tasks and uploads), a Missing chip,
  daily-log category chips, dates; a placeholder tile for a missing photo; the
  lightbox steps across both kinds, links to the log, the task or the Files
  tab, and offers Upload again. Delete goes to the photo's own route (an
  approved log still locks a daily-log photo's delete there).
- Photos are downscaled before upload everywhere now: `preparedUpload` in
  `use-task-file-upload.ts` (task sheet, Complete dialog, AddTaskDialog, field
  task page) and the Files panel use `downscalePhoto` (2000 px JPEG). A GIF
  and anything that is not an image go as they are.

Dev QA (2026-10-03): API 14/14; headless Chromium at 400 and 1280 px — one
gallery with both sources, placeholder for a missing photo, source and
category filters, the lightbox stepping across task photos, uploads and
daily-log photos, Upload again restoring a daily-log photo, delete of an
uploaded image, no console errors (two reported failures were the test reading
the wrong paragraph on the missing photo). A 4000 px, 1.3 MB JPEG taken from
the field task page was stored at 2000 px, 204 KB, and appeared in the job's
gallery. SALES_REP not on the job 403; on the job, read-only. Dev DB restored.
Not done: the field daily-log screen's own photo grid still shows a broken
image for a missing photo.

## Stage 3 — receipts on expenses

Migration `20261017120000_expense_receipts`: `files.expense_id` (nullable,
`SET NULL`, indexed) and `FileCategory.RECEIPT`.

- `POST /api/files` accepts `expenseId` (needs `canEnterJobCosts`): the file
  takes the expense's job and lead and is always category `RECEIPT`.
  Attaching never edits the expense, so it works on bank-fed rows.
- `GET /api/jobs/[id]/expenses` returns each expense's `receipts`
  (`id, fileName, fileType, fileSize, missing`).
- `PATCH /api/files/[id]` refuses to move a receipt off its expense's job.
- `FILE_LIST_INCLUDE` carries `expense`, so the Files tab's Receipts group
  says "Receipt for <vendor>, $x".
- The job gallery leaves receipts out (a photographed receipt is not a job
  photo).
- `components/jobs/expenses-panel.tsx`: "Add receipt" in the add form (files
  are uploaded after the expense is created; a failed file never undoes the
  expense), a paperclip with a count on the row that opens
  `FilePreviewDialog`, an "Attach a receipt" button on every row (bank-fed
  ones too), and the receipts with "Attach receipt" in the edit dialog. A
  receipt whose file is gone shows amber and can be uploaded again from the
  preview. Images are downscaled like every other photo.
- Deleting an expense leaves its receipts on the job as files (the link is
  cleared by the FK).

Dev QA (2026-10-03): API 13/13 (typed and bank-fed expense; category forced
to RECEIPT; job and lead taken from the expense; the expense row and the job's
contract untouched by an attach; unknown expense 400; receipts listed with
`missing`; on the Files tab; not in the gallery; cannot be moved; missing →
upload again; expense delete keeps the files). Headless Chromium 10/10 at 1280
and 400 px (add with a receipt, count on the row, preview, attach to a
bank-fed row, edit dialog, Files tab), no console errors. SALES_REP without
the cost grant 403 on attach; on the job, reads the receipts. Dev DB restored.

## Rules

- A file belongs to a job when it has `jobId`; a lead's file with none is a
  lead document. New code that writes a `File` for something on a job sets
  `jobId`.
- A file a `GeneratedDocument` references is never deleted or replaced through
  the file routes.
- A record whose file is missing is shown as missing and can be re-uploaded
  onto the same row; it is never hidden.
- New file links open `FilePreviewDialog`, not a new tab.
- A receipt is a `File` with `expenseId`, category `RECEIPT`, on the expense's
  job. Attaching one never edits the expense.
