"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CALENDAR_WEEK_STARTS_ON, dayKeyToLocalDate, type DayKey } from "@/lib/time/zone";
import { cn } from "@/lib/utils";

/** The range label doubles as a jump-to-date picker. */
export function DatePopover({ anchor, label, onPick, className }: { anchor: DayKey; label: string; onPick: (k: DayKey) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const selected = dayKeyToLocalDate(anchor);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${label}. Pick a date`}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-md px-2 text-left text-base font-semibold tracking-tight text-gray-900 hover:bg-gray-100 sm:text-lg",
          className,
        )}
      >
        <h2 aria-live="polite" className="truncate">
          {label}
        </h2>
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          weekStartsOn={CALENDAR_WEEK_STARTS_ON}
          onSelect={(d) => {
            if (!d) return;
            onPick(format(d, "yyyy-MM-dd"));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
