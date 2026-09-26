import { Skeleton } from "@/components/ui/skeleton";

/** The job page's shape while it loads: header, four tiles, a 1/3–2/3 grid. */
export function JobPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading job">
      <Skeleton className="mb-2 h-3 w-24" />
      <Skeleton className="mb-2 h-7 w-72" />
      <Skeleton className="mb-6 h-4 w-96" />
      <Skeleton className="mb-6 h-10 w-full" />
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-40" />
          <Skeleton className="h-28" />
        </div>
        <div className="lg:col-span-2">
          <Skeleton className="mb-4 h-9 w-full" />
          <Skeleton className="h-80" />
        </div>
      </div>
    </div>
  );
}
