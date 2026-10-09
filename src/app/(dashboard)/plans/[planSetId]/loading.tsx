import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      <div className="border-b px-4 py-3"><Skeleton className="h-5 w-64" /></div>
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_320px]">
        <div className="space-y-2 border-r p-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        <Skeleton className="m-4 rounded-md" />
        <div className="space-y-2 border-l p-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
      </div>
    </div>
  );
}
