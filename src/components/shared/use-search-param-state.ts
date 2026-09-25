"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Filters and tabs that live in the URL. Reading is `get`; writing replaces
 * the query (no history entry, no scroll), so a KPI tile can deep-link to a
 * queue and a copied link reproduces exactly what the person was looking at.
 */
export function useSearchParamState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const apply = useCallback(
    (next: URLSearchParams) => {
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const get = useCallback((key: string) => params.get(key), [params]);

  const setMany = useCallback(
    (values: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(values)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      apply(next);
    },
    [params, apply],
  );

  const set = useCallback((key: string, value: string | null | undefined) => setMany({ [key]: value }), [setMany]);

  const clear = useCallback(
    (keys?: string[]) => {
      if (!keys) return apply(new URLSearchParams());
      const next = new URLSearchParams(params.toString());
      for (const k of keys) next.delete(k);
      apply(next);
    },
    [params, apply],
  );

  return { params, get, set, setMany, clear };
}
