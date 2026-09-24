"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Route, Users, Landmark, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { AddTaskDialog } from "@/components/tasks/add-task-dialog";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { useAssignableUsers, useUpdateTask } from "@/components/tasks/use-tasks";
import type { UpdatePatch } from "@/components/tasks/types";
import { useSession } from "@/lib/auth/session-client";
import { canEditTask } from "@/lib/tasks/access";
import { fetchJson } from "@/lib/fetch-json";
import { WORKFLOW_ROLE_LABEL } from "@/lib/workflows/role-labels";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { ApplyWorkflowDialog } from "./apply-workflow-dialog";
import { CompleteTaskDialog } from "./complete-task-dialog";
import { PhaseSection } from "./phase-section";
import { SkipTaskDialog } from "./skip-task-dialog";
import { deriveTaskState, PERMIT_STATUS_LABEL, PERMIT_STATUS_TONE, type WorkflowTaskState } from "./status";
import { useAddWorkflowTask, useInvalidateWorkflow, useJobWorkflow, usePatchWorkflow } from "./use-workflow";
import { WorkflowTaskRow } from "./workflow-task-row";
import { WorkflowTeamDialog } from "./workflow-team-dialog";
import type { WorkflowTaskItem } from "./types";

type Chip = "ready" | "inProgress" | "blocked" | "overdue" | "notActive" | "skipped" | null;

/**
 * The Workflow tab. Summary strip (modules, permit status, progress, team),
 * count chips that filter, then the phases in band order with a row per
 * step. Every row edit goes through the same task hooks as the rest of the
 * app, so the Tasks tab and /tasks agree with what is shown here.
 */
