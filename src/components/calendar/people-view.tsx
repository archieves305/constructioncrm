"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { fullName } from "@/components/tasks/types";
import { itemsByDay } from "@/lib/calendar/agenda";
import { formatWorkload, type PersonRow } from "@/lib/calendar/people";
import type { CalendarItem } from "@/lib/calendar/types";
import { dayKeyToLocalDate, dayKeysBetween, type DayKey, type DayRange } from "@/lib/time/zone";
import { cn } from "@/lib/utils";
import { DraggableCard } from "./draggable-card";
import { DropZone } from "./drop-zone";

/**
 * The dispatch board: one row per person (Unassigned first), one column per
 * day of the week. Every cell is a drop zone, every open card can be dragged
 * across days and lanes, and a row's footer says how loaded that person is.
 * A real <table> so a screen reader hears "Lisette, Tuesday, 2 tasks".
 */

const CELL_LIMIT = 4;

export function PeopleView({
  range,
  rows,
  today,
  onOpen,
  onAddOn,
}: {
  range: DayRange;
  rows: PersonRow[];
  today: DayKey;
  onOpen: (id: string) => void;
  /** Quick-create on a person's day. */
  onAddOn?: (day: DayKey, userId: string | null) => void;
}) {
  const days = dayKeysBetween(range.from, range.to);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] table-fixed border-separate border-spacing-1" aria-label="People this week">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-40 bg-background pb-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Person
            </th>
            {days.map((day) => {
              const d = dayKeyToLocalDate(day);
              const isToday = day === today;
              return (
                <th
                  key={day}
                  scope="col"
                  aria-current={isToday ? "date" : undefined}
                  className={cn("rounded-md px-2 py-1 text-left text-[11px] font-semibold", isToday ? "bg-brand-soft text-brand-fg" : "bg-gray-50 text-gray-700")}
                >
                  <span className="uppercase tracking-wide">{format(d, "EEE")}</span> <span className="text-sm">{format(d, "d")}</span>
                  <span className="sr-only">, {format(d, "MMMM yyyy")}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PersonLane key={row.id ?? "unassigned"} row={row} range={range} days={days} today={today} onOpen={onOpen} onAddOn={onAddOn} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonLane({
  row,
  range,
  days,
  today,
  onOpen,
  onAddOn,
}: {
  row: PersonRow;
  range: DayRange;
  days: DayKey[];
  today: DayKey;
  onOpen: (id: string) => void;
  onAddOn?: (day: DayKey, userId: string | null) => void;
}) {
  const byDay = itemsByDay(row.items, range);
  const name = row.person ? fullName(row.person) : "Unassigned";
  return (
    <tr>
      <th scope="row" className="sticky left-0 z-10 w-40 bg-background p-0 pr-1 text-left align-top">
        <div className={cn("flex h-full min-h-24 flex-col gap-1 rounded-md border p-2", row.id === null ? "border-dashed bg-gray-50" : "bg-white")}>
          <div className="flex items-center gap-2">
            <UserAvatar user={row.person} size="sm" />
            <span className="min-w-0 truncate text-sm font-medium text-gray-900">{name}</span>
          </div>
          <p className="text-[11px] tabular-nums text-muted-foreground">{formatWorkload(row)}</p>
        </div>
      </th>
      {days.map((day) => (
        <PersonCell key={day} row={row} day={day} items={byDay.get(day) ?? []} isToday={day === today} name={name} onOpen={onOpen} onAdd={onAddOn ? () => onAddOn(day, row.id) : undefined} />
      ))}
    </tr>
  );
}

function PersonCell({
  row,
  day,
  items,
  isToday,
  name,
  onOpen,
  onAdd,
}: {
  row: PersonRow;
  day: DayKey;
  items: CalendarItem[];
  isToday: boolean;
  name: string;
  onOpen: (id: string) => void;
  onAdd?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, CELL_LIMIT);
  const hidden = items.length - visible.length;
  const d = format(dayKeyToLocalDate(day), "EEEE, MMMM d");
  const words = items.length === 0 ? "nothing" : `${items.length} ${items.length === 1 ? "task" : "tasks"}`;
  return (
    <td className="p-0 align-top">
      <DropZone target={{ kind: "cell", day, userId: row.id }} label={`${name}, ${d}: ${words}`} className={cn("group/cell min-h-24 h-full border p-1", isToday ? "border-brand/30 bg-brand-soft/20" : "border-gray-200 bg-white")}>
        <ul className="space-y-1" aria-label={`${name}, ${d}`}>
          {visible.map((item) => (
            <li key={item.id}>
              <DraggableCard item={item} where={`${row.id ?? "unassigned"}:${day}`} onOpen={onOpen} variant="compact" showAssignee={false} />
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <button type="button" onClick={() => setExpanded(true)} className="mt-1 w-full rounded border border-dashed py-0.5 text-[11px] text-muted-foreground hover:bg-gray-50">
            +{hidden} more
          </button>
        )}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Add a task for ${name} on ${d}`}
            className={cn(
              "mt-1 inline-flex w-full items-center justify-center gap-1 rounded py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-gray-50 hover:text-foreground focus-visible:opacity-100 group-hover/cell:opacity-100",
              items.length === 0 && "opacity-60",
            )}
          >
            <Plus className="size-3" /> Add
          </button>
        )}
      </DropZone>
    </td>
  );
}
