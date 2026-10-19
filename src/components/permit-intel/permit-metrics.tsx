"use client";

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import type { Tile } from "@/lib/permit-intel/metrics";
import { cn } from "@/lib/utils";

export function usePermitMetrics() {
  return useQuery({ queryKey: ["permits", "metrics"], queryFn: () => fetchJson<Tile[]>("/api/permits/metrics"), retry: retryServerErrors, staleTime: 60_000 });
}

/**
 * Permit Center's metrics strip. A tile with permits behind it narrows the
 * board and the list to exactly those permits; click it again to clear.
 */
export function PermitMetricsStrip({ active, onPick }: { active: string | null; onPick: (key: string | null) => void }) {
  const { data } = usePermitMetrics();
  if (!data) return null;
  return (
    <div className="mb-4 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-5">
      {data.map((t) => {
        const on = active === t.key;
        const clickable = t.ids.length > 0;
        return (
          <button
            key={t.key}
            type="button"
            disabled={!clickable}
            title={t.hint}
            onClick={() => onPick(on ? null : t.key)}
            className={cn("min-w-0 rounded-lg border bg-card px-3 py-2 text-left transition-colors", clickable && "hover:bg-muted/50", on && "border-primary ring-1 ring-primary", t.key === "at-risk" && t.ids.length > 0 && "border-tone-danger-fg/40")}
          >
            <p className={cn("text-xl font-semibold tabular-nums", t.key === "at-risk" && t.ids.length > 0 && "text-tone-danger-fg")}>{t.value}</p>
            <p className="truncate text-xs text-muted-foreground">{t.label}</p>
            {on && (
              <p className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-primary">
                <X className="size-3" /> showing these
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