export function JobWorkflowPanel({ jobId }: { jobId: string }) {
  const { data: session } = useSession();
  const { data, isLoading, error } = useJobWorkflow(jobId);
  const { data: users = [] } = useAssignableUsers();
  const invalidate = useInvalidateWorkflow(jobId);
  const update = useUpdateTask({ invalidateKeys: [["job-workflow", jobId]] });
  const patchWorkflow = usePatchWorkflow(jobId);
  const addTask = useAddWorkflowTask(jobId);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [chip, setChip] = useState<Chip>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [permitOpen, setPermitOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [skipTarget, setSkipTarget] = useState<WorkflowTaskItem | null>(null);
  const [completeTarget, setCompleteTarget] = useState<WorkflowTaskItem | null>(null);
  const [addPhaseKey, setAddPhaseKey] = useState<string | null>(null);

  // `?apply=1` (from the post-Won toast) opens the dialog once, then clears itself.
  const wantsApply = searchParams.get("apply") === "1";
  useEffect(() => {
    if (wantsApply && data && !data.instance && data.permissions.canApply) {
      setApplyOpen(true);
      const next = new URLSearchParams(searchParams.toString());
      next.delete("apply");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsApply, data?.instance?.id, data?.permissions.canApply]);

  // Deep link: #task-<id> scrolls to the row and opens it.
  useEffect(() => {
    if (!data?.tasks || typeof window === "undefined") return;
    const m = window.location.hash.match(/^#task-(.+)$/);
    if (!m) return;
    const id = m[1]!;
    if (data.tasks.some((t) => t.id === id)) {
      setOpenTaskId(id);
      requestAnimationFrame(() => document.getElementById(`task-${id}`)?.scrollIntoView({ block: "center" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.tasks?.length]);

  const tasksById = useMemo(() => new Map((data?.tasks ?? []).map((t) => [t.id, t])), [data?.tasks]);
  const now = Date.now();

  const matches = (t: WorkflowTaskItem): boolean => {
    if (!chip) return true;
    const s = deriveTaskState(t);
    switch (chip) {
      case "ready":
        return s === "READY";
      case "inProgress":
        return s === "IN_PROGRESS";
      case "blocked":
        return s === "BLOCKED" || s === "FAILED_INSPECTION";
      case "notActive":
        return s === "NOT_ACTIVE";
      case "skipped":
        return s === "SKIPPED";
      case "overdue":
        return Boolean(t.dueAt) && new Date(t.dueAt!).getTime() < now && t.activatedAt !== null && s !== "COMPLETED" && s !== "SKIPPED" && s !== "CANCELLED";
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <Callout tone="danger" title="Couldn't load the workflow">
        {error instanceof Error ? error.message : "Something went wrong."}
      </Callout>
    );
  }

  const user = session?.user;
  const canApply = data.permissions.canApply;

  if (!data.instance) {
    return (
      <div className="rounded-lg border bg-white">
        <EmptyState
          icon={Route}
          title="No workflow on this job yet"
          description="Apply Core Construction plus the trades on this job to generate every step in order, with owners, due dates and the permit branch."
          action={
            canApply ? (
              <Button variant="brand" onClick={() => setApplyOpen(true)}>
                <Route className="size-4" /> Apply workflow
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">An admin or manager can apply one.</p>
            )
          }
        />
        <ApplyWorkflowDialog jobId={jobId} data={data} open={applyOpen} onOpenChange={setApplyOpen} />
      </div>
    );
  }

  const inst = data.instance;
  const progress = data.progress!;
  const closed = progress.done + progress.skipped;
  const pct = progress.total > 0 ? Math.round((closed / progress.total) * 100) : 0;
  const permitTone = toneClasses(PERMIT_STATUS_TONE[inst.permitStatus]);
  const team = data.team ?? [];
  const unassigned = data.unassignedRoles ?? [];

  const chips: { key: Exclude<Chip, null>; label: string; n: number; tone: string }[] = [
    { key: "ready", label: "Ready", n: progress.ready, tone: "bg-tone-info-soft text-tone-info-fg" },
    { key: "inProgress", label: "In progress", n: progress.inProgress, tone: "bg-blue-100 text-blue-800" },
    { key: "blocked", label: "Blocked", n: progress.blocked, tone: "bg-tone-warning-soft text-tone-warning-fg" },
    { key: "overdue", label: "Overdue", n: progress.overdue, tone: "bg-tone-danger-soft text-tone-danger-fg" },
    { key: "notActive", label: "Not active", n: progress.notActive, tone: "bg-gray-100 text-gray-600" },
    { key: "skipped", label: "Skipped", n: progress.skipped, tone: "bg-gray-100 text-gray-500" },
  ];

  const rowUpdate = (t: WorkflowTaskItem, patch: UpdatePatch & { dueLocked?: boolean }) => {
    if (patch.status === "CANCELLED" && t.workflowTaskKey) {
      setSkipTarget(t);
      return;
    }
    if (patch.status === "COMPLETED") {
      setCompleteTarget(t);
      return;
    }
    update.mutate({ id: t.id, patch: patch as UpdatePatch });
  };

  const mayEditRow = (t: WorkflowTaskItem) =>
    Boolean(user && canEditTask(user, { assignedUserId: t.assignedUserId, createdByUserId: t.createdByUserId })) || data.permissions.canCoordinate;

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(data.modules ?? []).filter((m) => !m.removedAt).map((m) => (
                <Badge key={m.templateKey} variant="outline" className={cn("text-xs", m.kind === "CORE" && "border-dashed")}>
                  {m.name} <span className="ml-1 text-muted-foreground">v{m.version}</span>
                </Badge>
              ))}
              <Badge className={cn("border-0 text-xs", permitTone.pill)}>
                <Landmark className="mr-1 size-3" /> {PERMIT_STATUS_LABEL[inst.permitStatus]}
              </Badge>
              {inst.status === "COMPLETED" && <Badge className="border-0 bg-tone-success-soft text-xs text-tone-success-fg">Workflow complete</Badge>}
            </div>
            <div className="flex items-center gap-3">
              <Progress value={closed} max={progress.total} className="h-2 w-56" indicatorClassName={pct === 100 ? "bg-tone-success" : undefined} label={`Workflow ${pct}% complete`} />
              <span className="text-xs tabular-nums text-muted-foreground">
                {closed}/{progress.total} steps · {pct}%
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={chip === c.key}
                  onClick={() => setChip((cur) => (cur === c.key ? null : c.key))}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-transparent transition",
                    c.tone,
                    chip === c.key && "ring-current",
                    c.n === 0 && chip !== c.key && "opacity-50",
                  )}
                >
                  {c.label} <span className="tabular-nums">{c.n}</span>
                </button>
              ))}
              {chip && (
                <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => setChip(null)}>
                  clear
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1.5">
              <div className="flex -space-x-1.5">
                {team.slice(0, 6).map((t) => (
                  <UserAvatar key={t.role} user={t.user} size="sm" title={`${WORKFLOW_ROLE_LABEL[t.role]}: ${t.user.firstName} ${t.user.lastName}`} className="ring-2 ring-white" />
                ))}
                {team.length === 0 && <span className="text-xs text-muted-foreground">No team slots set</span>}
              </div>
              {data.permissions.canCoordinate && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setTeamOpen(true)}>
                  <Users className="size-3.5" /> Edit team
                </Button>
              )}
            </div>
            {canApply && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setApplyOpen(true)}>
                Add a trade…
              </Button>
            )}
          </div>
        </div>

        {inst.permitStatus === "UNDETERMINED" && (
          <Callout
            tone="warning"
            className="mt-3"
            title="Permit status not decided"
            action={
              data.permissions.canSetPermit ? (
                <Button size="sm" variant="outline" className="h-7 bg-white text-xs" onClick={() => setPermitOpen(true)}>
                  Set permit status
                </Button>
              ) : undefined
            }
          >
            Production steps stay Not active until “Determine permit requirement” is completed. The permit or no-permit branch is generated when you decide.
          </Callout>
        )}
        {inst.permitStatus !== "UNDETERMINED" && inst.permitDeterminedBy && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {PERMIT_STATUS_LABEL[inst.permitStatus]} — confirmed by {inst.permitDeterminedBy.firstName} {inst.permitDeterminedBy.lastName}
            {inst.permitDeterminedAt ? ` on ${new Date(inst.permitDeterminedAt).toLocaleDateString()}` : ""}
            {data.job.jurisdiction ? ` · ${data.job.jurisdiction}` : ""}
            {inst.permitNotes ? ` · ${inst.permitNotes}` : ""}
          </p>
        )}
        {unassigned.length > 0 && (
          <Callout
            tone="warning"
            className="mt-3"
            icon={ShieldAlert}
            title={`${progress.unassigned} step${progress.unassigned === 1 ? "" : "s"} need an owner`}
            action={
              data.permissions.canCoordinate ? (
                <Button size="sm" variant="outline" className="h-7 bg-white text-xs" onClick={() => setTeamOpen(true)}>
                  Assign roles
                </Button>
              ) : undefined
            }
          >
            No one is set for: {unassigned.map((r) => WORKFLOW_ROLE_LABEL[r]).join(", ")}.
          </Callout>
        )}
      </div>

      {/* Phases */}
      <div className="space-y-2">
        {(data.phases ?? []).map((phase) => {
          const rows = phase.taskIds.map((id) => tasksById.get(id)).filter((t): t is WorkflowTaskItem => Boolean(t));
          const visible = rows.filter(matches);
          if (chip && visible.length === 0) return null;
          const allClosed = phase.progress.done + phase.progress.skipped === phase.progress.total;
          let n = 0;
          return (
            <PhaseSection
              key={phase.key}
              phase={phase}
              visibleCount={visible.length}
              defaultOpen={!allClosed}
              forceOpen={Boolean(chip)}
              onAddTask={data.permissions.canCoordinate ? () => setAddPhaseKey(phase.key) : undefined}
            >
              {visible.map((t) => (
                <WorkflowTaskRow
                  key={t.id}
                  task={t}
                  index={(n += 1)}
                  users={users}
                  canEdit={mayEditRow(t)}
                  canCoordinate={data.permissions.canCoordinate}
                  onOpen={() => setOpenTaskId(t.id)}
                  onUpdate={(patch) => rowUpdate(t, patch)}
                  onSkip={() => setSkipTarget(t)}
                  onComplete={() => setCompleteTarget(t)}
                />
              ))}
              {visible.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">Nothing here yet.</li>}
            </PhaseSection>
          );
        })}
      </div>

      {/* Dialogs */}
      <ApplyWorkflowDialog jobId={jobId} data={data} open={applyOpen} onOpenChange={setApplyOpen} />
      <ApplyWorkflowDialog jobId={jobId} data={data} open={permitOpen} onOpenChange={setPermitOpen} mode="permit-only" />
      <WorkflowTeamDialog
        data={data}
        users={users}
        open={teamOpen}
        onOpenChange={setTeamOpen}
        pending={patchWorkflow.isPending}
        onSave={(team) => patchWorkflow.mutate({ team }, { onSuccess: () => setTeamOpen(false) })}
      />
      <SkipTaskDialog
        task={skipTarget}
        open={Boolean(skipTarget)}
        onOpenChange={(o) => !o && setSkipTarget(null)}
        pending={update.isPending}
        canOverrideGate={data.permissions.canOverrideGate}
        onConfirm={(reason) =>
          skipTarget && update.mutate({ id: skipTarget.id, patch: { status: "CANCELLED", skipReason: reason } as UpdatePatch }, { onSuccess: () => setSkipTarget(null) })
        }
      />
      <CompleteTaskDialog
        task={completeTarget ? (tasksById.get(completeTarget.id) ?? completeTarget) : null}
        jobId={jobId}
        open={Boolean(completeTarget)}
        onOpenChange={(o) => !o && setCompleteTarget(null)}
        canOverrideGate={data.permissions.canOverrideGate}
        onOpenTask={() => {
          if (completeTarget) setOpenTaskId(completeTarget.id);
        }}
        onTick={(key, done) => completeTarget && update.mutate({ id: completeTarget.id, patch: { checklist: [{ key, done }] } as UpdatePatch })}
        onComplete={async (extra) => {
          if (!completeTarget) return;
          await fetchJson(`/api/tasks/${completeTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "COMPLETED", ...extra }),
          });
          invalidate();
        }}
      />
      <AddTaskDialog
        open={Boolean(addPhaseKey)}
        onOpenChange={(o) => !o && setAddPhaseKey(null)}
        context={{ jobId, label: `${data.job.jobNumber} · ${data.phases?.find((p) => p.key === addPhaseKey)?.name ?? "phase"}`, href: `/jobs/${jobId}?tab=workflow` }}
        defaults={{ assignedUserId: data.job.projectManagerId ?? undefined }}
        submitOverride={
          addPhaseKey
            ? async (payload) => {
                await addTask.mutateAsync({
                  phaseKey: addPhaseKey,
                  title: payload.title,
                  description: payload.description,
                  assignedUserId: payload.assignedUserId ?? null,
                  dueAt: payload.dueAt,
                  priority: payload.priority,
                });
              }
            : undefined
        }
      />
      <TaskDetailSheet
        taskId={openTaskId}
        users={users}
        currentUserId={user?.id ?? ""}
        isAdmin={user?.role === "ADMIN"}
        onClose={() => {
          setOpenTaskId(null);
          invalidate();
        }}
      />
    </div>
  );
}

export type { WorkflowTaskState };
