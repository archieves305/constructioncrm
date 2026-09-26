"use client";

import Link from "next/link";
import { Briefcase, ClipboardList, FileText, Gavel, MapPin, Receipt, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { subjectLabel, type SubjectKind } from "@/lib/labels/subject";
import type { TaskEntityContext, TaskListItem } from "./types";

/**
 * "What is this task about?" as one small link — the most specific record
 * first (an invoice beats its job), falling back to the job or lead.
 */

type Chip = { icon: React.ElementType; label: string; href: string | null; mono?: boolean; code?: string | null; title?: string | null };

const ICONS: Record<SubjectKind, React.ElementType> = {
  violation: Gavel,
  invoice: Receipt,
  estimate: FileText,
  dailyLog: ClipboardList,
  prospect: MapPin,
  job: Briefcase,
  lead: UserRound,
};

export function chipForTask(task: TaskListItem): Chip | null {
  const s = subjectLabel(task);
  if (!s) return null;
  // Address first; the number rides along in mono. A placeholder (no real
  // address) falls back to the number itself, so that one stays mono.
  return { icon: ICONS[s.kind], label: s.primary, href: s.href, mono: s.placeholder && !s.code, code: s.code, title: s.secondary };
}

function ChipBody({ chip, className }: { chip: Chip; className?: string }) {
  const Icon = chip.icon;
  const inner = (
    <>
      <Icon className="size-3 shrink-0" />
      <span className={cn("truncate", chip.mono && "font-mono")}>{chip.label}</span>
      {chip.code && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{chip.code}</span>}
    </>
  );
  const cls = cn(
    "inline-flex max-w-full items-center gap-1 rounded-md border bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-700",
    chip.href && "hover:border-gray-300 hover:bg-white hover:text-gray-900",
    className,
  );
  const title = chip.title ?? undefined;
  return chip.href ? (
    <Link href={chip.href} className={cls} title={title} onClick={(e) => e.stopPropagation()}>
      {inner}
    </Link>
  ) : (
    <span className={cls} title={title}>{inner}</span>
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
