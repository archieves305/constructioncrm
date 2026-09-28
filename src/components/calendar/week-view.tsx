"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { DEFAULT_COLUMN_LIMIT, nextShown, splitVisible } from "@/lib/kanban/limit";
import type { CalendarItem } from "@/lib/calendar/types";
import { dayKeyToLocalDate, dayKeysBetween, type DayKey, type DayRange } from "@/lib/time/zone";
import { cn } from "@/lib/utils";
import { DraggableCard } from "./draggable-card";
import { DropZone } from "./drop-zone";

/**
 * Seven equal columns of cards. Each day says how much is on it and how much
 * is done; today is tinted and marked for assistive tech. A column keeps
 * growing rather than scrolling inside itself, so the page scrolls as one.
 */
export function WeekView({
  range,
  byDay,
  today,
  onOpen,
  onAddOn,
  showAssignee,
}: {
  range: DayRange;
  byDay: Map<DayKey, CalendarItem[]>;
  today: DayKey;
  onOpen: (id: string) => void;
  onAddOn?: (day: DayKey) => void;
  showAssignee: boolean;
}) {
  const days = dayKeysBetween(range.from, range.to);
  return (
    <div className="grid grid-cols-7 gap-2" role="list" aria-label="Week">
      {days.map((day) => (
        <DayColumn key={day} day={day} items={byDay.get(day) ?? []} isToday={day === today} onOpen={onOpen} onAdd={onAddOn ? () => onAddOn(day) : undefined} showAssignee={showAssignee} />
      ))}
    </div>
  );
}

function DayColumn({
  day,
  items,
  isToday,
  onOpen,
  onAdd,
  showAssignee,
}: {
  day: DayKey;
  items: CalendarItem[];
  isToday: boolean;
  onOpen: (id: string) => void;
  onAdd?: () => void;
  showAssignee: boolean;
}) {
  const [shown, setShown] = useState(DEFAULT_COLUMN_LIMIT);
  const { visible, hidden } = splitVisible(items, shown);
  const d = dayKeyToLocalDate(day);
  const done = items.filter((i) => i.status === "COMPLETED").length;
  const open = items.length - done - items.filter((i) => i.status === "CANCELLED").length;
  const headingId = `cal-day-${day}`;

  return (
    <section role="listitem" aria-labelledby={headingId} className="group min-w-0">
      <DropZone target={{ kind: "day", day }} label={format(d, "EEEE, MMMM d")} className="min-h-full">
      <header
        className={cn(
          "mb-2 flex items-baseline justify-between gap-1 rounded-md border px-2 py-1.5",
          isToday ? "border-brand/40 bg-brand-soft text-brand-fg" : "border-transparent bg-gray-50 text-gray-700",
        )}
        aria-current={isToday ? "date" : undefined}
      >
        <h3 id={headingId} className="min-w-0 truncate text-xs font-semibold">
          <span className="uppercase tracking-wide">{format(d, "EEE")}</span> <span className="text-sm">{format(d, "d")}</span>
          <span className="sr-only">, {format(d, "MMMM yyyy")}</span>
        </h3>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" title={`${items.length} tasks, ${done} done`}>
          {items.length === 0 ? "" : done > 0 ? `${open} · ${done} done` : `${items.length}`}
        </span>
      </header>

      <ul className="space-y-1.5" aria-label={`Tasks on ${format(d, "EEEE, MMMM d")}`}>
        {visible.map((item) => (
          <li key={item.id}>
            <DraggableCard item={item} where={day} onOpen={onOpen} showAssignee={showAssignee} />
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" onClick={() => setShown(nextShown(shown))} className="mt-1.5 w-full rounded-md border border-dashed py-1 text-xs text-muted-foreground hover:bg-gray-50">
          Show {Math.min(hidden, DEFAULT_COLUMN_LIMIT)} more
        </button>
      )}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add a task on ${format(d, "EEEE, MMMM d")}`}
          className={cn(
            "mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-gray-50 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
            items.length === 0 && "opacity-100",
          )}
        >
          <Plus className="size-3.5" /> Add
        </button>
      )}
      </DropZone>
    </section>
  );
}
