"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pagePattern } from "@/lib/usage/events";

/**
 * Records which kinds of page people open in the office CRM (the path with
 * ids removed: "/jobs/:id"), for the feature-usage log. Batched and sent
 * when the tab is hidden or every 30 seconds; best-effort, never visible.
 */
const queue: { event: "page_viewed"; subject: string; at: string }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length) return;
  const body = JSON.stringify({ source: "web", events: queue.splice(0, 200) });
  const sent = typeof navigator !== "undefined" && navigator.sendBeacon?.("/api/usage/events", new Blob([body], { type: "application/json" }));
  if (!sent) void fetch("/api/usage/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}

export function UsageBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname) return;
    queue.push({ event: "page_viewed", subject: pagePattern(pathname), at: new Date().toISOString() });
    timer ??= setTimeout(flush, 30_000);
  }, [pathname]);
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);
  return null;
}
