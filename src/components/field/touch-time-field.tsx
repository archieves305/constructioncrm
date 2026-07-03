"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

// Touch-first time entry: big ±15-minute steppers around the value, with the
// native time picker as a tap-the-value fallback for odd times. Values are
// minutes-from-midnight (may exceed 1440 = next day on midnight shifts).

export function formatMinutes(minutes: number | null): string {
  if (minutes == null) return "—:—";
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}${minutes >= 1440 ? " +1d" : ""}`;
}

function toTimeInputValue(minutes: number | null): string {
  if (minutes == null) return "";
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function TouchTimeField({
  label,
  value,
  onChange,
  defaultValue,
  disabled,
  className,
}: {
  label: string;
  value: number | null;
  onChange: (minutes: number | null) => void;
  /** Applied on first +/- tap when the value is empty (e.g. shift default). */
  defaultValue: number;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const step = (delta: number) => {
    if (value == null) {
      onChange(defaultValue);
      return;
    }
    const next = value + delta;
    if (next < 0 || next >= 2880) return;
    onChange(next);
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={disabled}
          onClick={() => step(-15)}
          aria-label={`${label} minus 15 minutes`}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.showPicker?.()}
          className="relative h-11 min-w-[104px] flex-1 rounded-md border bg-white px-2 text-base font-medium tabular-nums disabled:opacity-50"
        >
          {formatMinutes(value)}
          <input
            ref={inputRef}
            type="time"
            step={300}
            tabIndex={-1}
            value={toTimeInputValue(value)}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const [h, m] = v.split(":").map(Number);
              onChange(h * 60 + m);
            }}
            className="absolute inset-0 h-full w-full opacity-0"
            style={{ fontSize: 16 }}
            disabled={disabled}
          />
        </button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={disabled}
          onClick={() => step(15)}
          aria-label={`${label} plus 15 minutes`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
