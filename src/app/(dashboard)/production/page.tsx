"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Briefcase } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Callout } from "@/components/shared/callout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { BoardToolbar } from "@/components/kanban/board-toolbar";
import { useOptimisticMove } from "@/components/kanban/use-optimistic-move";
import type { KanbanColumnDef } from "@/components/kanban/types";
import { JobBoardCard, type BoardJob } from "@/components/jobs/job-board-card";
import { useListScope } from "@/components/shared/use-list-scope";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { useDebouncedValue } from "@/components/shared/use-debounced-value";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { buildStageToneMap, type StageLike } from "@/lib/ui/stage-colors";

type Stage = StageLike & { id: string; isClosed: boolean };
type JobsPayload = { data: BoardJob[]; total: number };
type Assignee = { id: string; firstName: string; lastName: string };

const ALL = "__all";
const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Every job stage from the database, in order — the old hard-coded allow-list
 * hid Measure Complete, Scope Finalized and Permit Corrections. Closed starts
 * collapsed so the live work has the room.
 */
export default function ProductionBoardPage() {
  const router = useRouter();
  const { scope, setScope, forced, ready, density, setDensity } = useListScope();
  const { get, setMany } = useSearchParamState();
  const person = get("person") ?? "";
  const serviceType = get("service") ?? "";
  const [search, setSearch] = useState(get("q") ?? "");
  const q = useDebouncedValue(search.trim(), 300);

  const { data: stages = [] } = useQuery<Stage[]>({ queryKey: ["jobStages"], queryFn: () => fetchJson("/api/jobs/stages") });
  const { data: users = [] } = useQuery<Assignee[]>({ queryKey: ["assignable-users"], queryFn: () => fetchJson("/api/users/assignable") });

  const filters = useMemo(() => ({ scope, q, person, serviceType }), [scope, q, person, serviceType]);
  const queryKey = useMemo(() => ["jobs", "production-board", filters] as const, [filters]);
  const url = useMemo(() => {
    const p = new URLSearchParams({ pageSize: "500", withTaskCounts: "true", withWorkflow: "true", scope });
    if (q) p.set("search", q);
    if (person) p.set("involvesUserId", person);
    if (serviceType) p.set("serviceType", serviceType);
    return `/api/jobs?${p.toString()}`;
  }, [scope, q, person, serviceType]);

  const { data: jobsData, isLoading } = useQuery<JobsPayload>({
    queryKey,
    queryFn: () => fetchJson(url),
    retry: retryServerErrors,
    enabled: ready,
  });
  const jobs = useMemo(() => jobsData?.data ?? [], [jobsData]);
  const total = jobsData?.total ?? 0;

  const move = useOptimisticMove<JobsPayload, { id: string; toColumnId: string }>({
    queryKey,
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

  const countByColumn = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) m.set(j.currentStage.id, (m.get(j.currentStage.id) ?? 0) + 1);
    return m;
  }, [jobs]);

  // Service types come from the loaded jobs (plus whatever is selected), so
  // the menu never offers a value that would empty the board.
  const serviceTypes = useMemo(() => {
    const set = new Set(jobs.map((j) => j.serviceType).filter(Boolean));
    if (serviceType) set.add(serviceType);
    return [...set].sort();
  }, [jobs, serviceType]);

  const activeFilterCount = [q, person, serviceType].filter(Boolean).length;
  const showEmptyMine = ready && !isLoading && jobs.length === 0 && scope === "mine" && activeFilterCount === 0;

  return (
    <div>
      <PageHeader
        title="Production Board"
        description={`${scope === "mine" ? "Your jobs" : "All jobs"} — drag a job to move it to the next stage. Space picks a card up from the keyboard.`}
      />
      <BoardToolbar
        boardId="production"
        columns={columns}
        countByColumn={countByColumn}
        closedColumnIds={stages.filter((s) => s.isClosed).map((s) => s.id)}
        scope={scope}
        onScopeChange={setScope}
        scopeForced={forced}
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setMany({ q: v.trim() || null });
        }}
        density={density}
        onDensityChange={setDensity}
        activeFilterCount={activeFilterCount}
        onClearFilters={() => {
          setSearch("");
          setMany({ q: null, person: null, service: null });
        }}
        mineLabel="My jobs"
        filters={
          <>
            <Select value={person || ALL} onValueChange={(v: string | null) => setMany({ person: !v || v === ALL ? null : v })}>
              <SelectTrigger className="h-8 w-40">
                <SelectValue>{(v: string) => (v === ALL || !v ? "Anyone" : (users.find((u) => u.id === v) ? `${users.find((u) => u.id === v)!.firstName} ${users.find((u) => u.id === v)!.lastName}` : "Person"))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Anyone</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={serviceType || ALL} onValueChange={(v: string | null) => setMany({ service: !v || v === ALL ? null : v })}>
              <SelectTrigger className="h-8 w-44">
                <SelectValue>{(v: string) => (v === ALL || !v ? "Any service" : v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any service</SelectItem>
                {serviceTypes.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
      {showEmptyMine ? (
        <EmptyState
          icon={Briefcase}
          title="You're not on any jobs yet"
          description={
            forced
              ? "Jobs list you once you are the rep, PM, on the workflow team, field-assigned, or on an assigned crew. Ask a manager to add you."
              : "Jobs list you when you're the rep, PM, on the workflow team, field-assigned, or on an assigned crew."
          }
          action={forced ? undefined : <Button variant="brand" onClick={() => setScope("all")}>Show all jobs</Button>}
        />
      ) : (
        <KanbanBoard<BoardJob>
          boardId="production"
          columns={columns}
          items={jobs}
          isLoading={!ready || isLoading || stages.length === 0}
          getColumnId={(j) => j.currentStage.id}
          renderCard={(j, s) => <JobBoardCard job={j} density={s.density} />}
          onMove={(id, toColumnId) => move.mutate({ id, toColumnId })}
          onOpen={(j) => router.push(`/jobs/${j.id}`)}
          columnWidth={272}
          emptyLabel="No jobs here"
          density={density === "COMPACT" ? "compact" : "comfortable"}
          resetKey={JSON.stringify(filters)}
          notice={
            total > jobs.length ? (
              <Callout tone="warning" className="mb-3">
                Showing {jobs.length} of {total} jobs — narrow with search or a filter{scope === "all" ? ", or switch to My jobs" : ""}.
              </Callout>
            ) : null
          }
        />
      )}
    </div>
  );
}
