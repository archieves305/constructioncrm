"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { useDebouncedValue } from "@/components/shared/use-debounced-value";
import { useIsPhone } from "@/components/shared/use-media-query";
import { useMePreferences } from "@/components/shared/use-list-scope";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { AddTaskDialog, type AddTaskDialogProps } from "@/components/tasks/add-task-dialog";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { useAssignableUsers } from "@/components/tasks/use-tasks";
import { useSession } from "@/lib/auth/session-client";
import { canDispatch, canViewAllCalendars, coerceUsersParam } from "@/lib/calendar/access";
import { itemsByDay, summarizeCalendarItems } from "@/lib/calendar/agenda";
import { peopleRows } from "@/lib/calendar/people";
import { CALENDAR_CAP } from "@/lib/calendar/query";
import {
  activeFilterCount,
  rangeForView,
  readFilters,
  resolveDate,
  resolveUsers,
  resolveView,
  shiftAnchor,
  type CalendarFilters,
  type CalendarView,
} from "@/lib/calendar/url-state";
import { addDayKeys, atLocalTime, dayKey, monthRange, todayKey, type DayKey } from "@/lib/time/zone";
import { CalendarDnd } from "./calendar-dnd";
import { CalendarHeader } from "./calendar-header";
import { CalendarEmpty, CalendarErrorState, CalendarSkeleton, TruncatedNotice } from "./calendar-states";
import { CalendarSummary } from "./calendar-summary";
import { CalendarToolbar } from "./calendar-toolbar";
import { DayStrip } from "./day-strip";
import { DayView } from "./day-view";
import { MonthView } from "./month-view";
import { PeopleView } from "./people-view";
import { UnscheduledPanel, useRailCollapsed } from "./unscheduled-panel";
import { rangeParams, useCalendarRange, usePrefetchAdjacent, useUnscheduled } from "./use-calendar";
import { ViewingSelector } from "./viewing-selector";
import { WeekView } from "./week-view";

/**
 * The Calendar page. The URL owns view, day, people and filters, so a copied
 * link reproduces the screen and ‹ › are just URL writes. Everything the
 * page shows comes from one range query; the sheet and the dialog are the
 * same components every other page uses.
 */
