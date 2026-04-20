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

type Stage = {
  id: string;
  name: string;
  stageOrder: number;
  isClosed: boolean;
};

type Lead = {
  id: string;
  fullName: string;
  primaryPhone: string;
  source: { name: string } | null;
  services: { serviceCategory: { name: string } }[];
  assignedUser: { firstName: string; lastName: string } | null;
  currentStageId: string;
  urgent: boolean;
};

export default function PipelinePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const { data: stages } = useQuery<Stage[]>({
    queryKey: ["stages"],
    queryFn: () => fetch("/api/admin/stages").then((r) => r.json()),
  });

  const { data: leadsData } = useQuery<{ data: Lead[] }>({
    queryKey: ["leads", "all-pipeline"],
    queryFn: () => fetch("/api/leads?pageSize=500").then((r) => r.json()),
  });

  const changeStage = useMutation({
    mutationFn: ({ leadId, stageId }: { leadId: string; stageId: string }) =>
      fetch(`/api/leads/${leadId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to move lead");
        return r.json();
      }),
    onMutate: async ({ leadId, stageId }) => {
      await queryClient.cancelQueries({ queryKey: ["leads", "all-pipeline"] });
      const previous = queryClient.getQueryData<{ data: Lead[] }>([
        "leads",
        "all-pipeline",
      ]);
      queryClient.setQueryData<{ data: Lead[] }>(
        ["leads", "all-pipeline"],
        (old) =>
          old
            ? {
                ...old,
                data: old.data.map((l) =>
                  l.id === leadId ? { ...l, currentStageId: stageId } : l
                ),
              }
            : old
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["leads", "all-pipeline"], ctx.previous);
      }
      toast.error("Failed to move lead");
    },
    onSuccess: () => {
      toast.success("Lead moved");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });

  const leads = leadsData?.data || [];

  const stageColumns = (stages || [])
    .filter((s) => !s.isClosed)
    .sort((a, b) => a.stageOrder - b.stageOrder);

  const handleDragStart = (event: DragStartEvent) => {
    const lead = leads.find((l) => l.id === event.active.id);
    setActiveLead(lead || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveLead(null);
    const { active, over } = event;
    if (!over) return;

    const leadId = String(active.id);
    const targetStageId = String(over.id);
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.currentStageId === targetStageId) return;

    changeStage.mutate({ leadId, stageId: targetStageId });
  };

  return (
    <div>
      <PageHeader title="Pipeline" description="Drag leads between stages" />

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveLead(null)}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stageColumns.map((stage) => {
            const stageLeads = leads.filter(
              (l) => l.currentStageId === stage.id
            );
            return (
              <StageColumn
                key={stage.id}
                stage={stage}
                leads={stageLeads}
                onCardClick={(id) => router.push(`/leads/${id}`)}
              />
            );
          })}
        </div>

        <DragOverlay>
          {activeLead ? <LeadCard lead={activeLead} dragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function StageColumn({
  stage,
  leads,
  onCardClick,
}: {
  stage: Stage;
  leads: Lead[];
  onCardClick: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-[280px] rounded-lg border bg-gray-50 transition-colors ${
        isOver ? "border-blue-400 bg-blue-50" : ""
      }`}
    >
      <div className="flex items-center justify-between border-b bg-white px-3 py-2 rounded-t-lg">
        <span className="text-sm font-medium">{stage.name}</span>
        <Badge variant="secondary" className="text-xs">
          {leads.length}
        </Badge>
      </div>

      <ScrollArea className="h-[calc(100vh-220px)]">
        <div className="space-y-2 p-2">
          {leads.map((lead) => (
            <DraggableLeadCard
              key={lead.id}
              lead={lead}
              onClick={() => onCardClick(lead.id)}
            />
          ))}
          {leads.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No leads
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function DraggableLeadCard({
  lead,
  onClick,
}: {
  lead: Lead;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={isDragging ? "opacity-30" : ""}
    >
      <LeadCard lead={lead} />
    </div>
  );
}

function LeadCard({ lead, dragging }: { lead: Lead; dragging?: boolean }) {
  return (
    <Card
      className={`cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${
        dragging ? "shadow-lg ring-2 ring-blue-400" : ""
      }`}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between">
          <p className="text-sm font-medium leading-tight">{lead.fullName}</p>
          {lead.urgent && (
            <Badge
              variant="destructive"
              className="text-[10px] px-1 py-0 ml-1"
            >
              !
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{lead.primaryPhone}</p>
        {lead.services?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {lead.services.slice(0, 2).map((s, i) => (
              <Badge
                key={i}
                variant="outline"
                className="text-[10px] px-1 py-0"
              >
                {s.serviceCategory.name}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {lead.assignedUser
              ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName[0]}.`
              : "Unassigned"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
