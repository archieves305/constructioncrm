"use client";

import { cn } from "@/lib/utils";
import { PRIORITY_DOT_CLASS, PRIORITY_LABEL, PRIORITY_SELECTED_CLASS, TASK_PRIORITIES } from "./task-colors";
import type { Priority } from "./types";

/** Priority as a segmented row of coloured chips. */
export function PriorityChips({
  value,
  onChange,
  className,
}: {
  value: Priority;
  onChange: (p: Priority) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-lg border bg-gray-50 p-0.5", className)}>
      {TASK_PRIORITIES.map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(p)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
              active
                ? cn("ring-1 shadow-sm", PRIORITY_SELECTED_CLASS[p])
                : "text-gray-600 hover:bg-white hover:text-gray-900",
            )}
          >
            <span className={cn("size-2 rounded-full", PRIORITY_DOT_CLASS[p])} />
            {PRIORITY_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}
