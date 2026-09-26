import { ListSkeleton } from "@/components/shared/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Shown while a page's server render streams in — the page's own shape follows. */
export default function Loading() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-2 h-7 w-56" />
      <Skeleton className="mb-6 h-4 w-80" />
      <ListSkeleton rows={6} />
    </div>
  );
}
