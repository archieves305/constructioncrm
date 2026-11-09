import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "3 tasks" or "⚠ 1/3 tasks". Nothing at all when there is nothing to say —
 * an empty badge on every row is noise, not information. Same look as the
 * chips the jobs and leads lists already draw, now in one place.
 */
export function TaskCountBadge({
  open,
  overdue,
  className,
  compact = false,
}: {
  open: number;
  overdue: number;
  className?: string;
  compact?: boolean;
}) {
  if (open === 0 && overdue === 0) return null;
  const hasOverdue = overdue > 0;
  return (
    <span
      title={hasOverdue ? `${overdue} overdue of ${open} open` : `${open} open task${open === 1 ? "" : "s"}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-medium tabular-nums",
        hasOverdue ? "bg-tone-danger-soft text-tone-danger-fg" : "bg-tone-info-soft text-tone-info-fg",
        className,
      )}
    >
      {hasOverdue && <AlertTriangle className="size-3" />}
      {hasOverdue ? `${overdue}/${open}` : open}
      {!compact && <span className="font-normal">{open === 1 && !hasOverdue ? "task" : "tasks"}</span>}
    </span>
  );
}
