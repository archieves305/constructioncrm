import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Rows of grey while a list loads — the shape of what is coming, not the word "Loading". */
export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
