"use client";

import Link from "next/link";
import { formatAddressLine } from "@/lib/labels/address";
import { format } from "date-fns";
import { AlertTriangle, Ban, CalendarClock, ClipboardCheck, DollarSign, Gavel, Hourglass, Landmark, Shield, Siren } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toneClasses } from "@/lib/ui/tones";
import { describeDaysRemaining } from "@/lib/violations/dates";
import type { CaseFlag, CaseState } from "@/lib/violations/state";
import { cn } from "@/lib/utils";
import { CASE_STATUS_LABEL, CASE_STATUS_TONE, FLAG_LABEL, ROW_FLAGS } from "./status";
import type { CaseRow } from "./use-violations";

/** Lifecycle pill. */
export function CaseStatusPill({ status, className }: { status: string; className?: string }) {
  return <Badge className={cn("border-0 text-[11px]", toneClasses(CASE_STATUS_TONE[status] ?? "neutral").pill, className)}>{CASE_STATUS_LABEL[status] ?? status}</Badge>;
}

/** The derived "where it is" label (phase + flags), or the lifecycle when not active. */
export function CasePhasePill({ state, className }: { state: Pick<CaseState, "label" | "status" | "overdue">; className?: string }) {
  const tone = state.overdue ? "danger" : state.status === "ACTIVE" ? "info" : (CASE_STATUS_TONE[state.status] ?? "neutral");
  return <Badge variant="outline" className={cn("text-[11px]", toneClasses(tone).text, className)}>{state.label}</Badge>;
}

const FLAG_ICON: Partial<Record<CaseFlag, { icon: React.ElementType; className: string }>> = {
  fines_accruing: { icon: DollarSign, className: "text-tone-warning-fg" },
  lien_recorded: { icon: Landmark, className: "text-tone-warning-fg" },
  hearing_scheduled: { icon: Gavel, className: "text-tone-info-fg" },
  inspection_scheduled: { icon: ClipboardCheck, className: "text-tone-info-fg" },
  permit_undetermined: { icon: Shield, className: "text-tone-warning-fg" },
  permit_pending: { icon: Shield, className: "text-tone-info-fg" },
  blocked_work: { icon: Ban, className: "text-tone-danger-fg" },
  awaiting_agency: { icon: Hourglass, className: "text-tone-info-fg" },
  emergency: { icon: Siren, className: "text-tone-danger-fg" },
};

/** Icon strip with tooltips. */
export function CaseFlags({ flags, className }: { flags: CaseFlag[]; className?: string }) {
  const shown = ROW_FLAGS.filter((f) => flags.includes(f));
  if (shown.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {shown.map((f) => {
        const def = FLAG_ICON[f];
        if (!def) return null;
        const Icon = def.icon;
        return <Icon key={f} className={cn("size-3.5", def.className)} aria-label={FLAG_LABEL[f]} />;
      })}
    </span>
  );
}

/** "Oct 14 · in 12 days" coloured by urgency. */
export function DeadlineCell({ at, done, className }: { at: string | null; done?: boolean; className?: string }) {
  if (!at) return <span className={cn("text-xs text-muted-foreground", className)}>No deadline</span>;
  const d = new Date(at);
  const now = new Date();
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  const tone = done ? "text-muted-foreground" : days < 0 ? "text-tone-danger-fg font-semibold" : days <= 7 ? "text-tone-warning-fg font-medium" : "text-gray-700";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", tone, className)}>
      {days < 0 && !done ? <AlertTriangle className="size-3" /> : <CalendarClock className="size-3 opacity-70" />}
      {format(d, "MMM d, yyyy")}
      {!done && <span className="opacity-80">· {describeDaysRemaining(d, now)}</span>}
    </span>
  );
}

/** Phase name + progress bar, or "No workflow". */
export function CasePhaseCell({ row }: { row: Pick<CaseRow, "workflow"> }) {
  const s = row.workflow?.summary;
  if (!s) return <span className="text-xs text-muted-foreground">No workflow</span>;
  const pct = s.total > 0 ? Math.round(((s.done + s.skipped) / s.total) * 100) : 0;
  return (
    <div className="min-w-[140px]">
      <div className="truncate text-xs">{s.currentPhase?.name ?? (s.status === "COMPLETED" ? "Complete" : "—")}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <Progress value={s.done + s.skipped} max={s.total} className="h-1 w-20" indicatorClassName={pct === 100 ? "bg-tone-success" : undefined} label={`${pct}% complete`} />
        <span className="text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
      </div>
    </div>
  );
}

export function CaseNumberLink({ id, caseNumber, className }: { id: string; caseNumber: string; className?: string }) {
  return (
    <Link href={`/violations/${id}`} className={cn("font-mono text-sm font-medium text-brand-fg hover:underline", className)} onClick={(e) => e.stopPropagation()}>
      {caseNumber}
    </Link>
  );
}

export function addressOf(lead: { propertyAddress1: string; propertyAddress2?: string | null; city: string; state?: string } | null | undefined): string {
  return formatAddressLine(lead) || (lead ? `${lead.propertyAddress1}, ${lead.city}` : "");
}
