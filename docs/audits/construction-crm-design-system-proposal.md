# Design-system proposal — KNU Construction CRM (web)

Checkpoint 3, 2026-11-09. A proposal for approval. Nothing here is built yet. Tickets: T-09 to T-17 in [implementation tickets](construction-crm-implementation-tickets.md).

## Decision: keep the current stack and finish it

The CRM already runs shadcn components on Base UI (`@base-ui/react`), with Tailwind v4 tokens in `globals.css`, 28 primitives in `src/components/ui`, and shared pieces in `src/components/shared` (PageHeader, EmptyState, ConfirmDialog, AddressAutofillFields, JobPicker). The tokens are already good: `brand`, five `tone-*` status families and seven `stage-*` colours, each with base, soft and foreground. The problem is that a third of the code doesn't use them, not that they're missing.

**Replacing the library was considered and rejected.** MUI, Mantine and Chakra would each mean rewriting 980 Buttons, 212 Selects and 94 dialog files, for no gain the current primitives can't give. The only addition proposed is `@tanstack/react-table` (headless, MIT, 0 styles) under the DataTable. Hand-rolled sorting is the fallback if you'd rather not add it.

## Tokens

| Token family | Today | Proposed |
|---|---|---|
| **Font** | Times by accident (D-14) | Geist Sans for UI, Geist Mono for record numbers and money columns |
| **Type scale** | `text-xs` ×1,514 plus 475 arbitrary sizes | `2xs` 11 px (labels only, darker grey), `xs` 12, `sm` 14 (body), `base` 16 (phone inputs), `lg` 18 (card titles), `2xl` 24 (page titles). Weights 400 / 500 / 600 only |
| **Neutral surfaces** | `bg-gray-50` ×137, `bg-gray-100` ×63… | `surface` (page), `surface-subtle` (zebra rows, panels), `surface-raised` (cards), `border`, `border-strong` |
| **Status** | `tone-*` plus 439 raw red / green / amber classes | `tone-info / success / warning / danger / neutral` only. Red means danger or overdue, never decoration |
| **Stage** | `stage-0…6` from the stage's order | Unchanged (works well) |
| **Brand** | `brand` (steel blue) | Primary actions, links and the selected nav item only |
| **Spacing** | Tailwind 4-px scale, mixed | Page gutter 16 px on phone, 24 on desktop; card padding 16 / 20; form row gap 12; section gap 24 |
| **Radius** | `--radius` 0.625 rem with derived steps | Unchanged: inputs and buttons `md`, cards `xl`, pills `full` |
| **Shadows** | Mostly none, some `shadow-sm` | `shadow-sm` on raised cards and menus only; dialogs use the overlay, no heavy shadow |
| **Component height** | 28–36 px | Desktop 32 px (`sm`) / 36 px (default); **phones 44 px minimum** |
| **Breakpoints** | Tailwind defaults | Phone < 640, tablet 640–1023, desktop ≥ 1024. Lists turn into cards below 640 |
| **States** | Ad hoc | Hover = surface-subtle; focus = 2 px `ring-brand` offset 2; disabled = 50 % with no pointer; selected = brand-soft background with brand-fg text |

Enforcement: an ESLint rule against raw palette classes and arbitrary text sizes in new code, plus a test that no CSS custom property refers to itself.

## Components

### Buttons

| Kind | Variant | Rule |
|---|---|---|
| Primary | `brand` | One per view or dialog: the action the screen exists for |
| Secondary | `outline` | Alternatives next to the primary |
| Tertiary | `ghost` | Toolbars, row actions, Cancel |
| Destructive | `destructive` | Delete or void, always behind ConfirmDialog |
| Icon-only | `ghost` + `size="icon"` | `aria-label` required by the type; tooltip shows the label |
| Loading | `loading` prop | Spinner replaces the icon; disabled; the label stays (no width jump) |
| Disabled | `disabled` | With a tooltip saying why, when the reason isn't obvious |

*Migration:* form submits on `variant="default"` become `brand`. Raw `<button>`s in rows become `Button variant="ghost" size="icon"` with a label.

### Forms

- **`Field`** wraps every control: label (tied by `htmlFor`), control, help text, error (`aria-describedby`, `aria-invalid`). The error is shown under the field, in `tone-danger-fg`, as a plain sentence.
- **Text input** for free text only. Anything that names a record uses a picker.
- **Select** for ≤ 15 fixed choices. It always gets `items` or a render function, so it never shows an id.
- **Combobox (searchable)** for records, built on `ui/command` like `JobPicker`: people, jobs, jurisdictions, vendors, crews, categories, trades. It shows recent items first and allows "Other…" where free text is legitimate.
- **Multi-select**: a combobox with chips (used for watchers and trades).
- **Validation**: in the browser from the same zod schema the route uses, on blur and on submit. The server stays authoritative, and its field messages reach the toast (T-07).
- **Dates**: the native date input (works well on phones) plus the existing due-date presets.

*Migration:* `<Label className="text-xs">Vendor</Label><Input …/>` becomes `<Field label="Vendor"><Input …/></Field>`. A typed jurisdiction becomes `<Field label="Jurisdiction"><RecordCombobox source="jurisdictions" allowOther /></Field>`.

### Tables (DataTable)

