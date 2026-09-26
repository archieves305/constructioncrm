import { Breadcrumb, type Crumb } from "./breadcrumb";

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Where this page sits (Canvassing › Prospects); the last crumb is the page itself. */
  breadcrumb?: Crumb[];
}

export function PageHeader({ title, description, actions, breadcrumb }: PageHeaderProps) {
  return (
    <div className="mb-6 space-y-2">
      {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
      <div className="flex flex-wrap items-start justify-between gap-3 sm:items-center">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {description && (
            <div className="text-muted-foreground text-sm">{description}</div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
