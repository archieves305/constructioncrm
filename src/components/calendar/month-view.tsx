"use client";

import { format } from "date-fns";
import { dayTone } from "@/lib/calendar/agenda";
import type { CalendarItem } from "@/lib/calendar/types";
import { dayKeyToLocalDate, dayKeysBetween, type DayKey, type MonthGrid } from "@/lib/time/zone";
import { cn } from "@/lib/utils";

/**
 * Six weeks of counts. Each cell is a button that opens the day; the pill's
 * tone is the worst thing on it (overdue > blocked > busy > all done) and
 * its label says so in words, so colour is never the only cue. No card
 * chips here — at seven columns they are unreadable, and Day is one click.
 */
export function MonthView({ grid, byDay, today, onPickDay }: { grid: MonthGrid; byDay: Map<DayKey, CalendarItem[]>; today: DayKey; onPickDay: (k: DayKey) => void }) {
  const days = dayKeysBetween(grid.from, grid.to);
  const weeks: DayKey[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const weekdays = days.slice(0, 7).map((k) => format(dayKeyToLocalDate(k), "EEE"));

  return (
    <table className="w-full table-fixed border-separate border-spacing-1" aria-label={format(dayKeyToLocalDate(grid.monthStart), "MMMM yyyy")}>
      <thead>
        <tr>
          {weekdays.map((w) => (
            <th key={w} scope="col" className="pb-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {w}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, wi) => (
          <tr key={wi}>
            {week.map((day) => {
              const items = byDay.get(day) ?? [];
              const inMonth = day >= grid.monthStart && day <= grid.monthEnd;
              const tone = dayTone(items);
              const overdue = items.filter((i) => i.derived === "overdue").length;
              const blocked = items.filter((i) => i.status === "BLOCKED").length;
              const d = dayKeyToLocalDate(day);
              const words =
                items.length === 0
                  ? "nothing scheduled"
                  : `${items.length} ${items.length === 1 ? "task" : "tasks"}${overdue ? `, ${overdue} overdue` : ""}${blocked ? `, ${blocked} blocked` : ""}`;
              return (
                <td key={day} className="p-0 align-top">
                  <button
                    type="button"
                    onClick={() => onPickDay(day)}
                    aria-label={`${format(d, "EEEE, MMMM d")}, ${words}`}
                    aria-current={day === today ? "date" : undefined}
                    className={cn(
                      "flex h-16 w-full flex-col items-start justify-between rounded-md border p-1.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:h-20 sm:p-2",
                      day === today ? "border-brand/40 bg-brand-soft/40" : "border-gray-200 bg-white",
                      !inMonth && "opacity-45",
                    )}
                  >
                    <span className={cn("text-xs font-medium tabular-nums", day === today ? "text-brand-fg" : "text-gray-700")}>{format(d, "d")}</span>
                    {items.length > 0 && (
                      <span
                        className={cn(
                          "inline-flex max-w-full items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
                          tone === "overdue" && "bg-tone-danger-soft text-tone-danger-fg",
                          tone === "blocked" && "bg-tone-warning-soft text-tone-warning-fg",
                          tone === "busy" && "bg-tone-info-soft text-tone-info-fg",
                          tone === "quiet" && "bg-gray-100 text-gray-600",
                        )}
                      >
                        {items.length}
                        {overdue > 0 && <span className="hidden sm:inline"> · {overdue} overdue</span>}
                        {!overdue && blocked > 0 && <span className="hidden sm:inline"> · {blocked} blocked</span>}
                        {!overdue && !blocked && tone === "quiet" && <span className="hidden sm:inline"> · done</span>}
                      </span>
                    )}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
