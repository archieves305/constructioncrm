"use client";

import type { CalendarSummary as Summary } from "@/lib/calendar/agenda";
import { cn } from "@/lib/utils";

/** "MY WEEK · 18 tasks · 11 done · 6 remaining · 1 overdue · 1 blocked" — one quiet line. */
export function CalendarSummary({ label, summary, className }: { label: string; summary: Summary; className?: string }) {
  const parts: { text: string; tone?: "danger" | "warning" }[] = [
    { text: `${summary.total} ${summary.total === 1 ? "task" : "tasks"}` },
    { text: `${summary.done} done` },
    { text: `${summary.remaining} remaining` },
  ];
  if (summary.overdue > 0) parts.push({ text: `${summary.overdue} overdue`, tone: "danger" });
  if (summary.blocked > 0) parts.push({ text: `${summary.blocked} blocked`, tone: "warning" });
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", className)}>
      <span className="font-semibold uppercase tracking-wide text-gray-700">{label}</span>
      {parts.map((p) => (
        <span key={p.text} className="inline-flex items-center gap-2">
          <span aria-hidden>·</span>
          <span
            className={cn(
              p.tone === "danger" && "rounded-full bg-tone-danger-soft px-1.5 py-0.5 font-medium text-tone-danger-fg",
              p.tone === "warning" && "rounded-full bg-tone-warning-soft px-1.5 py-0.5 font-medium text-tone-warning-fg",
            )}
          >
            {p.text}
          </span>
        </span>
      ))}
    </p>
  );
}
