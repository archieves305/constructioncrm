import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The header for a record page: a breadcrumb instead of a "Back to" button,
 * the record's name large, and actions on the right. `children` is the row
 * under it — a stage stepper on jobs and leads.
 */
export function EntityHeader({
  breadcrumb,
  title,
  subtitle,
  badges,
  actions,
  children,
  className,
}: {
  breadcrumb: { label: string; href?: string }[];
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 space-y-3", className)}>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
        {breadcrumb.map((b, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3" />}
            {b.href ? (
              <Link href={b.href} className="hover:text-foreground hover:underline">
                {b.label}
              </Link>
            ) : (
              <span className="text-foreground">{b.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {badges}
          </div>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
