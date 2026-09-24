import { cn } from "@/lib/utils";

/**
 * A determinate bar. Hand-rolled progress bars lived in four places with
 * four heights; this is the one. `indicatorClassName` colours the fill.
 */
export function Progress({
  value,
  max = 100,
  className,
  indicatorClassName,
  label,
}: {
  value: number;
  max?: number;
  className?: string;
  indicatorClassName?: string;
  /** Accessible label, e.g. "Deposit 80%". */
  label?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-gray-100", className)}
    >
      <div
        className={cn("h-full rounded-full bg-brand transition-[width]", indicatorClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
