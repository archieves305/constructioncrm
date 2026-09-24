"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A single-choice button row (view toggles, sub-tabs). Plain buttons with
 * radio semantics — small enough not to need a primitive, and it never
 * "clears" when the pressed option is clicked again.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  size = "default",
  className,
  ariaLabel,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; icon?: LucideIcon; disabled?: boolean }[];
  size?: "sm" | "default";
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex rounded-lg border bg-gray-50 p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => !active && onValueChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50",
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-xs",
              active ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200" : "text-gray-600 hover:text-gray-900",
            )}
          >
            {Icon && <Icon className="size-3.5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
