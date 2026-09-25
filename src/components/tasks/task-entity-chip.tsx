"use client";

import Link from "next/link";
import { format } from "date-fns";
import { Briefcase, ClipboardList, FileText, Gavel, MapPin, Receipt, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskEntityContext, TaskListItem } from "./types";

/**
 * "What is this task about?" as one small link — the most specific record
 * first (an invoice beats its job), falling back to the job or lead.
 */

type Chip = { icon: React.ElementType; label: string; href: string | null; mono?: boolean };

export function chipForTask(task: TaskListItem): Chip | null {
  // A code-violation step: the case number (and item) in mono, to the case.
  if (task.violationCase) {
    const c = task.violationCase;
    const item = task.violationItem;
    return {
      icon: Gavel,
      label: item ? `${c.caseNumber} · Item ${item.itemNumber}` : c.caseNumber,
      href: item ? `/violations/${c.id}?tab=items&item=${item.id}` : `/violations/${c.id}`,
      mono: true,
    };
  }
  if (task.invoice) {
    return { icon: Receipt, label: task.invoice.invoiceNumber, href: `/jobs/${task.invoice.jobId}`, mono: true };
  }
  if (task.estimate) {
    return {
      icon: FileText,
      label: `${task.estimate.estimateNumber} · ${task.estimate.name}`,
      href: `/leads/${task.estimate.leadId}`,
    };
  }
  if (task.dailyLog) {
    const date = task.dailyLog.logDate.slice(0, 10);
    return {
      icon: ClipboardList,
      label: `Log · ${format(new Date(`${date}T12:00:00`), "MMM d")}`,
      href: `/jobs/${task.dailyLog.jobId}/daily-logs/${date}`,
    };
  }
  if (task.prospect) {
    return {
      icon: MapPin,
      label: `${task.prospect.propertyAddress1}, ${task.prospect.city}`,
      href: "/canvassing/prospects",
    };
  }
  if (task.job) return { icon: Briefcase, label: task.job.jobNumber, href: `/jobs/${task.job.id}`, mono: true };
  if (task.lead) return { icon: UserRound, label: task.lead.fullName, href: `/leads/${task.lead.id}` };
  return null;
}

function ChipBody({ chip, className }: { chip: Chip; className?: string }) {
  const Icon = chip.icon;
  const inner = (
    <>
      <Icon className="size-3 shrink-0" />
      <span className={cn("truncate", chip.mono && "font-mono")}>{chip.label}</span>
    </>
  );
  const cls = cn(
    "inline-flex max-w-full items-center gap-1 rounded-md border bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-700",
    chip.href && "hover:border-gray-300 hover:bg-white hover:text-gray-900",
    className,
  );
  return chip.href ? (
    <Link href={chip.href} className={cls} onClick={(e) => e.stopPropagation()}>
      {inner}
    </Link>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

export function TaskEntityChip({ task, className }: { task: TaskListItem; className?: string }) {
  const chip = chipForTask(task);
  return chip ? <ChipBody chip={chip} className={className} /> : null;
}

/** The chip for a context the user is creating a task FROM. */
export function EntityContextChip({ context, className }: { context: TaskEntityContext; className?: string }) {
  const icon = context.violationCaseId || context.violationItemId
    ? Gavel
    : context.invoiceId
    ? Receipt
    : context.estimateId
      ? FileText
      : context.dailyLogId
        ? ClipboardList
        : context.prospectId
          ? MapPin
          : context.jobId
            ? Briefcase
            : UserRound;
  return <ChipBody chip={{ icon, label: context.label, href: context.href ?? null }} className={className} />;
}
