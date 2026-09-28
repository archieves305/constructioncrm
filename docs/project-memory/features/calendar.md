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

## Not yet (later phases)

Phase 2 dispatch (People view, Unscheduled rail, drag with the kanban
sensors, conflicts warn-not-block, quick create per cell, inactive-assignee
check). Phase 3 field (`/field/day`, quick actions, Today widget). Phase 4
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
