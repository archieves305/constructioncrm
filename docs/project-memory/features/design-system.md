# Feature — Design tokens, stage colours and the kanban kit

_Built and deployed 2026-09-24 (`e867c5e`) as Stage 3 of the tasks work. Light mode only: `.dark`
tokens exist but nothing toggles them._

## Tokens (`src/app/globals.css`)

- **Brand: steel blue** (`--brand oklch(0.46 0.11 250)`, `--brand-soft`,
  `--brand-fg`, `--brand-foreground`). `--primary` deliberately stays
  neutral so every default button does not recolour; use `Button
  variant="brand"` for the one primary action on a page. `--ring` is brand.
- **Tones** `neutral | info | warning | danger | success`, each as solid /
  `-soft` (tinted background) / `-fg` (text on soft). `src/lib/ui/tones.ts`
  `toneClasses(tone)` returns complete class strings.
- **Stages** `--stage-0..4` (indigo → blue → teal → gold → orange) plus
  `--stage-done` (= success), `--stage-lost` (= danger), `--stage-hold`
  (= neutral). Every one is registered as `--color-*` in `@theme inline`, so
  `bg-stage-2-soft`, `text-tone-danger-fg`, `bg-brand/10` are real utilities.

**Tailwind v4 rule:** class names must be complete literals in source. The
helpers return strings from lookup tables; never build `bg-stage-${i}`.

## Stage colour algorithm (`src/lib/ui/stage-colors.ts`, tested)

Stages are DB rows, so a name-keyed colour map rots. `stageToneKey(stage,
all)`: `isLost → lost; isClosed|isWon → done; "On Hold" → hold; unknown →
neutral; else phase = floor(index among open stages × 5 / openCount)`.
Neighbours share a colour on purpose; an open stage never turns green or
red. `stageTone(stageOrName, all)` → `{ bar, dot, pill, text, ring, solid }`;
`buildStageToneMap(all)` for lists. Consumers: `StageBadge` (pass `stages`
or it is neutral), `StagePillSelect`, `StageStepper`, both boards.

## Kanban kit (`src/components/kanban/`)

`KanbanBoard<T>` owns sensors (Mouse 6px + Touch 180ms + Keyboard with a
column-hopping coordinate getter), collision (`pointerWithin` →
`rectIntersection` → `closestCenter`), the drag ghost, collapsed columns
(`useSyncExternalStore` over localStorage, keyed by `boardId`) and empty
columns. Callers pass `columns` (`KanbanColumnDef` with a `tone`), `items`,
`getColumnId`, `renderCard`, `onMove`, optional `canMove` / `onOpen` /
`dragHandle`. `useOptimisticMove` is the react-query move-then-confirm
pattern lifted from the old pipeline page. **Keyboard:** Tab to a card,
Space picks up, ←/→ hop columns (scrolled into view), Space drops, Esc
cancels, Enter opens. The card chains dnd-kit's `onKeyDown` before its own —
overriding it silently kills keyboard drag.

Boards on it: `/production` (all job stages from the DB, `Closed` collapsed
by default, aggregate = contract total · overdue tasks), `/pipeline` (open
lead stages, On Hold last and collapsed, urgent count), the tasks board
(status columns, grip handle, BLOCKED refuses without a reason and opens the
sheet). Cards: `jobs/job-board-card.tsx`, `leads/lead-board-card.tsx`.
`/api/jobs` and `/api/leads` lists include the latest `stageHistory` row so
cards can say "6d in stage".

**Scope + calm (2026-09-25).** Every board and list opens on **Mine** —
`useListScope()` (`components/shared/use-list-scope.ts`) resolves URL
`?scope` > `User.defaultListScope` > MINE and gates the query on `ready`
so there is no Mine→All flash; `setScope` writes both the URL and the
preference. "Mine" is one helper, `jobsInvolvingUserWhere` /
`leadsInvolvingUserWhere` (`lib/jobs/involvement.ts`), and the role floor
(`lib/lists/scope.ts`: SALES_REP, CREW_LEAD) cannot be escaped with
`?scope=all`; the API default stays `all` for the pickers. `BoardToolbar`
(Mine/All, search, page filters, density, Columns menu backed by
`setAll` / `expandAll` on the collapse store) sits above the board;
`KanbanBoard` takes `maxVisiblePerColumn` (25, "Show N more" per column,
reset via `resetKey`), `density` (passed to `renderCard`; cards have a
compact variant), `notice` (the "Showing 500 of N" callout) and
`KanbanColumnDef.limit` (WIP tone). Mine with nothing on it renders an
`EmptyState` whose action flips to All.

## Record pages

`shared/entity-header.tsx` (breadcrumb, title, subtitle, badges, actions,
children) + `shared/stage-stepper.tsx` (pill track; click → confirm dialog
with a backwards warning and a per-entity note; Won/Closed marks the whole
progression done). Job detail groups its 14 panels into **Money · Field ·
Permits · Tasks · Files · History** with a `SegmentedControl` sub-row for
Money and Field; `?tab=money&sub=invoices` in the URL owns the selection so
email links keep landing. The `*-panel.tsx` files were not touched. KPI
tiles use `KpiCard` (`href`, `tone`, `children` for the deposit `Progress`).

## Primitives added

`ui/progress.tsx` (`indicatorClassName`), `ui/skeleton.tsx`,
`ui/segmented-control.tsx` (plain radio buttons, never clears on re-click),
`ui/dropdown-menu.tsx` (shadcn base-nova over Base-UI Menu — **the CLI
added a bogus `cn` npm package and imported from it; both reverted**),
`shared/empty-state.tsx`, `shared/stage-pill-select.tsx`,
`jobs/permit-badge.tsx`, `Table containerClassName` (sticky headers need the
outer div to be the scroll container), `PageHeader.description` is now a
ReactNode.

## Lists

Jobs and leads: sticky header, `h-12` rows, `Checkbox` primitive,
`StagePillSelect`, `TaskCountBadge`, avatar in the rep/assignee select,
`Progress` for deposit, `PermitBadge`, `Skeleton` rows while loading,
`EmptyState` when nothing matches; the deliberate error state from `8120951`
stays.

## Gotchas found

- Running `next build` while `next dev` is up shares `.next` and served a
  stale CSS bundle with none of the new tokens; restart dev after a build.
- The Chrome tool's `left_click_drag` does not activate dnd-kit's mouse
  sensor; keyboard drag is the reliable automated check.
