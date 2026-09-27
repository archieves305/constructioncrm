"use client";

import { AlertCircle, CheckCircle2, Clock, Link2, ListChecks, Lock, MessageSquare } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { PRIORITY_DOT_CLASS, PRIORITY_LABEL, STATUS_TONE } from "@/components/tasks/task-colors";
import { shortName } from "@/components/tasks/types";
import { formatTimeRange } from "@/lib/calendar/agenda";
import type { CalendarItem } from "@/lib/calendar/types";
import { formatAddressLine } from "@/lib/labels/address";
import { jobLabel } from "@/lib/labels/job";
import { cn } from "@/lib/utils";

/**
 * One task on the calendar. The hierarchy is deliberate: where (the job's
 * address) → what (the title) → when → who → anything unusual. Nothing that
 * is "normal" gets a pill; a card with no pills is a task in good standing.
 * Status is never colour alone — every state pill carries an icon and a word.
 */

export function contextLine(item: CalendarItem): string {
  if (item.job) return jobLabel(item.job, { customer: false }).primary;
  if (item.violationCase) return `Case ${item.violationCase.caseNumber}`;
  if (item.lead) return formatAddressLine(item.lead) || item.lead.fullName;
  return "No job";
}

export function whenLine(item: CalendarItem): string {
  if (!item.allDay && item.start && item.end) return formatTimeRange(item.start, item.end);
  if (item.startDayKey && item.dayKey && item.startDayKey !== item.dayKey) return "Multi-day";
  return "All day";
}

export function CalendarTaskCard({
  item,
  variant = "full",
  showAssignee = true,
  onOpen,
  className,
}: {
  item: CalendarItem;
  variant?: "full" | "compact";
  showAssignee?: boolean;
  onOpen: (id: string) => void;
  className?: string;
}) {
  const closed = item.status === "COMPLETED" || item.status === "CANCELLED";
  const overdue = item.derived === "overdue";
  const bar = overdue ? "bg-tone-danger" : STATUS_TONE[item.status].bar;
  const compact = variant === "compact";

  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={`${item.title}, ${contextLine(item)}, ${whenLine(item)}${item.assignedTo ? `, ${shortName(item.assignedTo)}` : ", unassigned"}`}
      className={cn(
        "group relative w-full rounded-md border bg-white text-left shadow-xs transition-colors hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
        compact ? "px-2 py-1.5 pl-3" : "px-3 py-2 pl-3.5",
        closed && "opacity-60",
        className,
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-1.5 left-0 w-0.5 rounded-full", bar)} />

      <p className={cn("truncate text-muted-foreground", compact ? "text-[10px]" : "text-[11px]")}>{contextLine(item)}</p>
      <p className={cn("font-medium leading-snug text-gray-900", compact ? "line-clamp-1 text-xs" : "line-clamp-2 text-sm", closed && "line-through")}>
        {item.title}
      </p>

      {!compact && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("inline-block size-1.5 shrink-0 rounded-full", PRIORITY_DOT_CLASS[item.priority])} />
          <span className="sr-only">{PRIORITY_LABEL[item.priority]} priority.</span>
          <Clock className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{whenLine(item)}</span>
          {showAssignee && (
            <span className="ml-auto inline-flex items-center gap-1 pl-2">
              <UserAvatar user={item.assignedTo} size="xs" />
              <span className="max-w-[7rem] truncate">{item.assignedTo ? shortName(item.assignedTo) : "Unassigned"}</span>
            </span>
          )}
        </p>
      )}

      <Pills item={item} compact={compact} />
    </button>
  );
}

function Pill({ tone, icon: Icon, children }: { tone: "danger" | "warning" | "success" | "neutral" | "info"; icon?: typeof AlertCircle; children: React.ReactNode }) {
  const cls = {
    danger: "bg-tone-danger-soft text-tone-danger-fg",
    warning: "bg-tone-warning-soft text-tone-warning-fg",
    success: "bg-tone-success-soft text-tone-success-fg",
    info: "bg-tone-info-soft text-tone-info-fg",
    neutral: "bg-gray-100 text-gray-600",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none", cls)}>
      {Icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  );
}

function Pills({ item, compact }: { item: CalendarItem; compact: boolean }) {
  const pills: React.ReactNode[] = [];
  if (item.derived === "overdue") pills.push(<Pill key="overdue" tone="danger" icon={AlertCircle}>Overdue</Pill>);
  if (item.status === "BLOCKED") pills.push(<Pill key="blocked" tone="warning" icon={Lock}>Blocked</Pill>);
  if (item.status === "COMPLETED") pills.push(<Pill key="done" tone="success" icon={CheckCircle2}>Done</Pill>);
  if (item.status === "CANCELLED") pills.push(<Pill key="cancelled" tone="neutral">Cancelled</Pill>);
  if (item.priority === "URGENT" && !compact) pills.push(<Pill key="urgent" tone="danger">Urgent</Pill>);
  if (compact) {
    // One worst-state pill is all a compact card has room for.
    return pills.length ? <span className="mt-1 flex">{pills[0]}</span> : null;
  }
  if (item.counts.waitingOn > 0) pills.push(<Pill key="waiting" tone="neutral" icon={Link2}>Waiting on {item.counts.waitingOn}</Pill>);
  if (item.checklist.total > 0) pills.push(<Pill key="checklist" tone={item.checklist.done === item.checklist.total ? "success" : "neutral"} icon={ListChecks}>{item.checklist.done}/{item.checklist.total}</Pill>);
  if (item.counts.notes > 0) pills.push(<Pill key="notes" tone="neutral" icon={MessageSquare}>{item.counts.notes}</Pill>);
  if (pills.length === 0) return null;
  return <span className="mt-1.5 flex flex-wrap gap-1">{pills}</span>;
}
