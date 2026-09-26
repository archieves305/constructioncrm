import { cn } from "@/lib/utils";
import { Breadcrumb, type Crumb } from "./breadcrumb";

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
  breadcrumb: Crumb[];
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 space-y-3", className)}>
      <Breadcrumb items={breadcrumb} />
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
