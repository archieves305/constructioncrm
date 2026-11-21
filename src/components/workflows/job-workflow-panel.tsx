"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Route, Users, Landmark, SkipForward, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
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
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { WORKFLOW_ROLE_LABEL } from "@/lib/workflows/role-labels";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { ApplyWorkflowDialog } from "./apply-workflow-dialog";
import { CatchUpDialog } from "./catch-up-dialog";
import { ReconcileDialog, type ReconcileMode } from "./reconcile-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowUpCircle, ChevronDown, SlidersHorizontal } from "lucide-react";
import { CompleteTaskDialog } from "./complete-task-dialog";
import { PhaseSection } from "./phase-section";
import { SkipTaskDialog } from "./skip-task-dialog";
import { deriveTaskState, PERMIT_STATUS_LABEL, PERMIT_STATUS_TONE, type WorkflowTaskState } from "./status";
import { useAddWorkflowTask, useInvalidateWorkflow, usePatchWorkflow, useSubjectWorkflow, workflowKeys } from "./use-workflow";
import { WorkflowTaskRow } from "./workflow-task-row";
import { WorkflowTeamDialog } from "./workflow-team-dialog";
import { subjectInfoOf, type WorkflowPhaseItem, type WorkflowSubjectRef, type WorkflowTaskItem } from "./types";
import { isPastDue } from "@/lib/calendar/status";

type Chip = "ready" | "inProgress" | "blocked" | "overdue" | "notActive" | "skipped" | null;

/** The Workflow tab on a job. */
export function JobWorkflowPanel({ jobId }: { jobId: string }) {
  return <WorkflowPanel subject={{ kind: "job", id: jobId }} />;
}

/**
 * The Workflow tab, on a job or a violation case. Summary strip (modules,
 * permit status, progress, team), count chips that filter, then the phases
 * in band order with a row per step. Every row edit goes through the same
 * task hooks as the rest of the app, so the Tasks tab and /tasks agree with
 * what is shown here.
 */
