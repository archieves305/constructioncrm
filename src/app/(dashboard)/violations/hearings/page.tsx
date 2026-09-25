"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ScheduleList } from "@/components/violations/schedule-list";

export default function HearingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ScheduleList kind="hearing" />
    </Suspense>
  );
}
