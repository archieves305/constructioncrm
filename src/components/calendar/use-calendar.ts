"use client";

import { useEffect } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import type { CalendarRangeResponse, CalendarUnscheduledResponse } from "@/lib/calendar/types";
import type { CalendarFilters } from "@/lib/calendar/url-state";
import type { DayRange } from "@/lib/time/zone";

/**
 * Data access for the calendar. One query per visible range; the previous
 * range stays on screen while the next loads (no flash on ‹ ›), and the
 * neighbouring ranges are prefetched so the next press is instant.
 *
 * Every task mutation in the app already invalidates `["calendar"]` (see
 * RELATED_KEYS in tasks/use-tasks.ts), so a tick on the tasks page or a
 * status change in the sheet refreshes the calendar without wiring here.
 */

export type RangeQueryParams = DayRange & {
  users: string;
  job?: string;
  status?: string;
  priority?: string;
  q?: string;
  includeCompleted: boolean;
};

export const calendarKeys = {
  all: ["calendar"] as const,
  range: (p: RangeQueryParams) => ["calendar", "range", p] as const,
  unscheduled: (users: string) => ["calendar", "unscheduled", users] as const,
};

export function rangeParams(range: DayRange, users: string, filters: CalendarFilters): RangeQueryParams {
  return {
    from: range.from,
    to: range.to,
    users,
    job: filters.job,
    status: filters.status,
    priority: filters.priority,
    q: filters.q,
    includeCompleted: !filters.hideCompleted,
  };
}

function rangeUrl(p: RangeQueryParams): string {
  const sp = new URLSearchParams({ from: p.from, to: p.to, users: p.users });
  if (p.job) sp.set("jobId", p.job);
  if (p.status) sp.set("status", p.status);
  if (p.priority) sp.set("priority", p.priority);
  if (p.q) sp.set("q", p.q);
  if (p.includeCompleted) sp.set("includeCompleted", "1");
  return `/api/calendar?${sp.toString()}`;
}

const fetchRange = (p: RangeQueryParams) => fetchJson<CalendarRangeResponse>(rangeUrl(p));

export function useCalendarRange(p: RangeQueryParams, opts: { enabled?: boolean } = {}) {
  return useQuery<CalendarRangeResponse>({
    queryKey: calendarKeys.range(p),
    queryFn: () => fetchRange(p),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: retryServerErrors,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

/** Warm the previous and next range once the current one has arrived. */
export function usePrefetchAdjacent(current: RangeQueryParams, neighbours: DayRange[], enabled: boolean) {
  const qc = useQueryClient();
  const key = JSON.stringify([current, neighbours]);
  useEffect(() => {
    if (!enabled) return;
    for (const n of neighbours) {
      const p = { ...current, from: n.from, to: n.to };
      void qc.prefetchQuery({ queryKey: calendarKeys.range(p), queryFn: () => fetchRange(p), staleTime: 30_000 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, qc]);
}

export function useUnscheduled(users: string, opts: { enabled?: boolean } = {}) {
  return useQuery<CalendarUnscheduledResponse>({
    queryKey: calendarKeys.unscheduled(users),
    queryFn: () => fetchJson(`/api/calendar/unscheduled?users=${encodeURIComponent(users)}`),
    staleTime: 60_000,
    retry: retryServerErrors,
    enabled: opts.enabled ?? true,
  });
}
