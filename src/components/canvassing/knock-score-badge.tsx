import { cn } from "@/lib/utils";

export type Priority = "high" | "medium" | "low";

export function priorityFromScore(score: number): Priority {
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low";
}

const DOT: Record<Priority, string> = {
  high: "bg-tone-success",
  medium: "bg-tone-warning",
  low: "bg-tone-danger",
};

const RING: Record<Priority, string> = {
  high: "border-tone-success text-tone-success-fg bg-tone-success-soft",
  medium: "border-tone-warning text-tone-warning-fg bg-tone-warning-soft",
  low: "border-tone-danger text-tone-danger-fg bg-tone-danger-soft",
};

// A coloured priority dot — green/amber/red (spec §9).
export function PriorityDot({
  priority,
  className,
}: {
  priority: Priority;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 rounded-full", DOT[priority], className)}
      aria-hidden
    />
  );
}

// Small inline score chip for cards: "92 · Excellent Door Knock".
export function KnockScoreBadge({
  score,
  tier,
  priority,
}: {
  score: number;
  tier: string | null;
  priority?: Priority;
}) {
  const p = priority ?? priorityFromScore(score);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        RING[p],
      )}
    >
      <span className="tabular-nums">{score}</span>
      {tier ? <span className="font-medium">· {tier}</span> : null}
    </span>
  );
}

// Large score circle for the one-screen summary modal (spec §9).
export function KnockScoreBadgeLarge({
  score,
  tier,
  priority,
}: {
  score: number;
  tier: string | null;
  priority?: Priority;
}) {
  const p = priority ?? priorityFromScore(score);
  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          "flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4",
          RING[p],
        )}
      >
        <span className="text-2xl font-bold leading-none tabular-nums">{score}</span>
        <span className="text-3xs uppercase tracking-wide opacity-70">/ 100</span>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <PriorityDot priority={p} />
          <span className="text-base font-semibold">{tier ?? "—"}</span>
        </div>
        <p className="text-xs text-muted-foreground">Knock Score</p>
      </div>
    </div>
  );
}
