import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Breadcrumb, type Crumb } from "./breadcrumb";

interface PageHeaderProps {
  title: React.ReactNode;
  /** A status shown beside the title (StatusBadge, Badge). */
  badge?: React.ReactNode;
  /** A back link shown before the title on a record's editor. */
  back?: { href: string; label: string };
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Where this page sits (Canvassing › Prospects); the last crumb is the page itself. */
  breadcrumb?: Crumb[];
}

export function PageHeader({ title, badge, back, description, actions, breadcrumb }: PageHeaderProps) {
  return (
    <div className="mb-6 space-y-2">
      {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
      <div className="flex flex-wrap items-start justify-between gap-3 sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {back && (
              <Link href={back.href} className="text-muted-foreground hover:text-foreground" aria-label={back.label}>
                <ArrowLeft className="size-5" aria-hidden />
              </Link>
            )}
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
            {badge}
          </div>
          {description && (
            <div className="text-muted-foreground text-sm">{description}</div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
