"use client";

import { useState } from "react";
import { JobRef } from "@/components/shared/entity-label";
import type { JobLabel } from "@/components/tasks/types";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/shared/callout";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { useCaseAction, type CaseData } from "./use-violations";

type JobRow = JobLabel & { currentStage: { name: string; isClosed: boolean } };

/** Link one of the property's jobs as the corrective work. A closed job stamps corrective-work-complete at once. */
export function LinkJobDialog({ data, open, onOpenChange }: { data: CaseData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: jobs, isLoading } = useQuery<{ data: JobRow[] }>({ queryKey: ["jobs", "for-case", data.leadId], queryFn: () => fetchJson(`/api/jobs?leadId=${data.leadId}&pageSize=100`), enabled: open, retry: retryServerErrors });
  const [picked, setPicked] = useState<string | null>(null);
  const link = useCaseAction<{ jobId: string }>(data.id, "/link-job", { success: "Job linked" });
  const rows = jobs?.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link the corrective job</DialogTitle>
          <DialogDescription>Jobs on this property. The case&apos;s permit and corrective-work steps read from the linked job.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : rows.length === 0 ? (
          <Callout tone="neutral">No jobs on this property yet. Create one from the header menu.</Callout>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {rows.map((j) => (
              <li key={j.id}>
                <button type="button" onClick={() => setPicked(j.id)} className={cn("flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-gray-50", picked === j.id && "border-brand bg-brand/5")}>
                  <JobRef job={j} href={null} customer={false} className="min-w-0 flex-1" />
                  <span className="text-xs text-muted-foreground">{j.currentStage.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={!picked || link.isPending} onClick={() => picked && link.mutate({ jobId: picked }, { onSuccess: () => onOpenChange(false) })}>
            {link.isPending ? "Linking…" : "Link job"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
