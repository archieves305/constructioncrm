"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Callout } from "@/components/shared/callout";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { FieldDayCard } from "@/components/field/field-day-card";
import { AddTaskDialog } from "@/components/tasks/add-task-dialog";
import { useUpdateTask } from "@/components/tasks/use-tasks";
import { rangeParams, useCalendarRange } from "@/components/calendar/use-calendar";
import { useSession } from "@/lib/auth/session-client";
import { itemsByDay } from "@/lib/calendar/agenda";
import { fieldDayLine, greeting, splitFieldDay } from "@/lib/calendar/field-day";
import type { CalendarItem } from "@/lib/calendar/types";
import { addDayKeys, dayKeyToLocalDate, isDayKey, todayKey } from "@/lib/time/zone";
import { cn } from "@/lib/utils";

/**
 * A crew lead's day: what is on, in order, with the things they do to a task
 * from a phone at the jobsite — start it, finish it, get there, call the
 * customer, take photos, tick the checklist. Reads the same calendar query
 * the office uses (`users=me`), so the office's dispatch board and this
 * screen never disagree. Not a replacement for /field/tasks, which stays the
 * bucketed backlog and the landing page for task emails.
 */
export default function FieldDayPage() {
  const { data: session } = useSession();
  const { get, setMany } = useSearchParamState();
  const today = todayKey();
  const urlDate = get("date");
  const day = isDayKey(urlDate) ? urlDate : today;
  const isToday = day === today;
  const canCreate = Boolean(session) && session?.user.role !== "READ_ONLY";

  const params = rangeParams({ from: day, to: day }, "me", { hideCompleted: false });
  const query = useCalendarRange(params, { enabled: Boolean(session) });
  const overdueQuery = useCalendarRange({ ...params, from: addDayKeys(today, -30), to: addDayKeys(today, -1), includeCompleted: false }, { enabled: Boolean(session) && isToday });
  const tomorrowQuery = useCalendarRange({ ...params, from: addDayKeys(day, 1), to: addDayKeys(day, 1), includeCompleted: false }, { enabled: Boolean(session) });

  const items = useMemo(() => itemsByDay(query.data?.items ?? [], { from: day, to: day }).get(day) ?? [], [query.data, day]);
  const plan = useMemo(() => splitFieldDay(items), [items]);
  const overdue = useMemo(() => (overdueQuery.data?.items ?? []).filter((i) => i.derived === "overdue"), [overdueQuery.data]);
  const tomorrow = useMemo(() => splitFieldDay(itemsByDay(tomorrowQuery.data?.items ?? [], { from: addDayKeys(day, 1), to: addDayKeys(day, 1) }).get(addDayKeys(day, 1)) ?? []), [tomorrowQuery.data, day]);

  const update = useUpdateTask();
  const [creating, setCreating] = useState(false);
  const [showTomorrow, setShowTomorrow] = useState(false);
  const [showDone, setShowDone] = useState(false);

  function patch(item: CalendarItem, status: "IN_PROGRESS" | "COMPLETED") {
    update.mutate(
      { id: item.id, patch: { status } },
      {
        onSuccess: () => toast.success(status === "COMPLETED" ? "Done" : "Started"),
        onError: (e: Error) => {
          // The evidence gate (checklist, photos, inspection) says what is missing; take them there.
          toast.error(e.message || "Couldn't update that task", {
            action: { label: "Open task", onClick: () => (window.location.href = `/field/tasks/${item.id}`) },
          });
        },
      },
    );
  }

  const go = (k: string) => setMany({ date: k === today ? null : k });
  const d = dayKeyToLocalDate(day);
  const hour = new Date().getHours();

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold">{isToday ? greeting(hour, session?.user.firstName ?? "") : format(d, "EEEE")}</h1>
        <p className="text-sm text-muted-foreground">
          {format(d, "EEEE, MMMM d")} · {query.data ? fieldDayLine(plan) : "…"}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => go(addDayKeys(day, -1))} aria-label="Previous day">
          <ChevronLeft className="size-5" />
        </Button>
        <Button variant="outline" className="h-11 flex-1" onClick={() => go(today)} disabled={isToday}>
          Today
        </Button>
        <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => go(addDayKeys(day, 1))} aria-label="Next day">
          <ChevronRight className="size-5" />
        </Button>
        {canCreate && (
          <Button className="h-11" onClick={() => setCreating(true)} aria-label="Add a task on this day">
            <Plus className="size-4" /> Task
          </Button>
        )}
      </div>

      {isToday && overdue.length > 0 && (
        <Callout tone="danger" title={`${overdue.length} overdue ${overdue.length === 1 ? "task" : "tasks"} from earlier days`}>
          <ul className="mt-2 space-y-2">
            {overdue.map((i) => (
              <FieldDayCard key={i.id} item={i} day={day} busy={update.isPending} onStart={(it) => patch(it, "IN_PROGRESS")} onDone={(it) => patch(it, "COMPLETED")} />
            ))}
          </ul>
        </Callout>
      )}

      {plan.events.length > 0 && (
        <section className="rounded-lg border border-dashed border-tone-info/50 bg-tone-info-soft/40 px-3 py-2" aria-label="Also on this day">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-tone-info-fg">
            <CalendarClock className="size-3.5" /> Also {isToday ? "today" : "this day"}
          </h2>
          <ul className="mt-1 divide-y divide-tone-info/20">
            {plan.events.map((e) => (
              <li key={e.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{e.allDay || !e.start ? "All day" : format(new Date(e.start), "h:mm a")}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{e.overlay?.label}{e.overlay?.detail ? ` · ${e.overlay.detail}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {query.isPending ? (
        <ListSkeleton rows={3} />
      ) : query.isError ? (
        <Card>
          <CardContent className="space-y-2 py-8 text-center text-muted-foreground">
            <p>Couldn&apos;t load your day.</p>
            <Button variant="outline" onClick={() => query.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : plan.total === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nothing scheduled {isToday ? "today" : "this day"}.{" "}
            <Link href="/field/tasks" className="text-blue-700 underline">
              See all my tasks
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="space-y-2" aria-label={`Tasks on ${format(d, "EEEE, MMMM d")}`}>
            {plan.remaining.map((i) => (
              <FieldDayCard key={i.id} item={i} day={day} busy={update.isPending} onStart={(it) => patch(it, "IN_PROGRESS")} onDone={(it) => patch(it, "COMPLETED")} />
            ))}
          </ul>
          {plan.done.length > 0 && (
            <section>
              <button type="button" onClick={() => setShowDone((s) => !s)} className="flex h-11 w-full items-center justify-between px-1 text-sm font-semibold text-muted-foreground" aria-expanded={showDone}>
                <span>Done · {plan.done.length}</span>
                <ChevronDown className={cn("size-4 transition-transform", showDone && "rotate-180")} />
              </button>
              {showDone && (
                <ul className="space-y-2">
                  {plan.done.map((i) => (
                    <FieldDayCard key={i.id} item={i} day={day} busy={update.isPending} onStart={(it) => patch(it, "IN_PROGRESS")} onDone={(it) => patch(it, "COMPLETED")} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      <section className="rounded-lg border bg-white">
        <button type="button" onClick={() => setShowTomorrow((s) => !s)} className="flex h-12 w-full items-center justify-between px-3 text-sm font-semibold" aria-expanded={showTomorrow}>
          <span>
            {isToday ? "Tomorrow" : format(dayKeyToLocalDate(addDayKeys(day, 1)), "EEEE")} <span className="font-normal text-muted-foreground">· {tomorrow.remaining.length === 0 ? "nothing yet" : `${tomorrow.remaining.length} ${tomorrow.remaining.length === 1 ? "task" : "tasks"}`}</span>
          </span>
          <ChevronDown className={cn("size-4 transition-transform", showTomorrow && "rotate-180")} />
        </button>
        {showTomorrow && tomorrow.remaining.length > 0 && (
          <ul className="divide-y border-t">
            {tomorrow.remaining.map((i) => (
              <li key={i.id}>
                <Link href={`/field/tasks/${i.id}`} className="block px-3 py-2.5 text-sm active:bg-gray-50">
                  <span className="font-medium">{i.title}</span>
                  {!i.allDay && i.start && <span className="ml-2 text-xs text-muted-foreground">{format(new Date(i.start), "h:mm a")}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AddTaskDialog open={creating} onOpenChange={setCreating} allowJobPicker defaults={{ dueAt: day, assignedUserId: session?.user.id }} onCreated={() => setCreating(false)} />
    </div>
  );
}
