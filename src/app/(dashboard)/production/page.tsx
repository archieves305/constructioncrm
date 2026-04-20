"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

const BOARD_STAGES = [
  "Won",
  "Deposit Needed",
  "Financing Cleared",
  "Permit Submitted",
  "Permit Approved",
  "Materials Ordered",
  "Scheduled",
  "In Progress",
  "Punch List",
  "Final Inspection",
  "Final Payment Due",
  "Closed",
];

type Stage = {
  id: string;
  name: string;
  stageOrder: number;
  isClosed: boolean;
};

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
  currentStageId?: string;
  lead: { fullName: string; city: string };
  salesRep: { firstName: string; lastName: string } | null;
};

export default function ProductionBoardPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [activeJob, setActiveJob] = useState<BoardJob | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const { data: stages } = useQuery<Stage[]>({
    queryKey: ["jobStages"],
    queryFn: () => fetch("/api/jobs/stages").then((r) => r.json()),
  });

  const { data: jobsData } = useQuery<{ data: BoardJob[] }>({
    queryKey: ["jobs", "production-board"],
    queryFn: () => fetch("/api/jobs?pageSize=500").then((r) => r.json()),
  });

  const changeStage = useMutation({
    mutationFn: ({ jobId, stageId }: { jobId: string; stageId: string }) =>
      fetch(`/api/jobs/${jobId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to move job");
        return r.json();
      }),
    onMutate: async ({ jobId, stageId }) => {
      await qc.cancelQueries({ queryKey: ["jobs", "production-board"] });
      const previous = qc.getQueryData<{ data: BoardJob[] }>([
        "jobs",
        "production-board",
      ]);
      const stage = stages?.find((s) => s.id === stageId);
      qc.setQueryData<{ data: BoardJob[] }>(
        ["jobs", "production-board"],
        (old) =>
          old
            ? {
                ...old,
                data: old.data.map((j) =>
                  j.id === jobId
                    ? {
                        ...j,
                        currentStage: { id: stageId, name: stage?.name || "" },
                      }
                    : j,
                ),
              }
            : old,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(["jobs", "production-board"], ctx.previous);
      }
      toast.error("Failed to move job");
    },
    onSuccess: () => {
      toast.success("Job moved");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const jobs = jobsData?.data || [];

  const boardColumns = (stages || [])
    .filter((s) => BOARD_STAGES.includes(s.name))
    .sort((a, b) => a.stageOrder - b.stageOrder);

  const handleDragStart = (event: DragStartEvent) => {
    const job = jobs.find((j) => j.id === event.active.id);
    setActiveJob(job || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveJob(null);
    const { active, over } = event;
    if (!over) return;
    const jobId = String(active.id);
    const targetStageId = String(over.id);
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.currentStage.id === targetStageId) return;
    changeStage.mutate({ jobId, stageId: targetStageId });
  };

  return (
    <div>
      <PageHeader
        title="Production Board"
        description="Drag jobs between stages to update them"
      />

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveJob(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {boardColumns.map((stage) => {
            const stageJobs = jobs.filter((j) => j.currentStage.id === stage.id);
            return (
              <StageColumn
                key={stage.id}
                stage={stage}
                jobs={stageJobs}
                onCardClick={(id) => router.push(`/jobs/${id}`)}
              />
            );
          })}
        </div>

        <DragOverlay>
          {activeJob ? <JobCard job={activeJob} dragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function StageColumn({
  stage,
  jobs,
  onCardClick,
}: {
  stage: Stage;
  jobs: BoardJob[];
  onCardClick: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-[260px] rounded-lg border bg-gray-50 transition-colors ${
        isOver ? "border-blue-400 bg-blue-50" : ""
      }`}
    >
      <div className="flex items-center justify-between border-b bg-white px-3 py-2 rounded-t-lg">
        <span className="text-xs font-medium">{stage.name}</span>
        <Badge variant="secondary" className="text-[10px]">
          {jobs.length}
        </Badge>
      </div>
      <ScrollArea className="h-[calc(100vh-220px)]">
        <div className="space-y-2 p-2">
          {jobs.map((job) => (
            <DraggableJobCard
              key={job.id}
              job={job}
              onClick={() => onCardClick(job.id)}
            />
          ))}
          {jobs.length === 0 && (
            <p className="py-4 text-center text-[10px] text-muted-foreground">
              No jobs
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function DraggableJobCard({
  job,
  onClick,
}: {
  job: BoardJob;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: job.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={isDragging ? "opacity-30" : ""}
    >
      <JobCard job={job} />
    </div>
  );
}

function JobCard({ job, dragging }: { job: BoardJob; dragging?: boolean }) {
  const depPct =
    Number(job.depositRequired) > 0
      ? Math.round(
          (Number(job.depositReceived) / Number(job.depositRequired)) * 100,
        )
      : 0;

  return (
    <Card
      className={`cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${
        dragging ? "shadow-lg ring-2 ring-blue-400" : ""
      }`}
    >
      <CardContent className="p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono font-medium">{job.jobNumber}</span>
          <span className="text-xs font-medium">
            ${Number(job.contractAmount).toLocaleString()}
          </span>
        </div>
        <p className="text-xs font-medium leading-tight">{job.lead.fullName}</p>
        <Badge variant="outline" className="text-[10px]">
          {job.serviceType}
        </Badge>
        {job.nextAction && (
          <div className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
            {job.nextAction}
          </div>
        )}
        <div className="flex items-center gap-1">
          <div className="w-8 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                depPct >= 100 ? "bg-green-500" : "bg-amber-500"
              }`}
              style={{ width: `${Math.min(depPct, 100)}%` }}
            />
          </div>
          <span className="text-[9px] text-muted-foreground">dep {depPct}%</span>
        </div>
      </CardContent>
    </Card>
  );
}
