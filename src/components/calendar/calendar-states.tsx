"use client";

import Link from "next/link";
import { CalendarCheck, CalendarX2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import type { CalendarView } from "@/lib/calendar/url-state";

/** Loading, empty, error and "too much" — shaped like the view they stand in for. */

export function CalendarSkeleton({ view }: { view: CalendarView }) {
  if (view === "month") {
    return (
      <div className="grid grid-cols-7 gap-1" aria-busy aria-label="Loading calendar">
        {Array.from({ length: 42 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-md" />
        ))}
      </div>
    );
  }
  if (view === "people") {
    return (
      <div className="space-y-1" aria-busy aria-label="Loading calendar">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-md" />
        ))}
      </div>
    );
  }
  if (view === "day") {
    return (
      <div className="space-y-2" aria-busy aria-label="Loading calendar">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-md" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-7 gap-2" aria-busy aria-label="Loading calendar">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-10 rounded-md" />
          <Skeleton className="h-20 rounded-md" />
          <Skeleton className="h-14 rounded-md" />
        </div>
      ))}
    </div>
  );
}

const PERIOD: Record<CalendarView, string> = { day: "today", week: "this week", month: "this month", people: "this week" };

export function CalendarEmpty({
  view,
  mine,
  canCreate,
  onCreate,
  unscheduledCount = 0,
}: {
  view: CalendarView;
  /** Looking at your own calendar (vs someone else's or everyone's). */
  mine: boolean;
  canCreate: boolean;
  onCreate?: () => void;
  /** For dispatch roles: active work that still has no day. */
  unscheduledCount?: number;
}) {
  const period = PERIOD[view];
  return (
    <div className="space-y-3">
      {unscheduledCount > 0 && (
        <Callout
          tone="warning"
          title={`${unscheduledCount} active ${unscheduledCount === 1 ? "task" : "tasks"} still ${unscheduledCount === 1 ? "needs" : "need"} a day`}
          action={
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/tasks?unscheduled=1" />}>
              View unscheduled
            </Button>
          }
        >
          Give them a date and they show up here.
        </Callout>
      )}
      <EmptyState
        icon={CalendarCheck}
        title={mine ? "You're all caught up." : `Nothing scheduled ${period}.`}
        description={mine ? `Nothing on your calendar ${period}.` : undefined}
        action={
          canCreate && onCreate ? (
            <Button variant="brand" onClick={onCreate}>
              <Plus className="size-4" /> New task
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

export function CalendarErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={CalendarX2}
      title="Couldn't load the calendar."
      description="Something went wrong on our side. Try again in a moment."
      action={
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="size-4" /> Retry
        </Button>
      }
    />
  );
}

export function TruncatedNotice({ cap }: { cap: number }) {
  return (
    <Callout tone="info" className="mb-3">
      Showing the first {cap.toLocaleString()} tasks — narrow the filters or pick a person to see everything.
    </Callout>
  );
}
