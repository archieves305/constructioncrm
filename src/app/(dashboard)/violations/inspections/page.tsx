"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ScheduleList } from "@/components/violations/schedule-list";

export default function InspectionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ScheduleList kind="inspection" />
    </Suspense>
  );
}
