"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { caseLabel, type CaseLabelInput } from "@/lib/labels/case";
import { jobLabel, type EntityLabel as EntityLabelValue, type JobLabelInput } from "@/lib/labels/job";

/**
 * A record's name the way users know it: the address first, context under
 * it, the number as a small mono hint. `inline` puts it on one line for
 * table cells and chips.
 */
export function EntityLabel({
  label,
  href,
  size = "sm",
  inline = false,
  className,
}: {
  label: EntityLabelValue;
  href?: string | null;
  size?: "sm" | "md" | "lg";
  inline?: boolean;
  className?: string;
}) {
  const primaryCls = cn(
    "font-medium text-gray-900",
    size === "sm" && "text-sm",
    size === "md" && "text-base",
    size === "lg" && "text-xl font-semibold",
    label.placeholder && "italic",
  );
  const code = label.code ? <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground">{label.code}</span> : null;
  const primary = href ? (
    <Link href={href} className={cn(primaryCls, "hover:underline")} onClick={(e) => e.stopPropagation()}>
      {label.primary}
    </Link>
  ) : (
    <span className={primaryCls}>{label.primary}</span>
  );

  if (inline) {
    return (
      <span className={cn("inline-flex min-w-0 max-w-full items-baseline gap-1.5", className)} title={label.secondary ?? undefined}>
        <span className="truncate">{primary}</span>
        {label.secondary && <span className="hidden truncate text-xs text-muted-foreground sm:inline">· {label.secondary}</span>}
        {code}
      </span>
    );
  }
  return (
    <span className={cn("block min-w-0", className)}>
      <span className="flex items-baseline gap-2">
        <span className="truncate">{primary}</span>
        {code}
      </span>
      {label.secondary && <span className="block truncate text-xs text-muted-foreground">{label.secondary}</span>}
    </span>
  );
}

export function JobRef({
  job,
  href,
  customer = true,
  trade = true,
  ...rest
}: { job: JobLabelInput & { id?: string }; href?: string | null; customer?: boolean; trade?: boolean } & Omit<Parameters<typeof EntityLabel>[0], "label" | "href">) {
  return <EntityLabel label={jobLabel(job, { customer, trade })} href={href === undefined ? (job.id ? `/jobs/${job.id}` : null) : href} {...rest} />;
}

export function CaseRef({ case: c, href, ...rest }: { case: CaseLabelInput & { id?: string }; href?: string | null } & Omit<Parameters<typeof EntityLabel>[0], "label" | "href">) {
  return <EntityLabel label={caseLabel(c)} href={href === undefined ? (c.id ? `/violations/${c.id}` : null) : href} {...rest} />;
}
