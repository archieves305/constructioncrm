"use client";

import { format } from "date-fns";
import type { CalendarItem } from "@/lib/calendar/types";
import { dayKeyToLocalDate, dayKeysBetween, type DayKey, type DayRange } from "@/lib/time/zone";
import { cn } from "@/lib/utils";

/**
 * The phone's week: seven pills above the day agenda. A dot per pill says
 * there is work; red says some of it is late.
 */
export function DayStrip({ range, selected, today, byDay, onSelect }: { range: DayRange; selected: DayKey; today: DayKey; byDay: Map<DayKey, CalendarItem[]>; onSelect: (k: DayKey) => void }) {
  return (
    <div role="tablist" aria-label="Days this week" className="mb-3 grid grid-cols-7 gap-1">
      {dayKeysBetween(range.from, range.to).map((day) => {
        const d = dayKeyToLocalDate(day);
        const items = byDay.get(day) ?? [];
        const open = items.filter((i) => i.status !== "COMPLETED" && i.status !== "CANCELLED").length;
        const late = items.some((i) => i.derived === "overdue");
        const active = day === selected;
        return (
          <button
            key={day}
            type="button"
            role="tab"
            aria-selected={active}
            aria-current={day === today ? "date" : undefined}
            aria-label={`${format(d, "EEEE, MMMM d")}, ${open} open`}
            onClick={() => onSelect(day)}
            className={cn(
              "flex h-14 flex-col items-center justify-center gap-0.5 rounded-md border text-xs",
              active ? "border-brand bg-brand text-white" : day === today ? "border-brand/40 bg-brand-soft text-brand-fg" : "bg-white text-gray-700",
            )}
          >
            <span className="uppercase opacity-80">{format(d, "EEEEE")}</span>
            <span className="text-sm font-semibold tabular-nums">{format(d, "d")}</span>
            <span className={cn("size-1.5 rounded-full", open === 0 ? "bg-transparent" : late ? (active ? "bg-white" : "bg-tone-danger") : active ? "bg-white/80" : "bg-gray-400")} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
