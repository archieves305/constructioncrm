import { cn } from "@/lib/utils";
import { statusOf, type StatusKind } from "@/lib/ui/status";
import { toneClasses } from "@/lib/ui/tones";

/**
 * The one way to show a status: its plain label on a tinted chip with a dot.
 * The label carries the meaning, so colour is never the only signal.
 *
 *   <StatusBadge kind="changeOrder" value={co.status} />
 */
export function StatusBadge({ kind, value, className, dot = true }: { kind: StatusKind; value: string | null | undefined; className?: string; dot?: boolean }) {
  const s = statusOf(kind, value);
  if (!s) return <span className="text-xs text-muted-foreground">—</span>;
  const t = toneClasses(s.tone);
  return (
    <span data-slot="status-badge" data-status={value ?? undefined} className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-2xs font-medium whitespace-nowrap", t.pill, className)}>
      {dot && <span className={cn("size-1.5 rounded-full", t.dot)} aria-hidden />}
      {s.label}
    </span>
  );
}
