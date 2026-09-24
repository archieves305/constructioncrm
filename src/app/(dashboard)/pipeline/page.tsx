"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { useOptimisticMove } from "@/components/kanban/use-optimistic-move";
import type { KanbanColumnDef } from "@/components/kanban/types";
import { LeadBoardCard, type BoardLead } from "@/components/leads/lead-board-card";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { buildStageToneMap, PARKED_STAGE_NAMES, type StageLike } from "@/lib/ui/stage-colors";

type Stage = StageLike & { id: string; isClosed: boolean };
type LeadsPayload = { data: BoardLead[] };

const QUERY_KEY = ["leads", "all-pipeline"] as const;

export default function PipelinePage() {
  const router = useRouter();

  const { data: stages = [] } = useQuery<Stage[]>({
    queryKey: ["stages"],
    queryFn: () => fetchJson("/api/admin/stages"),
  });

  const { data: leadsData, isLoading } = useQuery<LeadsPayload>({
    queryKey: QUERY_KEY,
    queryFn: () => fetchJson("/api/leads?pageSize=500&withTaskCounts=true"),
    retry: retryServerErrors,
  });
  const leads = useMemo(() => leadsData?.data ?? [], [leadsData]);

  const move = useOptimisticMove<LeadsPayload, { id: string; toColumnId: string }>({
    queryKey: QUERY_KEY,
    mutationFn: ({ id, toColumnId }) =>
      fetchJson(`/api/leads/${id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: toColumnId }),
      }),
    applyOptimistic: (old, { id, toColumnId }) =>
      old ? { ...old, data: old.data.map((l) => (l.id === id ? { ...l, currentStageId: toColumnId } : l)) } : old,
    invalidate: [["leads"]],
    messages: { success: "Lead moved", error: "Failed to move lead" },
  });

  const columns = useMemo<KanbanColumnDef[]>(() => {
    const tones = buildStageToneMap(stages);
    // Open stages in order; On Hold last so the progression reads left to right.
    return stages
      .filter((s) => !s.isClosed)
      .sort((a, b) => {
        const pa = PARKED_STAGE_NAMES.has(a.name) ? 1 : 0;
        const pb = PARKED_STAGE_NAMES.has(b.name) ? 1 : 0;
        return pa - pb || a.stageOrder - b.stageOrder;
      })
      .map((s) => {
        const mine = leads.filter((l) => l.currentStageId === s.id);
        const urgent = mine.filter((l) => l.urgent).length;
        return {
          id: s.id,
          title: s.name,
          tone: tones.get(s.id)!,
          defaultCollapsed: PARKED_STAGE_NAMES.has(s.name),
          aggregate: urgent > 0 ? <span className="text-tone-danger-fg">{urgent} urgent</span> : undefined,
        };
      });
  }, [stages, leads]);

  return (
    <div>
      <PageHeader title="Pipeline" description="Drag a lead to move it to the next stage. Won and Lost leave the board." />
      <KanbanBoard<BoardLead>
        boardId="pipeline"
        columns={columns}
        items={leads}
        isLoading={isLoading || stages.length === 0}
        getColumnId={(l) => l.currentStageId}
        renderCard={(l) => <LeadBoardCard lead={l} />}
        onMove={(id, toColumnId) => move.mutate({ id, toColumnId })}
        onOpen={(l) => router.push(`/leads/${l.id}`)}
        columnWidth={280}
        emptyLabel="No leads here"
      />
    </div>
  );
}
