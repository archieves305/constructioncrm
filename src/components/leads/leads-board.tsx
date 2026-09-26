"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Callout } from "@/components/shared/callout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { BoardToolbar } from "@/components/kanban/board-toolbar";
import { useOptimisticMove } from "@/components/kanban/use-optimistic-move";
import type { KanbanColumnDef } from "@/components/kanban/types";
import { LeadBoardCard, type BoardLead } from "@/components/leads/lead-board-card";
import { useListScope } from "@/components/shared/use-list-scope";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { useDebouncedValue } from "@/components/shared/use-debounced-value";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { buildStageToneMap, PARKED_STAGE_NAMES, type StageLike } from "@/lib/ui/stage-colors";

type Stage = StageLike & { id: string; isClosed: boolean };
type LeadsPayload = { data: BoardLead[]; total: number };
type Assignee = { id: string; firstName: string; lastName: string };
type ServiceCategory = { id: string; name: string };

const ALL = "__all";

export function LeadsBoard() {
  const router = useRouter();
  const { scope, setScope, forced, ready, density, setDensity } = useListScope();
  const { get, setMany } = useSearchParamState();
  const assignee = get("assignee") ?? "";
  const service = get("service") ?? "";
  const [search, setSearch] = useState(get("q") ?? "");
  const q = useDebouncedValue(search.trim(), 300);

  const { data: stages = [] } = useQuery<Stage[]>({ queryKey: ["stages"], queryFn: () => fetchJson("/api/admin/stages") });
  const { data: users = [] } = useQuery<Assignee[]>({ queryKey: ["assignable-users"], queryFn: () => fetchJson("/api/users/assignable") });
  const { data: services = [] } = useQuery<ServiceCategory[]>({ queryKey: ["services"], queryFn: () => fetchJson("/api/admin/services") });

  const filters = useMemo(() => ({ scope, q, assignee, service }), [scope, q, assignee, service]);
  const queryKey = useMemo(() => ["leads", "all-pipeline", filters] as const, [filters]);
  const url = useMemo(() => {
    const p = new URLSearchParams({ pageSize: "500", withTaskCounts: "true", scope });
    if (q) p.set("search", q);
    if (assignee) p.set("assignedUserId", assignee);
    if (service) p.set("serviceCategoryId", service);
    return `/api/leads?${p.toString()}`;
  }, [scope, q, assignee, service]);

  const { data: leadsData, isLoading } = useQuery<LeadsPayload>({
    queryKey,
    queryFn: () => fetchJson(url),
    retry: retryServerErrors,
    enabled: ready,
  });
  const leads = useMemo(() => leadsData?.data ?? [], [leadsData]);
  const total = leadsData?.total ?? 0;

  const move = useOptimisticMove<LeadsPayload, { id: string; toColumnId: string }>({
    queryKey,
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

  const countByColumn = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) m.set(l.currentStageId, (m.get(l.currentStageId) ?? 0) + 1);
    return m;
  }, [leads]);

  const activeFilterCount = [q, assignee, service].filter(Boolean).length;
  const showEmptyMine = ready && !isLoading && leads.length === 0 && scope === "mine" && activeFilterCount === 0;

  return (
    <div>
      <BoardToolbar
        boardId="pipeline"
        columns={columns}
        countByColumn={countByColumn}
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
          setMany({ q: null, assignee: null, service: null });
        }}
        mineLabel="My leads"
        filters={
          <>
            <Select value={assignee || ALL} onValueChange={(v: string | null) => setMany({ assignee: !v || v === ALL ? null : v })}>
              <SelectTrigger className="h-8 w-40">
                <SelectValue>{(v: string) => (v === ALL || !v ? "Anyone" : (users.find((u) => u.id === v) ? `${users.find((u) => u.id === v)!.firstName} ${users.find((u) => u.id === v)!.lastName}` : "Assignee"))}</SelectValue>
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
            <Select value={service || ALL} onValueChange={(v: string | null) => setMany({ service: !v || v === ALL ? null : v })}>
              <SelectTrigger className="h-8 w-44">
                <SelectValue>{(v: string) => (v === ALL || !v ? "Any service" : (services.find((s) => s.id === v)?.name ?? "Service"))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any service</SelectItem>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
      {showEmptyMine ? (
        <EmptyState
          icon={Users}
          title="You're not on any open leads yet"
          description={forced ? "Leads list you once a manager assigns them to you." : "Leads list you when they are assigned to you or you have a role on their job."}
          action={forced ? undefined : <Button variant="brand" onClick={() => setScope("all")}>Show all leads</Button>}
        />
      ) : (
        <KanbanBoard<BoardLead>
          boardId="pipeline"
          columns={columns}
          items={leads}
          isLoading={!ready || isLoading || stages.length === 0}
          getColumnId={(l) => l.currentStageId}
          renderCard={(l, s) => <LeadBoardCard lead={l} density={s.density} />}
          onMove={(id, toColumnId) => move.mutate({ id, toColumnId })}
          onOpen={(l) => router.push(`/leads/${l.id}`)}
          columnWidth={280}
          emptyLabel="No leads here"
          density={density === "COMPACT" ? "compact" : "comfortable"}
          resetKey={JSON.stringify(filters)}
          notice={
            total > leads.length ? (
              <Callout tone="warning" className="mb-3">
                Showing {leads.length} of {total} leads — narrow with search or a filter{scope === "all" ? ", or switch to My leads" : ""}.
              </Callout>
            ) : null
          }
        />
      )}
    </div>
  );
}
