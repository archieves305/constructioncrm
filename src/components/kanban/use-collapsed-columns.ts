"use client";

import { useSyncExternalStore } from "react";

/**
 * Which columns a person folded away, remembered per board in this browser.
 *
 * Read through `useSyncExternalStore` rather than an effect + setState: the
 * server snapshot is the board's defaults, the client snapshot is what
 * localStorage says, and React reconciles the two without a cascading
 * render or a hydration warning.
 */
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: Set<string> }>();

function defaultsFrom(defaultsKey: string): string[] {
  return defaultsKey ? defaultsKey.split("|") : [];
}

function read(key: string, defaults: string[]): Set<string> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    raw = null;
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value;
  let value: Set<string>;
  try {
    value = raw ? new Set(JSON.parse(raw) as string[]) : new Set(defaults);
  } catch {
    value = new Set(defaults);
  }
  cache.set(key, { raw, value });
  return value;
}

function write(key: string, next: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...next]));
  } catch {
    // Private mode or blocked storage: the fold still applies for this render.
    cache.set(key, { raw: null, value: next });
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

const serverSnapshots = new Map<string, Set<string>>();
function serverSnapshot(defaultsKey: string): Set<string> {
  let s = serverSnapshots.get(defaultsKey);
  if (!s) {
    s = new Set(defaultsFrom(defaultsKey));
    serverSnapshots.set(defaultsKey, s);
  }
  return s;
}

export function useCollapsedColumns(boardId: string, defaults: string[] = []) {
  const key = `kanban:${boardId}:collapsed`;
  // A string key rather than the array, so identity churn on `defaults`
  // never re-reads storage or re-creates the toggle.
  const defaultsKey = defaults.join("|");
  const collapsed = useSyncExternalStore(
    subscribe,
    () => read(key, defaultsFrom(defaultsKey)),
    () => serverSnapshot(defaultsKey),
  );

  function toggle(id: string) {
    const next = new Set(read(key, defaultsFrom(defaultsKey)));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    write(key, next);
  }

  return { collapsed, toggle };
}
