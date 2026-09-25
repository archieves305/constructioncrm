"use client";

import { useEffect, useState } from "react";

/** The value as it was `delay` ms ago and unchanged since — for search boxes that drive a query. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
