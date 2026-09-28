"use client";

import { useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CalendarItem } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";
import { contextLine } from "./calendar-task-card";
import { DraggableCard } from "./draggable-card";
import { DropZone } from "./drop-zone";

/**
 * Active work nobody has given a day: the dispatcher's inbox. A collapsible
 * rail on the left of the calendar; cards drag out onto a day, a band or a
 * person's cell, and a scheduled card dropped here goes back to having no day.
 * Grouped by job so a run of tasks on one address reads as one block.
 */

const STORAGE_KEY = "calendar:rail";

// Read through useSyncExternalStore, like the kanban kit's collapsed columns:
// the server snapshot is the view's default, the client snapshot is what this
// browser remembers, and there is no effect + setState cascade.
const railListeners = new Set<() => void>();
let railOverride: "open" | "closed" | null | undefined;

function readRail(): "open" | "closed" | null {
  if (railOverride !== undefined) return railOverride;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "open" || v === "closed" ? v : null;
  } catch {
    return null;
  }
}

function writeRail(next: "open" | "closed") {
  railOverride = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode: the override carries this session */
  }
  for (const l of railListeners) l();
}

function subscribeRail(cb: () => void) {
  railListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    railListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useRailCollapsed(defaultCollapsed: boolean): [boolean, () => void] {
  const stored = useSyncExternalStore(subscribeRail, readRail, () => null);
  const collapsed = stored === null ? defaultCollapsed : stored === "closed";
  const toggle = () => writeRail(collapsed ? "open" : "closed");
  return [collapsed, toggle];
}

export function UnscheduledPanel({
  items,
  truncated,
  isLoading,
  collapsed,
  onToggle,
  onOpen,
  showAssignee,
}: {
  items: CalendarItem[];
  truncated: boolean;
  isLoading: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
  showAssignee: boolean;
}) {
  const count = items.length;
  const title = count === 0 ? "Nothing needs a day" : `${count}${truncated ? "+" : ""} ${count === 1 ? "task needs" : "tasks need"} a day`;

  if (collapsed) {
    return (
      <div className="shrink-0">
        <DropZone target={{ kind: "unscheduled" }} label="Unscheduled" className="h-full">
          <button
            type="button"
            onClick={onToggle}
            aria-label={`Show unscheduled work: ${title}`}
            aria-expanded={false}
            className="flex h-full min-h-40 w-9 flex-col items-center gap-2 rounded-md border bg-gray-50 py-2 text-muted-foreground hover:bg-gray-100 hover:text-foreground"
          >
            <ChevronRight className="size-4" />
            <Inbox className="size-4" />
            {count > 0 && <span className="rounded-full bg-tone-warning-soft px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-tone-warning-fg">{count}</span>}
            <span className="mt-1 text-[10px] font-medium uppercase tracking-wide [writing-mode:vertical-rl]">Unscheduled</span>
          </button>
        </DropZone>
      </div>
    );
  }

  const groups = new Map<string, CalendarItem[]>();
  for (const i of items) {
    const k = contextLine(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }

  return (
    <aside className="w-72 shrink-0" aria-label="Unscheduled work">
      <DropZone target={{ kind: "unscheduled" }} label="Unscheduled" className="flex h-full flex-col rounded-md border bg-gray-50">
        <header className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold">
            <Inbox className="size-3.5 text-muted-foreground" />
            Unscheduled
            {count > 0 && <span className="rounded-full bg-tone-warning-soft px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-tone-warning-fg">{count}</span>}
          </h3>
          <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label="Hide unscheduled work" aria-expanded>
            <ChevronLeft className="size-4" />
          </Button>
        </header>
        <p className="px-2 pt-2 text-[11px] text-muted-foreground">{isLoading ? "Loading…" : title}. Drag a card onto a day{showAssignee ? " or a person" : ""}.</p>
        <div className="max-h-[calc(100dvh-16rem)] flex-1 space-y-3 overflow-y-auto p-2">
          {count === 0 && !isLoading && <p className="rounded-md border border-dashed bg-white px-3 py-4 text-center text-xs text-muted-foreground">Drop a card here to take it off the calendar.</p>}
          {Array.from(groups.entries()).map(([label, list]) => (
            <section key={label} aria-label={label}>
              <h4 className="mb-1 truncate px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</h4>
              <ul className="space-y-1.5">
                {list.map((item) => (
                  <li key={item.id}>
                    <DraggableCard item={item} where="rail" onOpen={onOpen} showAssignee={showAssignee} className={cn("bg-white")} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {truncated && <p className="text-[11px] text-muted-foreground">Showing the first {count}. Narrow to a person to see the rest.</p>}
        </div>
      </DropZone>
    </aside>
  );
}
