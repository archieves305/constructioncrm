# Operations Calendar

_Plan: `~/.claude/plans/woolly-swinging-mist.md` (approved 2026-09-27). Four
phases, each deployed and click-through'd before the next. This page tracks
what is built. **Phase 1 deployed 2026-09-28 as `08e9355`, BUILD_ID
`sMd5qs7fP1qWl0vxJLB14`, migration applied and CHECK verified on prod.**_

## Purpose

One screen that answers "what am I working on today, where, when, what's
next" for everyone, and "who is doing what, what is unscheduled, where are
the conflicts" for the office. Field-friendly first, dispatch-capable second.

## The model: one date axis

A task has **one** date axis. `dueAt` is both the deadline every list, digest
and escalation already reads **and** the day the task sits on the calendar.
Two columns describe more (migration `20261006120000_task_scheduling`):

| Shape | `allDay` | `scheduledStart` | `dueAt` |
|---|---|---|---|
| All-day, one day (every pre-calendar row) | `true` | `null` | noon-UTC pin (manual) or 17:00 (engine) |
| Multi-day span | `true` | pin of the first day | pin of the last day |
| Timed | `false` | the start instant | **the end instant** |

There is deliberately no `scheduledEnd`: it would always equal `dueAt`, and a
column that must mirror another drifts. Keeping `dueAt` as the end means
overdue, the digest, `dueBucket`, escalation, `dueLocked` and list sorting all
keep working with no new code, and timed tasks sort in time order within a
day. A CHECK constraint (`tasks_schedule_window_chk`) backs the invariants.

**Every writer goes through `applySchedule()`** (`src/lib/calendar/schedule.ts`,
pure, tested) inside `updateTask` / the POST route:

- `dueAt: "yyyy-MM-dd"` = "put it on this day": a timed window or a span
  moves with it, keeping local clock times across DST (`addLocalDays`).
- `dueAt: <ISO>` = "end exactly then".
- `scheduledStart` alone moves the start; the end follows keeping the length
  if the start passes it. `allDay:false` alone gives 9:00–10:00 on the due day;
  `allDay:true` re-pins the day and drops the time.
- `dueAt: null` clears the window. A start with no due date is refused.
- Escalation resets only when the **day** changes; a same-day window edit is
  not a new deadline. Any window edit on a workflow step sets `dueLocked`, so
  the engine never slides `dueAt` out from under a window.
- Timeline: `DUE_CHANGED` as before, plus `SCHEDULE_CHANGED` (`{start,end,allDay}`
  JSON) when the window or the flag moves.

## Time zone

`src/lib/time/zone.ts`: `APP_TIME_ZONE = "America/New_York"` (a client-safe
constant, no env), `dayKey`, `startOfDayIn`/`endOfDayIn`, `addLocalDays`,
`weekRange` (Monday), `monthRange` (42-day grid), `pinAllDay` (= `parseDueAt`).
`nurture/time.ts` re-exports the primitives it used to own.

Fixed on the way (all three were server-local or UTC-slice and only worked
because the droplet runs UTC): the morning digest's day boundaries
(`reminders.ts`), `daysOverdue` / the escalation planner (`due-dates.ts`,
`escalations.ts`), and the task card's date input (`dayKey`, not
`dueAt.slice(0,10)`).

**Overdue is one rule now** — `overdueWhere(now)` / `isOverdue` in
`src/lib/calendar/status.ts`: an all-day task is late after the end of its
day in the office's zone; a timed task after its end. `buildTaskListWhere`
(`?overdue=1`), `/api/field/today` and the dashboard KPI use it. **Visible
change: the dashboard Overdue tile no longer counts items due today**
(before, a noon-UTC pin read as overdue from 8:01 ET).

## Read side

