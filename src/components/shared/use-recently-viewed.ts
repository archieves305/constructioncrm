"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The last few records this person opened, kept in localStorage so the
 * empty ⌘K palette has somewhere useful to start. Read through an external
 * store so the server render (empty) and the client agree.
 */
export type RecentItem = { type: "job" | "lead" | "case"; id: string; primary: string; secondary?: string | null; code?: string | null; href: string };

const KEY = "recent:viewed";
const LIMIT = 8;
const EVENT = "recent:viewed-change";
const EMPTY: RecentItem[] = [];
let cache: { raw: string | null; items: RecentItem[] } = { raw: null, items: EMPTY };

function read(): RecentItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === cache.raw) return cache.items;
    const items = raw ? (JSON.parse(raw) as RecentItem[]) : EMPTY;
    cache = { raw, items: Array.isArray(items) ? items : EMPTY };
    return cache.items;
  } catch {
    return EMPTY;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function recordRecentlyViewed(item: RecentItem) {
  try {
    const next = [item, ...read().filter((r) => r.href !== item.href)].slice(0, LIMIT);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — the palette just has no history
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useRecentlyViewed() {
  const items = useSyncExternalStore(subscribe, read, () => EMPTY);
  const record = useCallback((item: RecentItem) => recordRecentlyViewed(item), []);
  return { items, record };
}
