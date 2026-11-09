import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  trend?: { value: number; positive: boolean };
  /** Makes the whole tile a link — a number people want to act on should go somewhere. */
  href?: string;
  /** Colour the value. */
  tone?: "success" | "danger" | "warning";
  /** Rendered under the value — a progress bar, a sub-line. */
  children?: React.ReactNode;
  /** One short tile (label, value, one line) for a row of figures above the fold. */
  compact?: boolean;
}

const VALUE_TONE = {
  success: "text-tone-success-fg",
  danger: "text-tone-danger-fg",
  warning: "text-tone-warning-fg",
} as const;

export function KpiCard({ title, value, description, icon: Icon, trend, href, tone, children, compact }: KpiCardProps) {
  const card = compact ? (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col rounded-lg border bg-card px-3 py-2",
        href && "transition-colors hover:bg-surface-subtle",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{title}</span>
      </div>
      <div className={cn("text-lg leading-tight font-semibold tabular-nums", tone && VALUE_TONE[tone])}>{value}</div>
      {description && (
        <p className="truncate text-2xs text-muted-foreground" title={description}>
          {description}
        </p>
      )}
    </div>
  ) : (
    <Card className={cn(href && "h-full transition-shadow hover:shadow-md hover:ring-1 hover:ring-border-strong")}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold tabular-nums", tone && VALUE_TONE[tone])}>{value}</div>
        {children}
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {trend && (
          <p
            className={`text-xs ${trend.positive ? "text-tone-success-fg" : "text-tone-danger-fg"}`}
          >
            {trend.positive ? "+" : ""}
            {trend.value}% from last period
          </p>
        )}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {card}
    </Link>
  ) : (
    card
  );
}