- Sort by any visible column; the sort is kept in the URL.
- Filters in the shared toolbar, plus text search.
- Pagination at 50 rows, with a server count.
- A column-visibility menu.
- Row actions in a ⋯ menu.
- Selection checkbox for bulk actions, with a confirmation that names the effect (the overdue clean-up pattern).
- EmptyState when the list is empty, skeleton rows while loading, QueryState when the load fails.
- Sticky header on desktop; card rows on phones.

*Migration:* Jobs, Leads and Tasks first, then the 8 raw `<table>`s and the admin screens.

### Modals and drawers

- `Dialog` sizes `sm` (confirmations, ≤ 2 fields), `md` (short forms), `lg` (previews, pickers). Every dialog is full-screen on phones.
- `Sheet` (right drawer) for a record's detail beside its list (the task sheet) and for any form longer than one screen.
- Focus goes to the first field and returns to the trigger on close. Escape and the ✕ close; a dirty form asks before closing.
- Buttons go bottom right, with the primary last; destructive actions sit bottom left.

### Cards

- Header with a `lg` 600 title, optional one-line description, and actions on the right as ghost buttons or a ⋯ menu.
- Body padding 16 / 20.
- One subject per card. Money cards show the figure first and the explanation under it.

### Status

- `StatusBadge kind=… value=…` from one registry of label + tone per enum, tested against the Prisma enums.
- Text is always present, never colour alone.
- Agreed words: To do · In progress · Blocked · Done · Cancelled (tasks); Applied · Issued · Corrections · Expired (permits); Pending · Approved · Rejected (money).

### Feedback

| Situation | Pattern |
|---|---|
| Success | Toast, 4 s, with Undo where the action can be undone (Done, Move) |
| Error | Toast that stays until dismissed, with the server's sentence (T-07) and Retry when a retry is useful |
| Warning | Inline callout in `tone-warning-soft` beside the thing it is about (vendor compliance does this already) |
| Confirmation | ConfirmDialog naming the effect and the count ("Move 2 overdue tasks to Nov 20?") |
| Background work | Inline progress on the record ("Reading the letter… 12 s"), never a blocking spinner; long jobs survive a reload |
| Refused / missing / failed | QueryState (T-02): one wording each |

## Screen specifications (the brief's ten modules)

Low-fidelity specifications rather than drawings. The "before" screenshots exist for every page at both widths (the audit's `shots/` folders). The proposed method for after-screens: build each Phase C screen behind its route on the dev server and capture it with the same script, so before and after sit side by side in one comparison page.

| Module | Current problems (evidence) | Layout and components | Forms and pickers | Phone |
|---|---|---|---|---|
| **1. Dashboard** | Zero tiles above the work; Times font | Needs attention → Today + My tasks → compact owner row (hidden when all zero) → collapsible Business development | — | One column; attention rows as 44 px list items |
| **2. Jobs list** | Doesn't sort; two header styles | PageHeader · toolbar (Mine / All, search, stage, PM, closed) · DataTable (address-first label, stage pill, PM, contract, balance, next step) · Board toggle kept | PM filter as a combobox | Cards: address, stage, balance |
| **3. Job detail** | Crew pay under Field, change orders under Money; dense tab groups | Keep the Overview default and the tab scroller; Money gains "Crew contracts & payments"; every panel on QueryState; Card + StatusBadge throughout | Crew-contract picker fixed (T-05); expense payee keeps its suggestions | Tabs scroll; money cards two across (already) |
| **4. Tasks** | New task vanishes (D-12); five-way status dropdown; four editable controls per phone row | DataTable list + Board; sheet with a Done/Undo primary button; status / assignee / priority as named controls | Assignee defaults to the creator from Mine | Row = text only, tap opens the sheet |
| **5. Calendar** | Unassigned work hidden by default | Unchanged layout; an "Unassigned (n)" chip in the Viewing menu | Quick create assigns to the cell's person (already) or to me | Agenda (already) |
| **6. Permits and inspections** | Raw type title; 13 tabs wrap | Title from the type label; one scrolling tab row; Overview first; inspections as a DataTable | Jurisdiction picker everywhere a jurisdiction is typed | Tab scroller |
| **7. Documents** | Works well (preview, missing state) | Keep it; move to DataTable for sort by date / type; Field wrapper on rename | — | Cards (already) |
| **8. Vendors and subcontractors** | Empty for reps, reading as "no data" (D-05) | QueryState refusal; DataTable directory; compliance as StatusBadge | Trade as a combobox | Cards |
| **9. Communications** | Notes and contact logging work; templates admin has 58 unnamed buttons | Activity feed unchanged; Message Templates on DataTable with row menus | Template picker fixed (T-05) | — |
| **10. Administration** | Icon-button grids; native confirms; raw enum labels | DataTable with ⋯ menus, ConfirmDialog, StatusBadge labels; PageHeader with breadcrumbs | All enum pickers labelled | Read-only lists on phones; editing is desktop-first |

## Navigation

The 11-entry sidebar (Sep 25) works; keep it. Three changes:

1. **Hide entries a role can't open.** Today a sales rep sees Personnel, Daily Logs and Referrals and is then refused (T-08).
2. **Shorten Admin.** Group it into People, Templates, Rules and Integrations. Its 18 entries currently scroll past the fold.
3. **Put the Call list on the dashboard for sales roles.** Today it is a toggle inside Leads.
