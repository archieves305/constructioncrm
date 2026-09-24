"use client";

import { addDays, addWeeks, format, isSameDay, nextMonday } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function ymd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/**
 * A due date as four taps. The date input stays visible as the escape hatch
 * so nothing is more than one click away.
 */
export function DueDatePresets({
  value,
  onChange,
  className,
}: {
  /** yyyy-MM-dd or "" */
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const today = new Date();
  const presets: { label: string; date: Date }[] = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "Next Mon", date: nextMonday(today) },
    { label: "In a week", date: addWeeks(today, 1) },
  ];
  const selected = value ? new Date(`${value}T12:00:00`) : null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {presets.map((p) => {
        const active = selected ? isSameDay(selected, p.date) : false;
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(ymd(p.date))}
            className={cn(
              "h-7 rounded-full border px-2.5 text-xs transition-colors",
              active
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50",
            )}
          >
            {p.label}
          </button>
        );
      })}
      <span className="relative">
        <CalendarDays className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-[150px] pl-7 text-xs"
          aria-label="Due date"
        />
      </span>
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Clear
        </button>
      )}
    </div>
  );
}
