"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BellRing, CheckCircle2, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { visibleAttention, type AttentionCount } from "@/lib/attention/rows";
import type { ListScope } from "@/lib/lists/scope";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";

/**
 * The first thing on the dashboard: what needs someone, for this person's
 * role. Only rows with something in them are shown, and each opens the list
 * its number was counted from.
 */
export function NeedsAttention({ scope, className }: { scope: ListScope; className?: string }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery<{ scope: ListScope; rows: AttentionCount[] }>({
    queryKey: ["attention", scope],
    queryFn: () => fetchJson(`/api/attention?scope=${scope}`),
    retry: retryServerErrors,
    refetchInterval: 5 * 60_000,
  });
  const rows = data ? visibleAttention(data.rows) : [];
  const total = rows.reduce((n, r) => n + r.count, 0);

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-muted-foreground" />
          Needs attention
          {total > 0 && <span className="text-sm font-normal text-muted-foreground">{scope === "mine" ? "on your work" : "across the company"}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-sm">
            <span className="text-muted-foreground">Couldn&apos;t load what needs attention. Nothing is shown rather than a zero.</span>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-tone-success-fg" />
            {scope === "mine" ? "Nothing of yours needs attention right now." : "Nothing needs attention right now."}
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => {
              const tone = toneClasses(r.tone);
              return (
                <li key={r.key}>
                  <Link
                    href={r.href}
                    className="flex h-full items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={cn("inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-sm font-semibold tabular-nums", tone.pill)}>{r.count}</span>
                    <span className="min-w-0 flex-1 text-sm font-medium leading-tight">{r.label}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