export function WorkflowPanel({ subject }: { subject: WorkflowSubjectRef }) {
  const { data: session } = useSession();
  const { data, isLoading, error } = useSubjectWorkflow(subject);
  const { data: users = [] } = useAssignableUsers();
  const invalidate = useInvalidateWorkflow(subject);
  const update = useUpdateTask({ invalidateKeys: [workflowKeys.subject(subject)] });
  const patchWorkflow = usePatchWorkflow(subject);
  const addTask = useAddWorkflowTask(subject);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isCase = subject.kind === "violation";

  const [chip, setChip] = useState<Chip>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [permitOpen, setPermitOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [skipTarget, setSkipTarget] = useState<WorkflowTaskItem | null>(null);
  const [completeTarget, setCompleteTarget] = useState<WorkflowTaskItem | null>(null);
  const [addPhaseKey, setAddPhaseKey] = useState<string | null>(null);
  const [reconcile, setReconcile] = useState<ReconcileMode | null>(null);
  const [catchUpPhase, setCatchUpPhase] = useState<WorkflowPhaseItem | null>(null);
  // Every phase starts open so the whole scope reads at a glance; the toggle remounts them.
  const [allOpen, setAllOpen] = useState(true);
  const [openGen, setOpenGen] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSkipOpen, setBulkSkipOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);

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
        return isPastDue(t.dueAt, t.allDay, new Date(now)) && t.activatedAt !== null && s !== "COMPLETED" && s !== "SKIPPED" && s !== "CANCELLED";
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

  const info = subjectInfoOf(data);
  const user = session?.user;
  const canApply = data.permissions.canApply;

  if (!data.instance) {
    return (
      <div className="rounded-lg border bg-white">
        <EmptyState
          icon={Route}
          title={isCase ? "No workflow on this case yet" : "No workflow on this job yet"}
          description={
            isCase
              ? "Apply the code-violation workflow to lay out every step from intake to agency-confirmed closure, with target dates and the permit branch."
              : "Apply Core Construction plus the trades on this job to lay out every step in order, with target dates and the permit branch. Steps are a checklist here — nobody gets them as tasks."
          }
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
        <ApplyWorkflowDialog subject={subject} data={data} open={applyOpen} onOpenChange={setApplyOpen} />
      </div>
    );
  }

  const inst = data.instance;
  const progress = data.progress!;
  const closed = progress.done + progress.skipped;
  const pct = progress.total > 0 ? Math.round((closed / progress.total) * 100) : 0;
  const permitTone = toneClasses(PERMIT_STATUS_TONE[inst.permitStatus]);
  // The headline is about phases and what is actionable, not a count of every step.
  const livePhases = (data.phases ?? []).filter((p) => !p.legacy);
  const phasesDone = livePhases.filter((p) => p.progress.total > 0 && p.progress.done + p.progress.skipped === p.progress.total).length;
  const workingOn = livePhases.filter((p) => p.progress.ready + p.progress.inProgress + p.progress.blocked > 0);
  const team = data.team ?? [];
  const isBase = (kind: string) => kind === "CORE" || kind === "VIOLATION";

  const chips: { key: Exclude<Chip, null>; label: string; n: number; tone: string }[] = [
    { key: "ready", label: "Ready", n: progress.ready, tone: "bg-tone-info-soft text-tone-info-fg" },
    { key: "inProgress", label: "In progress", n: progress.inProgress, tone: "bg-tone-info-soft text-tone-info-fg" },
    { key: "blocked", label: "Blocked", n: progress.blocked, tone: "bg-tone-warning-soft text-tone-warning-fg" },
    { key: "overdue", label: "Overdue", n: progress.overdue, tone: "bg-tone-danger-soft text-tone-danger-fg" },
    { key: "notActive", label: "Not active", n: progress.notActive, tone: "bg-surface-muted text-fg-secondary" },
    { key: "skipped", label: "Skipped", n: progress.skipped, tone: "bg-surface-muted text-muted-foreground" },
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

  // A step with nothing left to tick and no gate is one click; Undo puts it back.
  const quickComplete = (t: WorkflowTaskItem) =>
    update.mutate(
      { id: t.id, patch: { status: "COMPLETED" } as UpdatePatch },
      {
        onSuccess: () =>
          toast.success(`Done: ${t.title}`, {
            action: { label: "Undo", onClick: () => update.mutate({ id: t.id, patch: { status: "PENDING" } as UpdatePatch }) },
          }),
      },
    );

  // Steps belong to nobody: the workflow's team and its coordinators work them.
  // A manual task added to a phase keeps the ordinary owner rule.
  const canWorkSteps = data.permissions.canWorkSteps ?? data.permissions.canCoordinate;
  const mayEditRow = (t: WorkflowTaskItem) =>
    t.workflowTaskKey
      ? canWorkSteps
      : Boolean(user && canEditTask(user, { assignedUserId: t.assignedUserId, createdByUserId: t.createdByUserId })) || data.permissions.canCoordinate;

  const toggleSelected = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const selectedGates = Array.from(selected).filter((id) => tasksById.get(id)?.blocking).length;
  const skipSelected = async (reason: string) => {
    setBulkPending(true);
    try {
      const r = await fetchJson<{ done: number; refused: { id: string; reason: string }[] }>("/api/tasks/skip-steps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), reason }),
      });
      if (r.refused.length > 0) toast.warning(`${r.done} skipped · ${r.refused.length} left open — ${r.refused[0]!.reason}`);
      else toast.success(`${r.done} step${r.done === 1 ? "" : "s"} skipped`);
      setBulkSkipOpen(false);
      stopSelecting();
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't skip those steps");
    } finally {
      setBulkPending(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(data.modules ?? []).filter((m) => !m.removedAt).map((m) => {
                const upgrade = (data.upgrades ?? []).find((u) => u.templateKey === m.templateKey);
                const menu = canApply && (!isBase(m.kind) || upgrade);
                const pill = (
                  <Badge variant="outline" className={cn("text-xs", isBase(m.kind) && "border-dashed", menu && "cursor-pointer hover:bg-surface-subtle")}>
                    {m.name} <span className="ml-1 text-muted-foreground">v{m.version}</span>
                    {upgrade && <ArrowUpCircle className="ml-1 size-3 text-tone-info-fg" aria-label={`v${upgrade.to} available`} />}
                    {menu && <ChevronDown className="ml-0.5 size-3 text-muted-foreground" />}
                  </Badge>
                );
                if (!menu) return <span key={m.templateKey}>{pill}</span>;
                return (
                  <DropdownMenu key={m.templateKey}>
                    <DropdownMenuTrigger render={<button type="button" aria-label={`${m.name} options`} />}>{pill}</DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {upgrade && (
                        <DropdownMenuItem onClick={() => setReconcile({ kind: "upgrade", templateKey: m.templateKey, name: m.name, from: upgrade.from, to: upgrade.to, versionId: upgrade.versionId })}>
                          <ArrowUpCircle className="size-4" /> Upgrade to v{upgrade.to}…
                        </DropdownMenuItem>
                      )}
                      {!isBase(m.kind) && <DropdownMenuItem onClick={() => setReconcile({ kind: "remove-trade", templateKey: m.templateKey, name: m.name })}>Remove {m.name}…</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })}
              {inst.permitStatus !== "UNDETERMINED" && data.permissions.canSetPermit ? (
                <button type="button" onClick={() => setReconcile({ kind: "permit" })} title="Change permit status">
                  <Badge className={cn("cursor-pointer border-0 text-xs", permitTone.pill)}>
                    <Landmark className="mr-1 size-3" /> {PERMIT_STATUS_LABEL[inst.permitStatus]} <ChevronDown className="ml-0.5 size-3" />
                  </Badge>
                </button>
              ) : (
                <Badge className={cn("border-0 text-xs", permitTone.pill)}>
                  <Landmark className="mr-1 size-3" /> {PERMIT_STATUS_LABEL[inst.permitStatus]}
                </Badge>
              )}
              {inst.status === "COMPLETED" && <Badge className="border-0 bg-tone-success-soft text-xs text-tone-success-fg">Workflow complete</Badge>}
            </div>
            <div className="flex items-center gap-3">
              <Progress value={closed} max={progress.total} className="h-2 w-56" indicatorClassName={pct === 100 ? "bg-tone-success" : undefined} label={`Workflow ${pct}% complete`} />
              <span className="text-xs tabular-nums text-muted-foreground">
                {phasesDone}/{livePhases.length} phases · {closed}/{progress.total} steps
              </span>
            </div>
            <p className="text-sm">
              {inst.status === "COMPLETED" ? (
                <span className="text-muted-foreground">Every step is closed.</span>
              ) : workingOn.length > 0 ? (
                <>
                  <span className="font-medium">
                    {progress.ready + progress.inProgress} to do now
                    {progress.blocked > 0 ? ` · ${progress.blocked} blocked` : ""}
                  </span>
                  <span className="text-muted-foreground"> in {workingOn.map((p) => p.name).join(", ")}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Nothing is ready yet — the next steps are waiting on the ones before them.</span>
              )}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={chip === c.key}
                  onClick={() => setChip((cur) => (cur === c.key ? null : c.key))}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset ring-transparent transition",
                    c.tone,
                    chip === c.key && "ring-current",
                    c.n === 0 && chip !== c.key && "opacity-50",
                  )}
                >
                  {c.label} <span className="tabular-nums">{c.n}</span>
                </button>
              ))}
              {chip && (
                <button type="button" className="text-2xs text-muted-foreground underline" onClick={() => setChip(null)}>
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
              <div className="flex gap-1">
                {!isCase && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setReconcile({ kind: "add-trade" })}>
                    Add a trade…
                  </Button>
                )}
                {(data.toggles ?? []).length > 0 && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setReconcile({ kind: "scope" })}>
                    <SlidersHorizontal className="size-3.5" /> Scope
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {(data.upgrades ?? []).length > 0 && canApply && (
          <Callout tone="info" className="mt-3" icon={ArrowUpCircle} title="A newer template version is available">
            {(data.upgrades ?? []).map((u) => `${(data.modules ?? []).find((m) => m.templateKey === u.templateKey)?.name ?? u.templateKey} v${u.from} → v${u.to}`).join(" · ")}. Use the template&apos;s menu to upgrade; this {isCase ? "case" : "job"} keeps its version until you do.
          </Callout>
        )}
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
            {isCase ? "Permitting and corrective-work" : "Production"} steps stay Not active until “Determine permit requirement” is completed. The permit or no-permit branch is generated when you decide.
          </Callout>
        )}
        {inst.permitStatus !== "UNDETERMINED" && inst.permitDeterminedBy && (
          <p className="mt-2 text-2xs text-muted-foreground">
            {PERMIT_STATUS_LABEL[inst.permitStatus]} — confirmed by {inst.permitDeterminedBy.firstName} {inst.permitDeterminedBy.lastName}
            {inst.permitDeterminedAt ? ` on ${new Date(inst.permitDeterminedAt).toLocaleDateString()}` : ""}
            {info.jurisdiction ? ` · ${info.jurisdiction}` : ""}
            {inst.permitNotes ? ` · ${inst.permitNotes}` : ""}
          </p>
        )}
      </div>

      {/* Phases */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => {
            setAllOpen((o) => !o);
            setOpenGen((g) => g + 1);
          }}
        >
          {allOpen ? <ChevronsDownUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5" />}
          {allOpen ? "Collapse all" : "Expand all"}
        </Button>
        {canWorkSteps && inst.status !== "COMPLETED" &&
          (selecting ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={selected.size === 0} onClick={() => setBulkSkipOpen(true)}>
                <SkipForward className="size-3.5" /> Skip selected…
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={stopSelecting}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setSelecting(true)}>
              <SkipForward className="size-3.5" /> Select steps that don&apos;t apply
            </Button>
          ))}
      </div>
      <div className="space-y-2">
        {(data.phases ?? []).map((phase) => {
          const rows = phase.taskIds.map((id) => tasksById.get(id)).filter((t): t is WorkflowTaskItem => Boolean(t));
          const visible = rows.filter(matches);
          // The chips count the current workflow; the earlier version's rows stay out of a filtered view.
          if (chip && (visible.length === 0 || phase.legacy)) return null;
          let n = 0;
          return (
            <PhaseSection
              key={`${phase.key}:${openGen}`}
              phase={phase}
              visibleCount={visible.length}
              defaultOpen={allOpen && !phase.legacy}
              forceOpen={Boolean(chip) || selecting}
              onAddTask={data.permissions.canCoordinate && !phase.legacy ? () => setAddPhaseKey(phase.key) : undefined}
              onCatchUp={data.permissions.canCatchUp && !phase.legacy && phase.moduleKey !== "other" ? () => setCatchUpPhase(phase) : undefined}
            >
              {visible.map((t) => (
                <WorkflowTaskRow
                  key={t.id}
                  task={t}
                  index={(n += 1)}
                  users={users}
                  canEdit={!phase.legacy && mayEditRow(t)}
                  canCoordinate={!phase.legacy && canWorkSteps}
                  selecting={selecting && !phase.legacy}
                  selected={selected.has(t.id)}
                  onToggleSelect={() => toggleSelected(t.id)}
                  onOpen={() => setOpenTaskId(t.id)}
                  onUpdate={(patch) => rowUpdate(t, patch)}
                  onSkip={() => setSkipTarget(t)}
                  onComplete={() => setCompleteTarget(t)}
                  onQuickComplete={() => quickComplete(t)}
                />
              ))}
              {visible.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">Nothing here yet.</li>}
            </PhaseSection>
          );
        })}
      </div>

      {/* Dialogs */}
      <ApplyWorkflowDialog subject={subject} data={data} open={applyOpen} onOpenChange={setApplyOpen} />
      {reconcile && <ReconcileDialog subject={subject} data={data} mode={reconcile} open onOpenChange={(o) => !o && setReconcile(null)} />}
      <ApplyWorkflowDialog subject={subject} data={data} open={permitOpen} onOpenChange={setPermitOpen} mode="permit-only" />
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
      <SkipTaskDialog
        task={null}
        bulk={{ count: selected.size, gates: selectedGates }}
        open={bulkSkipOpen}
        onOpenChange={setBulkSkipOpen}
        pending={bulkPending}
        canOverrideGate={data.permissions.canOverrideGate}
        onConfirm={(reason) => void skipSelected(reason)}
      />
      <CatchUpDialog subject={subject} phase={catchUpPhase} open={Boolean(catchUpPhase)} onOpenChange={(o) => !o && setCatchUpPhase(null)} />
      <CompleteTaskDialog
        task={completeTarget ? (tasksById.get(completeTarget.id) ?? completeTarget) : null}
        subject={subject}
        open={Boolean(completeTarget)}
        onOpenChange={(o) => !o && setCompleteTarget(null)}
        canOverrideGate={data.permissions.canOverrideGate}
        onOpenTask={() => {
          if (completeTarget) setOpenTaskId(completeTarget.id);
        }}
        onSaveTicks={(ticks) => completeTarget && update.mutate({ id: completeTarget.id, patch: { checklist: ticks } as UpdatePatch })}
        onComplete={async (extra) => {
          if (!completeTarget) return;
          // Ticks and the completion travel together: the server merges the ticks before it checks the step.
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
        context={{
          ...(isCase ? { violationCaseId: subject.id } : { jobId: subject.id }),
          label: `${info.label} · ${data.phases?.find((p) => p.key === addPhaseKey)?.name ?? "phase"}`,
          href: `${info.href}?tab=workflow`,
        }}
        defaults={{ assignedUserId: info.projectManagerId ?? info.caseManagerId ?? undefined }}
        submitOverride={
          addPhaseKey
            ? (payload) =>
                addTask.mutateAsync({
                  phaseKey: addPhaseKey,
                  title: payload.title,
                  description: payload.description,
                  assignedUserId: payload.assignedUserId ?? null,
                  dueAt: payload.dueAt,
                  priority: payload.priority,
                })
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
