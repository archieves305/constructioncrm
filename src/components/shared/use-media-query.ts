"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A media query as React state. The server snapshot is `false`, so a page
 * renders its desktop layout on the server and corrects itself on the
 * client — the same direction every existing breakpoint class already takes.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below Tailwind's `md` (768px): the layouts that stack, drop drag and open sheets from the bottom. */
export function useIsPhone(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
