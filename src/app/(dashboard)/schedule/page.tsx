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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { format, startOfWeek, addDays, isSameDay } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Crew = { id: string; name: string; trades: string[]; isActive: boolean };

type ScheduledJob = {
  id: string;
  jobNumber: string;
  serviceType: string;
  scheduledDate: string | null;
  currentStage: { name: string };
  lead: { fullName: string; city: string };
  crewAssignments: { crew: { id: string; name: string; trades: string[] } }[];
};

const UNASSIGNED_CREW_ID = "__unassigned";

export default function SchedulePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [activeJob, setActiveJob] = useState<ScheduledJob | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const { data: jobsData } = useQuery<{ data: ScheduledJob[] }>({
    queryKey: ["jobs", "schedule"],
    queryFn: () => fetch("/api/jobs?pageSize=500").then((r) => r.json()),
  });

  const { data: crewsData } = useQuery<Crew[]>({
    queryKey: ["crews"],
    queryFn: () => fetch("/api/crews").then((r) => r.json()),
  });

  const schedule = useMutation({
    mutationFn: ({
      id,
      scheduledDate,
      crewId,
    }: {
      id: string;
      scheduledDate: string | null;
      crewId: string | null;
    }) =>
      fetch(`/api/jobs/${id}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledDate, crewId }),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to schedule");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Job scheduled");
    },
    onError: () => toast.error("Failed to schedule"),
  });

  const jobs = jobsData?.data || [];
  const activeCrews = (crewsData || []).filter((c) => c.isActive);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const unscheduledJobs = jobs.filter(
    (j) =>
      !j.scheduledDate &&
      !["Closed", "Won", "Deposit Needed"].includes(j.currentStage.name),
  );

  function jobsIn(crewId: string, day: Date): ScheduledJob[] {
    return jobs.filter((j) => {
      if (!j.scheduledDate) return false;
      if (!isSameDay(new Date(j.scheduledDate), day)) return false;
      const firstCrew = j.crewAssignments[0]?.crew.id;
      if (crewId === UNASSIGNED_CREW_ID) return !firstCrew;
      return firstCrew === crewId;
    });
  }

  const handleDragStart = (event: DragStartEvent) => {
    const job = jobs.find((j) => j.id === event.active.id);
    setActiveJob(job || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveJob(null);
    const { active, over } = event;
    if (!over) return;

    const jobId = String(active.id);
    const dropId = String(over.id);

    if (dropId === "unscheduled") {
      schedule.mutate({ id: jobId, scheduledDate: null, crewId: null });
      return;
    }

    const [crewId, dateStr] = dropId.split("::");
    if (!crewId || !dateStr) return;

    schedule.mutate({
      id: jobId,
      scheduledDate: dateStr,
      crewId: crewId === UNASSIGNED_CREW_ID ? null : crewId,
    });
  };

  return (
    <div>
      <PageHeader
        title="Schedule"
        description="Drag jobs onto a crew and day to schedule them"
      />

      <div className="mb-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">
          {format(weekStart, "MMM d")} — {format(addDays(weekStart, 6), "MMM d, yyyy")}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
        >
          Today
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveJob(null)}
      >
        <div className="overflow-x-auto">
          <div className="inline-grid min-w-full gap-px rounded border bg-gray-200"
            style={{
              gridTemplateColumns: `160px repeat(7, minmax(140px, 1fr))`,
            }}
          >
            {/* header row */}
            <div className="bg-white p-2 text-xs font-semibold">Crew</div>
            {weekDays.map((d) => {
              const isToday = isSameDay(d, new Date());
              return (
                <div
                  key={d.toISOString()}
                  className={cn(
                    "bg-white p-2 text-xs font-semibold",
                    isToday && "text-blue-700",
                  )}
                >
                  {format(d, "EEE M/d")}
                </div>
              );
            })}

            {/* crew rows */}
            {[...activeCrews, {
              id: UNASSIGNED_CREW_ID,
              name: "Unassigned",
              trades: [],
              isActive: true,
            } as Crew].map((crew) => (
              <CrewRow
                key={crew.id}
                crew={crew}
                weekDays={weekDays}
                jobsIn={jobsIn}
                onCardClick={(id) => router.push(`/jobs/${id}`)}
              />
            ))}
          </div>
        </div>

        {/* Unscheduled pool */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">
              Unscheduled Jobs ({unscheduledJobs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UnscheduledZone
              jobs={unscheduledJobs}
              onCardClick={(id) => router.push(`/jobs/${id}`)}
            />
          </CardContent>
        </Card>

        <DragOverlay>{activeJob ? <JobPill job={activeJob} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function CrewRow({
  crew,
  weekDays,
  jobsIn,
  onCardClick,
}: {
  crew: Crew;
  weekDays: Date[];
  jobsIn: (crewId: string, day: Date) => ScheduledJob[];
  onCardClick: (id: string) => void;
}) {
  return (
    <>
      <div className="bg-white p-2">
        <div className="text-sm font-medium">{crew.name}</div>
        {crew.trades.length > 0 && (
          <div className="text-[10px] text-muted-foreground">
            {crew.trades.join(", ")}
          </div>
        )}
      </div>
      {weekDays.map((day) => {
        const cellJobs = jobsIn(crew.id, day);
        const dropId = `${crew.id}::${day.toISOString().slice(0, 10)}`;
        return (
          <DroppableCell key={dropId} id={dropId} jobs={cellJobs} onCardClick={onCardClick} />
        );
      })}
    </>
  );
}

function DroppableCell({
  id,
  jobs,
  onCardClick,
}: {
  id: string;
  jobs: ScheduledJob[];
  onCardClick: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[80px] space-y-1 bg-white p-1 transition-colors",
        isOver && "bg-blue-50",
      )}
    >
      {jobs.map((j) => (
        <DraggableJobPill key={j.id} job={j} onClick={() => onCardClick(j.id)} />
      ))}
    </div>
  );
}

function UnscheduledZone({
  jobs,
  onCardClick,
}: {
  jobs: ScheduledJob[];
  onCardClick: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "unscheduled" });
  if (jobs.length === 0) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground transition-colors",
          isOver && "bg-blue-50 border-blue-300",
        )}
      >
        Drop here to unschedule
      </div>
    );
  }
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-wrap gap-2 rounded-md border border-dashed p-3 transition-colors",
        isOver && "bg-blue-50 border-blue-300",
      )}
    >
      {jobs.map((j) => (
        <DraggableJobPill key={j.id} job={j} onClick={() => onCardClick(j.id)} />
      ))}
    </div>
  );
}

function DraggableJobPill({
  job,
  onClick,
}: {
  job: ScheduledJob;
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
      className={cn("w-full", isDragging && "opacity-30")}
    >
      <JobPill job={job} />
    </div>
  );
}

function JobPill({ job, dragging }: { job: ScheduledJob; dragging?: boolean }) {
  return (
    <div
      className={cn(
        "cursor-grab rounded border bg-blue-50 p-1.5 text-[10px] active:cursor-grabbing hover:bg-blue-100",
        dragging && "shadow-lg ring-2 ring-blue-400",
      )}
    >
      <div className="font-mono font-medium">{job.jobNumber}</div>
      <div className="truncate">{job.lead.fullName}</div>
      <Badge variant="outline" className="mt-0.5 px-1 py-0 text-[9px]">
        {job.serviceType}
      </Badge>
    </div>
  );
}
