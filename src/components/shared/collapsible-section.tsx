"use client";

import { useId, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A titled section a person can fold away; the choice is remembered in this
 * browser (`section:<id>`). Read through useSyncExternalStore like the kanban
 * kit's columns, so there is no effect + setState and no hydration warning:
 * the server renders the default, the client what was stored. Storage that
 * throws (private mode) keeps the choice for this page only.
 */
const listeners = new Set<() => void>();
const memory = new Map<string, boolean>();

function read(key: string, fallback: boolean): boolean {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const v = window.localStorage.getItem(key);
    return v === "open" ? true : v === "closed" ? false : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, open: boolean) {
  memory.set(key, open);
  try {
    window.localStorage.setItem(key, open ? "open" : "closed");
  } catch {
    /* the in-memory value carries this page */
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useStoredOpen(id: string, defaultOpen: boolean) {
  const key = `section:${id}`;
  const open = useSyncExternalStore(subscribe, () => read(key, defaultOpen), () => defaultOpen);
  return [open, (next: boolean) => write(key, next)] as const;
}

export function CollapsibleSection({
  id,
  title,
  summary,
  defaultOpen = true,
  className,
  children,
}: {
  /** Stable id: the remembered state is keyed on it. */
  id: string;
  title: string;
  /** Shown beside the title while folded, e.g. "3 open bids". */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useStoredOpen(id, defaultOpen);
  const bodyId = useId();
  return (
    <section aria-label={title} className={cn("mt-6", className)}>
      <h2 className="mb-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
          className="flex min-h-9 items-center gap-1.5 rounded-md text-sm font-semibold text-fg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} aria-hidden />
          {title}
          {!open && summary ? <span className="font-normal text-muted-foreground">· {summary}</span> : null}
        </button>
      </h2>
      <div id={bodyId} hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}
