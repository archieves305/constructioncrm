import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

/** Where you are, as links — instead of a "Back to" button that only goes one way. */
export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("flex flex-wrap items-center gap-1 text-xs text-muted-foreground", className)}>
      {items.map((b, i) => (
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
  );
}
