"use client";

import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, LayoutGrid, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { rangeLabel, type CalendarView } from "@/lib/calendar/url-state";
import type { DayKey } from "@/lib/time/zone";
import { DatePopover } from "./date-popover";

/**
 * ‹ Today › · the range (click to jump) · Day | Week | Month · Viewing · + Task.
 * The label is an aria-live heading so ‹ › announce where you landed.
 */
export function CalendarHeader({
  view,
  onViewChange,
  anchor,
  onPrev,
  onNext,
  onToday,
  onPickDate,
  isToday,
  viewing,
  onNewTask,
  showPeople = false,
}: {
  view: CalendarView;
  onViewChange: (v: CalendarView) => void;
  anchor: DayKey;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPickDate: (k: DayKey) => void;
  isToday: boolean;
  viewing?: React.ReactNode;
  onNewTask?: () => void;
  /** Dispatch roles on a desktop get the People board. */
  showPeople?: boolean;
}) {
  const unit = view === "day" ? "day" : view === "month" ? "month" : "week";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" onClick={onPrev} aria-label={`Previous ${unit}`} title={`Previous ${unit} (←)`}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={onToday} disabled={isToday} title="Jump to today (t)">
          Today
        </Button>
        <Button variant="outline" size="icon-sm" onClick={onNext} aria-label={`Next ${unit}`} title={`Next ${unit} (→)`}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <DatePopover anchor={anchor} label={rangeLabel(view, anchor)} onPick={onPickDate} className="min-w-0 flex-1 sm:flex-none" />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <SegmentedControl<CalendarView>
          ariaLabel="Calendar view"
          value={view}
          onValueChange={onViewChange}
          options={[
            { value: "day", label: "Day", icon: CalendarDays },
            { value: "week", label: "Week", icon: CalendarRange },
            { value: "month", label: "Month", icon: LayoutGrid },
            ...(showPeople ? [{ value: "people" as const, label: "People", icon: Users }] : []),
          ]}
        />
        {viewing}
        {onNewTask && (
          <Button variant="brand" onClick={onNewTask}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">New task</span>
            <span className="sm:hidden">Task</span>
            <kbd className="ml-1 hidden rounded border border-white/30 bg-white/10 px-1 font-mono text-[10px] sm:inline">N</kbd>
          </Button>
        )}
      </div>
    </div>
  );
}
