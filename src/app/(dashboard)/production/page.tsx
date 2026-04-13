"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const BOARD_STAGES = [
  "Won", "Deposit Needed", "Financing Cleared", "Permit Submitted",
  "Permit Approved", "Materials Ordered", "Scheduled", "In Progress",
  "Punch List", "Final Inspection", "Final Payment Due", "Closed",
];

type BoardJob = {
  id: string;
  jobNumber: string;
  title: string;
  serviceType: string;
  contractAmount: string;
  balanceDue: string;
  depositReceived: string;
  depositRequired: string;
  nextAction: string | null;
  currentStage: { id: string; name: string };
  lead: { fullName: string; city: string };
  salesRep: { firstName: string; lastName: string } | null;
};

export default function ProductionBoardPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: stages } = useQuery({
    queryKey: ["jobStages"],
    queryFn: () => fetch("/api/jobs/stages").then((r) => r.json()),
  });

  const { data: jobsData } = useQuery({
    queryKey: ["jobs", "production-board"],
    queryFn: () => fetch("/api/jobs?pageSize=500").then((r) => r.json()),
  });

  const changeStage = useMutation({
    mutationFn: ({ jobId, stageId }: { jobId: string; stageId: string }) =>
      fetch(`/api/jobs/${jobId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); toast.success("Job moved"); },
  });

  const jobs: BoardJob[] = jobsData?.data || [];

  const boardColumns = (stages || [])
    .filter((s: { name: string }) => BOARD_STAGES.includes(s.name))
    .sort((a: { stageOrder: number }, b: { stageOrder: number }) => a.stageOrder - b.stageOrder);

  return (
    <div>
      <PageHeader title="Production Board" description="Track jobs through production lifecycle" />

      <div className="flex gap-3 overflow-x-auto pb-4">
        {boardColumns.map((stage: { id: string; name: string }) => {
          const stageJobs = jobs.filter((j) => j.currentStage.id === stage.id);

          return (
            <div key={stage.id} className="flex-shrink-0 w-[260px] rounded-lg border bg-gray-50">
              <div className="flex items-center justify-between border-b bg-white px-3 py-2 rounded-t-lg">
                <span className="text-xs font-medium">{stage.name}</span>
                <Badge variant="secondary" className="text-[10px]">{stageJobs.length}</Badge>
              </div>
              <ScrollArea className="h-[calc(100vh-220px)]">
                <div className="space-y-2 p-2">
                  {stageJobs.map((job) => {
                    const depPct = Number(job.depositRequired) > 0
                      ? Math.round((Number(job.depositReceived) / Number(job.depositRequired)) * 100) : 0;

                    return (
                      <Card key={job.id} className="cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => router.push(`/jobs/${job.id}`)}>
                        <CardContent className="p-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-medium">{job.jobNumber}</span>
                            <span className="text-xs font-medium">${Number(job.contractAmount).toLocaleString()}</span>
                          </div>
                          <p className="text-xs font-medium leading-tight">{job.lead.fullName}</p>
                          <Badge variant="outline" className="text-[10px]">{job.serviceType}</Badge>
                          {job.nextAction && (
                            <div className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                              {job.nextAction}
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                              <div className="w-8 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${depPct >= 100 ? "bg-green-500" : "bg-amber-500"}`}
                                  style={{ width: `${Math.min(depPct, 100)}%` }} />
                              </div>
                              <span className="text-[9px] text-muted-foreground">dep</span>
                            </div>
                            <Select value={job.currentStage.id}
                              onValueChange={(v: string | null) => v && changeStage.mutate({ jobId: job.id, stageId: v })}>
                              <SelectTrigger className="h-5 w-5 p-0 border-0 [&>svg]:h-3 [&>svg]:w-3">
                                <span className="sr-only">Move</span>
                              </SelectTrigger>
                              <SelectContent>
                                {stages?.map((s: { id: string; name: string }) => (
                                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {stageJobs.length === 0 && (
                    <p className="py-4 text-center text-[10px] text-muted-foreground">No jobs</p>
                  )}
                </div>
              </ScrollArea>
            </div>
          );
        })}
      </div>
    </div>
  );
}
