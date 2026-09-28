"use client";

import { useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowRight, CalendarDays, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PRIORITY_DOT_CLASS } from "@/components/tasks/task-colors";
import { useSession } from "@/lib/auth/session-client";
import { itemsByDay } from "@/lib/calendar/agenda";
import { fieldDayLine, splitFieldDay } from "@/lib/calendar/field-day";
import type { CalendarItem } from "@/lib/calendar/types";
import { todayKey } from "@/lib/time/zone";
import { cn } from "@/lib/utils";
import { contextLine, whenLine } from "./calendar-task-card";
import { rangeParams, useCalendarRange } from "./use-calendar";

const LIMIT = 6;

/**
 * Dashboard card: my day, in time order — the same query the Calendar's Day
 * view and /field/day run (`users=me`, from = to = today), so all three
 * agree. Rows open the task on the calendar.
 */
export function TodayWidget({ className }: { className?: string }) {
  const { data: session } = useSession();
  const today = todayKey();
  const params = rangeParams({ from: today, to: today }, "me", { hideCompleted: false });
  const query = useCalendarRange(params, { enabled: Boolean(session) });
  const items = useMemo(() => itemsByDay(query.data?.items ?? [], { from: today, to: today }).get(today) ?? [], [query.data, today]);
  const plan = useMemo(() => splitFieldDay(items), [items]);
  const rows = [...plan.remaining, ...plan.done];

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="size-4 text-muted-foreground" />
          Today
          {query.data && <span className="text-sm font-normal text-muted-foreground">{fieldDayLine(plan)}</span>}
        </CardTitle>
        <Link href={`/calendar?view=day&users=me&date=${today}`} className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
          Open calendar <ArrowRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <ListSkeleton rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Nothing on your calendar today" description={`It is ${format(new Date(), "EEEE, MMMM d")}. Anything you give a date shows up here.`} />
        ) : (
          <>
            <ul className="divide-y rounded-md border">
              {rows.slice(0, LIMIT).map((i) => (
                <Row key={i.id} item={i} today={today} />
              ))}
            </ul>
            {rows.length > LIMIT && (
              <Link href={`/calendar?view=day&users=me&date=${today}`} className="mt-1 inline-block text-xs text-muted-foreground hover:underline">
                +{rows.length - LIMIT} more
              </Link>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ item, today }: { item: CalendarItem; today: string }) {
  const closed = item.status === "COMPLETED" || item.status === "CANCELLED";
  const overdue = item.derived === "overdue";
  return (
    <li className={cn("flex items-center gap-2.5 px-3 py-2", closed && "opacity-60")}>
      <span className={cn("w-16 shrink-0 text-xs tabular-nums", item.allDay ? "text-muted-foreground/70" : "text-gray-700")}>{item.allDay || !item.start ? "All day" : format(new Date(item.start), "h:mm a")}</span>
      <span className={cn("size-2 shrink-0 rounded-full", PRIORITY_DOT_CLASS[item.priority])} />
      <Link href={`/calendar?view=day&users=me&date=${today}&task=${item.id}`} className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-medium hover:underline", closed && "line-through")}>{item.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{contextLine(item)}</span>
      </Link>
      <span className={cn("hidden shrink-0 items-center gap-1 text-xs sm:inline-flex", overdue ? "text-red-700" : "text-muted-foreground")}>
        <Clock className="size-3" /> {overdue ? "Overdue" : whenLine(item)}
      </span>
    </li>
  );
}
