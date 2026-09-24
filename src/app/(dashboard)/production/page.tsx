"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { useOptimisticMove } from "@/components/kanban/use-optimistic-move";
import type { KanbanColumnDef } from "@/components/kanban/types";
import { JobBoardCard, type BoardJob } from "@/components/jobs/job-board-card";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { buildStageToneMap, type StageLike } from "@/lib/ui/stage-colors";

type Stage = StageLike & { id: string; isClosed: boolean };
type JobsPayload = { data: BoardJob[] };

const QUERY_KEY = ["jobs", "production-board"] as const;
const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Every job stage from the database, in order — the old hard-coded allow-list
 * hid Measure Complete, Scope Finalized and Permit Corrections. Closed starts
 * collapsed so the live work has the room.
 */
export default function ProductionBoardPage() {
  const router = useRouter();

  const { data: stages = [] } = useQuery<Stage[]>({
    queryKey: ["jobStages"],
    queryFn: () => fetchJson("/api/jobs/stages"),
  });

  const { data: jobsData, isLoading } = useQuery<JobsPayload>({
    queryKey: QUERY_KEY,
    queryFn: () => fetchJson("/api/jobs?pageSize=500&withTaskCounts=true&withWorkflow=true"),
    retry: retryServerErrors,
  });
  const jobs = useMemo(() => jobsData?.data ?? [], [jobsData]);

  const move = useOptimisticMove<JobsPayload, { id: string; toColumnId: string }>({
    queryKey: QUERY_KEY,
    mutationFn: ({ id, toColumnId }) =>
      fetchJson(`/api/jobs/${id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: toColumnId }),
      }),
    applyOptimistic: (old, { id, toColumnId }) => {
      if (!old) return old;
      const stage = stages.find((s) => s.id === toColumnId);
      return {
        ...old,
        data: old.data.map((j) =>
          j.id === id
            ? { ...j, currentStageId: toColumnId, currentStage: { id: toColumnId, name: stage?.name ?? j.currentStage.name } }
            : j,
        ),
      };
    },
    invalidate: [["jobs"]],
    messages: { success: "Job moved", error: "Failed to move job" },
  });

  const columns = useMemo<KanbanColumnDef[]>(() => {
    const tones = buildStageToneMap(stages);
    return [...stages]
      .sort((a, b) => a.stageOrder - b.stageOrder)
      .map((s) => {
        const mine = jobs.filter((j) => j.currentStage.id === s.id);
        const total = mine.reduce((sum, j) => sum + Number(j.contractAmount), 0);
        const overdue = mine.reduce((sum, j) => sum + (j.taskCounts?.overdue ?? 0), 0);
        return {
          id: s.id,
          title: s.name,
          tone: tones.get(s.id)!,
          defaultCollapsed: s.isClosed,
          aggregate:
            mine.length > 0 ? (
              <>
                {money0(total)}
                {overdue > 0 && <span className="text-tone-danger-fg"> · {overdue} overdue</span>}
              </>
            ) : undefined,
        };
      });
  }, [stages, jobs]);

  return (
    <div>
      <PageHeader title="Production Board" description="Drag a job to move it to the next stage. Space picks a card up from the keyboard." />
      <KanbanBoard<BoardJob>
        boardId="production"
        columns={columns}
        items={jobs}
        isLoading={isLoading || stages.length === 0}
        getColumnId={(j) => j.currentStage.id}
        renderCard={(j) => <JobBoardCard job={j} />}
        onMove={(id, toColumnId) => move.mutate({ id, toColumnId })}
        onOpen={(j) => router.push(`/jobs/${j.id}`)}
        columnWidth={272}
        emptyLabel="No jobs here"
      />
    </div>
  );
}