- `GET /api/calendar?from&to&users&jobId&status&priority&q&includeCompleted`
  → `{ range:{from,to,timeZone}, truncated, items }`. `from`/`to` are day keys
  (≤ 62 days). An item is in range when `[scheduledStart ?? dueAt, dueAt]`
  touches it. Default: open + activated (never the 639 inactive steps).
  Cap 2000 + `truncated`. `users` = `me` | `all` | `id,id[,unassigned]`,
  coerced server-side by `coerceUsersParam` — own-only roles (SALES_REP,
  CREW_LEAD, **and MARKETING**, unlike the lists' floor) always get `me`;
  `taskVisibilityFilter` is ANDed last regardless.
- `GET /api/calendar/unscheduled?users&jobId&q` → active, open, `dueAt null`.
- `CalendarItem` (`src/lib/calendar/types.ts`, no runtime imports): ISO
  strings plus server-computed `dayKey`/`startDayKey` so a browser in another
  zone puts the card where the office does; `kind: "task"` is the seam for
  read-only overlays and an ICS/Google exporter later.
- `/api/tasks` gained `dueFrom`/`dueTo`/`unscheduled`/`unassigned`, and its
  search block is the shared `taskSearchWhere`.
- Access (`src/lib/calendar/access.ts`): `canViewAllCalendars = seesAllTasks`
  (imported, not re-listed); `DISPATCH_ROLES` = ADMIN, MANAGER, OFFICE_STAFF;
  scheduling and reassigning stay `canEditTask`.

## UI (Phase 1)

`/calendar` (`src/components/calendar/*`; sidebar entry replaced the unused
`Schedule` grid — `/schedule` redirects, `PUT /api/jobs/[id]/schedule` deleted).
URL owns `view=day|week|month`, `date`, `users`, `job`, `status`, `priority`,
`q`, `completed=0`, `task=<id>` (same contract as `/tasks?task=`).

- Default view: `User.defaultCalendarView` (Settings → Lists & boards), phones
  always open on Day. `users` defaults from `defaultListScope` (ALL → everyone).
- Week: seven equal columns of cards, today tinted + `aria-current`, per-day
  counts, "Show N more" at 25, spans drawn on every day they cover.
- Day: All day / Morning / Afternoon / Evening bands with a time rail;
  overdue callout on today; "+ at 8:00 …" chips seed a timed task.
- Month: counts only, tone = worst state (overdue > blocked > busy > done),
  click → Day. Phone week = a 7-pill `DayStrip` over the day agenda.
- `CalendarTaskCard`: address → title → time/All day + avatar → pills only
  when unusual (Overdue, Blocked, Done, Waiting on N, checklist, notes).
  Priority dot has sr-only text; nothing is colour-only.
- `TaskDetailSheet` gained `ScheduleSection` (day presets, All day, start/end
  — `TouchTimeField` on phones, multi-day "Starts"), an editable assignee,
  Open job / Directions / Call links, `fetchJson`, the shared task
  invalidation fan-out (`["calendar"]` joined `RELATED_KEYS`), and opens from
  the bottom on phones (`useIsPhone`).
- `AddTaskDialog.defaults` gained `scheduledStart` / `allDay` / `jobId` and an
  All day + Start/End row.
- Keyboard: ← → previous/next, `t` today, `n` new task. Prefetches the
  adjacent range; `keepPreviousData` on navigation.

## Dispatch (Phase 2, built 2026-09-28 on `calendar-dispatch`)

**Drag and drop.** One `DndContext` (`components/calendar/calendar-dnd.tsx`)
wraps every view and the rail, on the kanban kit's sensors — extracted to
`components/kanban/sensors.ts` (`useKitSensors`, `kitCollision`; the board
consumes them, `KanbanCard` gained `disabled`). The calendar passes
`enterOpens` so **Space picks up and Enter still opens**; arrows walk the
droppables by geometry (`lib/calendar/grid-nav.ts`: `nearestInDirection`,
`containerAt`), Space drops, Escape cancels, with announcements. The page's
own ←/→/t/n hotkeys stand down while a card is `aria-pressed`.

**Pure rules** (all tested):
- `drop-target.ts` — `day:<key>`, `slot:<key>THH:mm`, `cell:<userId|unassigned>::<key>`,
  `unscheduled`; `dropId` / `parseDropId` round-trip.
- `move.ts` — `movePatch(item, target)`: day → `{dueAt: key}` (the server keeps
  the window), slot → `{allDay:false, scheduledStart, dueAt}` keeping the old
  length or 60 min, cell → day and/or `assignedUserId` (only what differs),
  rail → `{dueAt:null}`; **null when nothing would change** (no PATCH, no toast,
  no mail). `canMove` = closed tasks never; `canEditTask`; cross-person or
  to-rail drops need dispatch (ADMIN / MANAGER / OFFICE_STAFF). `applyMove`
  paints the optimistic item through the same `applySchedule` the route runs.
  `describeMove` is the toast ("Assigned to Lisette · Tue, Sep 29").
- `conflicts.ts` — same assignee, both timed, open, windows overlap, self and
  duplicates excluded; all-day and unassigned never conflict.
- `people.ts` — lanes = the Viewing selection (Everyone → Unassigned + every
  active user; a picked set → those, + Unassigned when ticked; My calendar →
  one lane), busiest first, ties by name; `workloadOf` → "9 tasks · 6.5 h timed".

**Client.** `DropZone` (tint when it may take the card, hatching +
`aria-disabled` when `canMove` says no), `DraggableCard` (decides `canDrag`
once; a span's copies get `<id>@<day>` ids), `useMoveTask` (snapshots every
`["calendar"]` query — range, prefetched neighbours, rail — repaints them with
`applyMove`, restores all on failure with the server's message, invalidates
tasks / summary / detail / field-today / dashboard on settle),
`ConflictDialog` ("Schedule anyway?" over `ConfirmDialog`, warn-not-block),
`PeopleView` (real `<table>`, sticky person column with the workload footer,
4 compact cards per cell then "+N more", hover "+ Add" prefilled with the
person and day), `UnscheduledPanel` (w-72 rail grouped by job, collapsible to
a slim strip that is still a drop target; remembered in `localStorage`
`calendar:rail` via `useSyncExternalStore`, default open in People and closed
elsewhere). Week columns, Day bands (All day → the day; Morning / Afternoon /
Evening → 8:00 / 13:00 / 17:00) and Month cells are drop zones. `?view=people`
is dispatch-only and desktop-only (others fall back to Week / Day). Phones
never drag; the sheet is the reschedule path.

**Server.** `updateTask` refuses a new assignee who is inactive or unknown
(400, hint `assignedUserId`) — one lookup, only when the assignee changes to
someone.

## Not yet (later phases)

Phase 3 field (`/field/day`, quick actions, Today widget). Phase 4
overlays (permit inspections, hearings, job starts as read-only
`CalendarItem.kind`s), "schedule changed" digest line, ⌘K task search,
timed-hours workload. Deferred with the seam documented: crews / personnel
lanes, a `Task.kind` for appointments, recurrence, external sync columns.

## QA recipe

`scratchpad/qa-calendar.js` (playwright-core, headless shell, cookie
`careyos_session=dev`): creates four `QA:` tasks self-assigned to the bypass
user (no mail), checks the API (range, unscheduled, PATCH moves, 400s,
timeline), screenshots Week/Day/Month/sheet/everyone/empty at 1280 and Day/
Week-strip/sheet at 390, checks `/schedule` → `/calendar`, deletes the tasks.
`qa-rep.js` with the server restarted as `john.rep` checks the coercion.

Phase 2: `scratchpad/qa-dispatch.js` (same harness; `page.mouse` drags with a
12 px lift and 20 steps) — rail → John/Tue (assigned + dated, toast), cell →
Unassigned/Thu, cell → rail (day cleared), Week Tue → Thu, same-day drop sends
no PATCH, keyboard Space → → → Space, Escape puts the card down, Enter opens
the sheet, a 1.5 s-delayed mocked 500 paints then snaps back with the error
toast, Day-band drop onto an overlapping window opens the conflict dialog
(nothing saved until "Schedule anyway"; then 8:00–9:00 with `SCHEDULE_CHANGED`),
Afternoon band keeps a 2 h length, cell "+ Add" prefills the person, phone
hides People / rail and answers `?view=people` with the day, unknown assignee
→ 400. 28/28 on 2026-09-28.