export function CalendarPage() {
  const { data: session } = useSession();
  const role = session?.user.role ?? null;
  const userId = session?.user.id ?? "";
  const isPhone = useIsPhone();
  const { get, setMany } = useSearchParamState();
  const { data: prefs, isLoading: prefsLoading } = useMePreferences();
  const { data: users = [] } = useAssignableUsers();
  const today = todayKey();

  const urlView = get("view");
  const urlUsers = get("users");
  const dispatch = canDispatch(role);
  const resolved = resolveView({ url: urlView, pref: prefs?.defaultCalendarView ?? null, isPhone });
  // People is the dispatch board; anyone else asking for it gets the week it covers.
  const view: CalendarView = resolved === "people" && !dispatch ? "week" : resolved;
  const anchor = resolveDate(get("date"), today);
  const usersParam = resolveUsers({ url: urlUsers, pref: prefs?.defaultListScope ?? null, role });
  const filters = readFilters(get);
  const range = rangeForView(view, anchor);
  const mine = usersParam === "me";
  const viewAll = role ? canViewAllCalendars(role) : false;
  const canCreate = Boolean(role) && role !== "READ_ONLY";
  // Drag lives on desktops; a phone reschedules through the sheet. READ_ONLY never drags.
  const dragEnabled = !isPhone && canCreate;
  const actor = role ? { id: userId, role } : null;
  const showRail = dispatch && !isPhone;
  const [railCollapsed, toggleRail] = useRailCollapsed(view !== "people");

  // Don't fetch on the guessed defaults while the preference is still loading
  // (a Mine→All flash); the URL or a floored role settles it immediately.
  const ready = Boolean(session) && (Boolean(urlView && urlUsers) || !prefsLoading || !viewAll);

  const params = rangeParams(range, usersParam, filters);
  const query = useCalendarRange(params, { enabled: ready });
  usePrefetchAdjacent(
    params,
    [rangeForView(view, shiftAnchor(view, anchor, -1)), rangeForView(view, shiftAnchor(view, anchor, 1))],
    ready && query.isSuccess,
  );

  // Overdue work from earlier days, for today's agenda only.
  const showOverdue = view === "day" && anchor === today;
  const overdueQuery = useCalendarRange(
    { ...params, from: addDayKeys(today, -30), to: addDayKeys(today, -1), includeCompleted: false },
    { enabled: ready && showOverdue },
  );
  const overdue = useMemo(() => (overdueQuery.data?.items ?? []).filter((i) => i.derived === "overdue"), [overdueQuery.data]);

  const unscheduled = useUnscheduled(usersParam, { enabled: ready && dispatch });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const byDay = useMemo(() => itemsByDay(items, range), [items, range]);
  const summary = useMemo(() => summarizeCalendarItems(items), [items]);
  const unscheduledItems = useMemo(() => unscheduled.data?.items ?? [], [unscheduled.data]);
  // Conflicts and announcements look at everything loaded, rail included.
  const allItems = useMemo(() => [...items, ...unscheduledItems], [items, unscheduledItems]);
  const people = useMemo(() => users.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName })), [users]);
  const lanes = useMemo(() => (role ? peopleRows(items, users, coerceUsersParam(usersParam, role), userId) : []), [items, users, usersParam, role, userId]);

  // Search: typed locally, written to the URL once it settles.
  const [search, setSearch] = useState(get("q") ?? "");
  const debounced = useDebouncedValue(search.trim(), 300);
  useEffect(() => {
    if ((get("q") ?? "") !== debounced) setMany({ q: debounced || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  function setFilters(patch: Partial<CalendarFilters>) {
    setMany({
      job: patch.job === undefined ? undefined : patch.job || null,
      status: patch.status === undefined ? undefined : patch.status || null,
      priority: patch.priority === undefined ? undefined : patch.priority || null,
      completed: patch.hideCompleted === undefined ? undefined : patch.hideCompleted ? "0" : null,
    });
  }
  function clearFilters() {
    setSearch("");
    setMany({ job: null, status: null, priority: null, completed: null, q: null });
  }

  const setView = (v: CalendarView) => setMany({ view: v });
  const goTo = (k: DayKey) => setMany({ date: k });
  const prev = () => goTo(shiftAnchor(view, anchor, -1));
  const next = () => goTo(shiftAnchor(view, anchor, 1));

  // The task sheet is a URL param, like /tasks?task=, so mailed links land here too.
  const openTaskId = get("task");
  const openTask = (id: string | null) => setMany({ task: id });

  // Quick create, seeded from where it was asked for: a day, an hour, a person's lane.
  const [creating, setCreating] = useState<AddTaskDialogProps["defaults"] | null>(null);
  function addOn(day: DayKey, hour: number | null = null, assignee?: string | null) {
    const assignedUserId = assignee !== undefined ? assignee ?? undefined : mine ? userId : undefined;
    const defaults: AddTaskDialogProps["defaults"] = { dueAt: day, assignedUserId };
    if (hour !== null) {
      defaults.allDay = false;
      defaults.scheduledStart = atLocalTime(day, hour, 0).toISOString();
    }
    setCreating(defaults);
  }

  // ← → t n, when nothing else has the keyboard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || t.closest("[role=dialog]"))) return;
      // A card picked up with Space owns the arrow keys until it is dropped (dnd-kit marks it aria-pressed).
      if (t?.getAttribute("aria-pressed") === "true") return;
      if (openTaskId || creating) return;
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "t") goTo(today);
      else if (e.key === "n" && canCreate) addOn(view === "day" ? anchor : today);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, anchor, today, openTaskId, creating, canCreate]);

  const periodLabel = `${mine ? "My" : "This"} ${view === "people" ? "week" : view}`;
  const showAssignee = !mine;
  const loading = !ready || (query.isPending && !query.data);

  let body: React.ReactNode;
  if (query.isError) body = <CalendarErrorState onRetry={() => query.refetch()} />;
  else if (loading) body = <CalendarSkeleton view={view} />;
  else if (view === "people") {
    // Empty lanes are where work gets dropped, so People never shows the empty state.
    body = <PeopleView range={range} rows={lanes} today={today} onOpen={openTask} onAddOn={canCreate ? (d, uid) => addOn(d, null, uid) : undefined} />;
  } else if (items.length === 0 && view !== "month" && !(showOverdue && overdue.length > 0)) {
    body = <CalendarEmpty view={view} mine={mine} canCreate={canCreate} onCreate={() => addOn(view === "day" ? anchor : today)} unscheduledCount={dispatch && !showRail ? unscheduledItems.length : 0} />;
  } else if (view === "month") {
    body = <MonthView grid={monthRange(anchor)} byDay={byDay} today={today} onPickDay={(k) => setMany({ view: "day", date: k })} />;
  } else if (view === "day") {
    body = <DayView day={anchor} items={byDay.get(anchor) ?? []} overdue={showOverdue ? overdue : []} onOpen={openTask} onAddAt={canCreate ? addOn : undefined} showAssignee={showAssignee} />;
  } else if (isPhone) {
    // A phone's week is a strip of days over one day's agenda.
    const selected = anchor >= range.from && anchor <= range.to ? anchor : range.from;
    body = (
      <>
        <DayStrip range={range} selected={selected} today={today} byDay={byDay} onSelect={goTo} />
        <DayView day={selected} items={byDay.get(selected) ?? []} onOpen={openTask} onAddAt={canCreate ? addOn : undefined} showAssignee={showAssignee} />
      </>
    );
  } else {
    body = <WeekView range={range} byDay={byDay} today={today} onOpen={openTask} onAddOn={canCreate ? (d) => addOn(d) : undefined} showAssignee={showAssignee} />;
  }

  return (
    <div>
      <PageHeader
        title="Calendar"
        description={query.data ? <CalendarSummary label={periodLabel} summary={summary} className="mt-1" /> : "What is on today, this week and this month."}
      />

      <CalendarHeader
        view={view}
        onViewChange={setView}
        anchor={anchor}
        onPrev={prev}
        onNext={next}
        onToday={() => goTo(today)}
        onPickDate={goTo}
        isToday={anchor === today}
        viewing={viewAll && userId ? <ViewingSelector value={usersParam} onChange={(u) => setMany({ users: u })} users={users} currentUserId={userId} /> : undefined}
        onNewTask={canCreate ? () => addOn(view === "day" ? anchor : today) : undefined}
        showPeople={dispatch && !isPhone}
      />

      <CalendarToolbar search={search} onSearchChange={setSearch} filters={filters} onFiltersChange={setFilters} onClear={clearFilters} />

      {query.data?.truncated && <TruncatedNotice cap={CALENDAR_CAP} />}
      {activeFilterCount(filters) > 0 && items.length === 0 && !loading && !query.isError && view !== "month" ? (
        <p className="mb-3 text-xs text-muted-foreground">Nothing matches these filters.</p>
      ) : null}

      <CalendarDnd enabled={dragEnabled} actor={actor} dispatch={dispatch} people={people} items={allItems} onOpen={openTask}>
        <div className="flex items-stretch gap-3">
          {showRail && (
            <UnscheduledPanel
              items={unscheduledItems}
              truncated={Boolean(unscheduled.data?.truncated)}
              isLoading={unscheduled.isPending}
              collapsed={railCollapsed}
              onToggle={toggleRail}
              onOpen={openTask}
              showAssignee={!mine}
            />
          )}
          <div className="min-w-0 flex-1">{body}</div>
        </div>
      </CalendarDnd>

      <TaskDetailSheet taskId={openTaskId} users={users} currentUserId={userId} isAdmin={role === "ADMIN"} onClose={() => openTask(null)} />

      <AddTaskDialog
        open={creating !== null}
        onOpenChange={(o) => !o && setCreating(null)}
        allowJobPicker
        defaults={creating ?? undefined}
        onCreated={(t) => {
          setCreating(null);
          // Land on the day the new task went to, so it is on screen.
          if (t.dueAt) goTo(dayKey(new Date(t.dueAt)));
        }}
      />
    </div>
  );
}
