# UI / UX audit — KNU Construction CRM (web)

Checkpoint 2, 2026-11-09. Commit `2ad2f9d`. Measured over `src/app` and `src/components` (`*.tsx`), the 346 checkpoint-1 screenshots (87 pages × 2 widths, ADMIN and SALES_REP) and axe-core on 20 pages. Each finding says whether it was seen in a browser or counted in the code. Defect ids refer to the [defect register](construction-crm-defect-register.md).

## Headline

1. **The app has been rendering in Times, not its chosen font** (D-14, browser-verified in full Chromium). `globals.css` sets `--font-sans: var(--font-sans)`. A variable that refers to itself resolves to nothing, so `font-sans` falls back to the browser's default serif. Geist is downloaded on every page load and never applied. The same CSS ships to production; this was not checked in a production browser. The fix is one line (`var(--font-geist-sans)`), and it is the single biggest visual improvement on offer.
2. **Colour is mostly tokens, but a third of it is not.** There are 2,323 uses of the tokens (`primary`, `muted`, `tone-*`, `stage-*`…) against 1,070 hard-coded palette classes in 176 files. The most common are `bg-gray-50` ×137, `bg-gray-100` ×63 and `text-gray-900` ×57, and 439 are status colours (red, green, amber…) that bypass the `tone-*` tokens. Dark mode and any later colour change will miss those 176 files. There are also 84 hex colours in the TSX.
3. **Forms are the weakest surface**, covered under Form and control census below. In short: 469 `<Label>`s are not tied to their field, 5 dropdowns show record ids (browser-verified), and about 14 fields are typed where a picker exists.
4. **Lists don't sort.** 38 files use the table component; 1 (GC Partnerships) sorts. Jobs, Leads and Tasks don't.

## Measurements

| Area | Count | What it means |
|---|---|---|
| Pages with the shared `PageHeader` | 54 / 87 | 33 pages build their own title row; spacing and button placement differ |
| Empty-state component | 73 files | Good: most lists have one |
| Skeleton loaders | 51 files | Good, but 9 pages never leave them on an error (D-03 / D-04) |
| Native `confirm()` / `prompt()` | 25 calls, 20 files | `ConfirmDialog` exists (26 files); the native ones block the page and can't name the effect |
| Raw `<table>` | 8 files | Outside the table component; no sticky header, no phone layout |
| Native `<select>` | 7 files | Look and behave differently from the 93 files using `Select` |
| `Select` given `items` | 30 of 93 files | Base UI shows the raw value when `items` is missing and the value is an id |
| Button variants | outline 450, ghost 267, brand 102, secondary 31, destructive 16 | No single "primary" convention: brand, default and outline all lead forms |
| Raw `<button>` vs `<Button>` | 219 vs 980 | Most raw buttons are icon rows and chips, without focus rings or names |
| Arbitrary text sizes (`text-[11px]` etc.) | 475 | On top of 1,514 `text-xs`; small grey text is where the contrast failures are |
| `<Label>` not tied to its field | 469 (255 tied) | Clicking the label doesn't focus the field, and screen readers announce no name |
| `aria-label` | 309 | 71 icon-size buttons; Admin → Follow-up rules / Job task templates / Templates have 90 / 52 / 58 unnamed icon buttons (browser count) |
| Toasts | 551 calls | The main feedback channel; validation errors arrive there as "Validation failed" (D-13) |

## Accessibility (axe-core, WCAG 2.2 AA tags, 20 key pages as SALES_REP)

9 of 20 pages are clean. The rest:

| Rule | Elements | Where |
|---|---:|---|
| button-name | 29 | Select triggers and icon buttons (task status / assignee / priority, job page) |
| color-contrast | 14 | 11 px muted text on tinted chips (dashboard warnings), job stage buttons |
| label | 11 | Task filters, job page, permit page |
| target-size | 3 | Small text links in card headers |
| aria-progressbar-name, aria-toggle-field-name, link-in-text-block, aria-required-attr, aria-prohibited-attr | 1 each | Job page; New Lead address lookup; partners board |

The fixes are mostly mechanical: an `aria-label` on every `SelectTrigger` and icon `Button` (a lint rule can enforce it), and `htmlFor` / `id` pairs on labels.

## Phone width (400 px)

- No page scrolls sideways for any role (checkpoint 1, browser).
- **Touch targets:** the New Lead form has 31 controls under 32 px tall, and the task dialog 54 (browser count). Apple and Google ask for 44 px.
- **Task rows on a phone carry four editable controls each** (priority, date, assignee, status; screenshot `shots/ADMIN/_tasks-400.png`). A mis-tap edits the task. On a phone the row should open the sheet and show the values as text.
- **Permit page tabs wrap onto three rows** (D-09); the job page's horizontal tab scroller is the pattern to reuse.
- Native date inputs (98 fields) behave well on phones; keep them.

## Form and control census

1,006 form controls in 170 files (code count, `forms.json`):

| Control | Count |
|---|---:|
| Text input | 331 |
| Select (Base UI) | 212 |
| Textarea | 125 |
| Checkbox | 103 |
| Date | 98 |
| Number | 79 |
| Date-time, email, time | 27 |
| Native select | 11 |
| Radio groups | 6 |

react-hook-form is used in 3 files (lead forms); the rest hold state by hand.

### Showing an id instead of a name (browser-verified)

| Picker | Before a pick | After a pick |
|---|---|---|
| Permits → Coordinator filter | — | the user's id |
| Job → Daily logs → field assignment | — | the user's id |
| Personnel → Add person → Crew | "none" | the crew's id |
| Change order → Linked crew contract | "__none" | the contract's id |
| Admin → Follow-up rule → Message template | "__none" | the template's id |
| Admin → Follow-up rule → Trigger, Priority | "LEAD_CREATED", "MEDIUM" | the raw code |

Still suspected, but not testable on dev data: Canvassing → Find properties → route, and Job → personnel scope → person. One fix pattern covers all of them: pass `items`, or give `SelectValue` a render function, as the task status picker already does.

### Typed where a picker exists (code-inspected)

| Field | Where | Should be |
|---|---|---|
| Jurisdiction | Apply workflow, Reconcile workflow, Violation case, Violation intake (4) | The Jurisdiction records added with Permit Intelligence |
| Budget category | Budget panel (3) | The job's existing categories, with free text allowed |
| Field-assignment person | Job → Daily logs (typed email) | The user picker (`/api/users/assignable`), with "invite by email" as the fallback |
| Bid project address | Bid form (5 fields) | `AddressAutofillFields`, as on leads |
| Responsible trade | Violation items | The trade list the partners module already keeps |

Already right, and should stay: the expense payee (free text with suggestions — the text is the record, by rule), the crew search on crew links, the inspector's name (not a record).

## Visual consistency (screenshots)

- **Two page-title styles:** the `PageHeader` pages (title + one-line description + actions on the right) and the 33 hand-built ones (title only, or actions under the title).
- **Status colour is said three ways:** `tone-*` chips, stage pills and hard-coded red / amber / green text. Red is used for both "overdue" and "error".
- **Dashboard:** the six owner tiles and the Business development strip show `$0` / `0` cards at full size when there is nothing to report. They push "Needs attention" and "My tasks", the parts people act on, below the fold at 1440 × 900.
- **Admin screens are tables of icon buttons** (pencil, bin, arrows) with no names and native confirmations on delete.

## What to keep

The empty states, the job page's tab scroller and Overview, the address-first labels, the kanban kit, the bulk clean-up confirmation that names its effect, the file preview, and the refusal messages that say who may do it.
