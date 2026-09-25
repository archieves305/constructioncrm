"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isToday, isThisWeek, isPast } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, LayoutGrid, ListChecks, Bell, BellOff, SlidersHorizontal } from "lucide-react";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import type { KanbanColumnDef } from "@/components/kanban/types";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { useSession } from "@/lib/auth/session-client";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { AddTaskDialog } from "@/components/tasks/add-task-dialog";
import { TaskCard } from "@/components/tasks/task-card";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { STATUS_LABEL, STATUS_TONE, TASK_PRIORITIES, TASK_STATUSES } from "@/components/tasks/task-colors";
import { useAssignableUsers, useCreateTask, useTaskSummary, useTasks, useUpdateTask } from "@/components/tasks/use-tasks";
import type { TaskListItem, TaskStatus, UpdatePatch, UserOption } from "@/components/tasks/types";

type JobOption = {
  id: string;
  jobNumber: string;
  title: string;
  currentStage: { id: string; name: string };
  lead: { fullName: string; propertyAddress1: string; city: string | null };
};

function jobLabel(j: JobOption): string {
  const addr = j.lead.propertyAddress1 || j.title;
  const city = j.lead.city ? `, ${j.lead.city}` : "";
  return `${addr}${city}`;
}
type StageOption = { id: string; name: string; stageOrder: number };

const ALL = "__all";

export default function TasksPage() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [view, setView] = useState<"list" | "board">("list");
  const [open, setOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const { data: summary } = useTaskSummary();
  // The URL owns which task is open, so email deep links (/tasks?task=<id>),
  // the back button and a copied link all behave the same way. It also seeds
  // the filters, so the dashboard's "Overdue" tile can land here pre-filtered.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openTaskId = searchParams.get("task");

  function setOpenTaskId(id: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (id) next.set("task", id);
    else next.delete("task");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const [filterAssignee, setFilterAssignee] = useState(searchParams.get("assignedUserId") ?? "");
  const [filterPriority, setFilterPriority] = useState(searchParams.get("priority") ?? "");
  const [filterJob, setFilterJob] = useState(searchParams.get("jobId") ?? "");
  const [filterCase, setFilterCase] = useState(searchParams.get("violationCaseId") ?? "");
  const [filterStage, setFilterStage] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(
    searchParams.get("overdue") === "1" || searchParams.get("overdue") === "true",
  );
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [filterSource, setFilterSource] = useState<"" | "manual" | "workflow">(
    searchParams.get("source") === "manual" || searchParams.get("source") === "workflow" ? (searchParams.get("source") as "manual" | "workflow") : "",
  );
  const [readyOnly, setReadyOnly] = useState(searchParams.get("ready") === "1" || searchParams.get("ready") === "true");
  const [blockedOnly, setBlockedOnly] = useState(searchParams.get("blocked") === "1" || searchParams.get("blocked") === "true");
  const [showInactive, setShowInactive] = useState(searchParams.get("includeInactive") === "1" || searchParams.get("includeInactive") === "true");
  const [quickAdd, setQuickAdd] = useState({ title: "", dueAt: "", assignedUserId: null as string | null });

  // A "me" filter from the URL resolves to the real id once the session is
  // known, so the assignee dropdown shows the right name. The API accepts
  // "me" too, so the list is correct even before that.
  const effectiveAssignee = filterAssignee === "me" ? (session?.user.id ?? "me") : filterAssignee;

  const { data: tasks = [], isLoading } = useTasks({
    assignedUserId: effectiveAssignee || undefined,
    priority: filterPriority || undefined,
    jobId: filterJob || undefined,
    violationCaseId: filterCase || undefined,
    overdue: overdueOnly || undefined,
    includeCompleted: includeCompleted || undefined,
    source: filterSource || undefined,
    ready: readyOnly || undefined,
    blocked: blockedOnly || undefined,
    includeInactive: showInactive || undefined,
  });

  const { data: users = [] } = useAssignableUsers();

  const { data: prefs } = useQuery<{ taskEmailsEnabled: boolean }>({
    queryKey: ["me-preferences"],
    queryFn: () => fetchJson("/api/me/preferences"),
  });

  const setPrefs = useMutation({
    mutationFn: (taskEmailsEnabled: boolean) =>
      fetchJson<{ taskEmailsEnabled: boolean }>("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskEmailsEnabled }),
      }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["me-preferences"] });
      toast.success(
        d.taskEmailsEnabled
          ? "Task emails on — you'll be told when work is assigned to you"
          : "Task emails off — you'll only see assignments in the app",
      );
    },
    onError: (e: Error) => toast.error(e.message || "Could not save that preference"),
  });

  const { data: jobsData } = useQuery<{ data: JobOption[] }>({
    queryKey: ["jobs-for-tasks"],
    queryFn: () => fetchJson("/api/jobs?pageSize=500"),
  });
  const jobs = jobsData?.data || [];

  const { data: stages = [] } = useQuery<StageOption[]>({
    queryKey: ["jobStages"],
    queryFn: () => fetchJson("/api/jobs/stages"),
  });

  const stageFilteredTasks = useMemo(() => {
    if (!filterStage) return tasks;
    const jobIdsAtStage = new Set(jobs.filter((j) => j.currentStage.id === filterStage).map((j) => j.id));
    return tasks.filter((t) => t.job && jobIdsAtStage.has(t.job.id));
  }, [tasks, filterStage, jobs]);

  const updateTask = useUpdateTask();
  const create = useCreateTask();

  // `n` opens the dialog when no field has focus — the kbd hint on the button
  // promises it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.closest("[role=dialog]"))) return;
      e.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submitQuickAdd() {
    if (!quickAdd.title.trim()) return;
    create.mutate(
      {
        title: quickAdd.title.trim(),
        dueAt: quickAdd.dueAt || undefined,
        assignedUserId: quickAdd.assignedUserId || undefined,
      },
      {
        onSuccess: () => {
          setQuickAdd({ title: "", dueAt: "", assignedUserId: null });
          toast.success("Task added");
        },
      },
    );
  }

  const buckets = useMemo(() => {
    const overdue: TaskListItem[] = [];
    const today: TaskListItem[] = [];
    const week: TaskListItem[] = [];
    const later: TaskListItem[] = [];
    const noDate: TaskListItem[] = [];
    for (const t of stageFilteredTasks) {
      if (t.status === "COMPLETED" || t.status === "CANCELLED") continue;
      if (!t.dueAt) {
        noDate.push(t);
        continue;
      }
      const d = new Date(t.dueAt);
      if (isPast(d) && !isToday(d)) overdue.push(t);
      else if (isToday(d)) today.push(t);
      else if (isThisWeek(d, { weekStartsOn: 1 })) week.push(t);
      else later.push(t);
    }
    return { overdue, today, week, later, noDate };
  }, [stageFilteredTasks]);

  const openCount = stageFilteredTasks.filter(
    (t) => t.status !== "COMPLETED" && t.status !== "CANCELLED",
  ).length;
  const emailsOn = prefs?.taskEmailsEnabled ?? true;
  const activeFilters =
    [filterAssignee, filterPriority, filterJob, filterCase, filterStage, filterSource].filter(Boolean).length +
    (overdueOnly ? 1 : 0) + (readyOnly ? 1 : 0) + (blockedOnly ? 1 : 0) + (showInactive ? 1 : 0);

  function showMine(overdue: boolean) {
    if (session?.user.id) setFilterAssignee(session.user.id);
    setOverdueOnly(overdue);
    setShowFilters(true);
  }

  return (
    <div>
      <PageHeader
        title="Tasks"
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <span>{openCount} open{overdueOnly ? " · overdue only" : ""}</span>
            {summary && (
              <>
                <button
                  type="button"
                  onClick={() => showMine(false)}
                  className="rounded-full bg-tone-info-soft px-2 py-0.5 text-[11px] font-medium text-tone-info-fg hover:brightness-95"
                >
                  Mine {summary.open}
                </button>
                {summary.overdue > 0 && (
                  <button
                    type="button"
                    onClick={() => showMine(true)}
                    className="rounded-full bg-tone-danger-soft px-2 py-0.5 text-[11px] font-medium text-tone-danger-fg hover:brightness-95"
                  >
                    Overdue {summary.overdue}
                  </button>
                )}
                {summary.dueToday > 0 && (
                  <span className="rounded-full bg-tone-warning-soft px-2 py-0.5 text-[11px] font-medium text-tone-warning-fg">
                    Due today {summary.dueToday}
                  </span>
                )}
              </>
            )}
          </span>
        }
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setPrefs.mutate(!emailsOn)}
              disabled={setPrefs.isPending || !prefs}
              title={emailsOn ? "Task emails are on — click to mute" : "Task emails are muted — click to turn back on"}
              aria-label={emailsOn ? "Mute task emails" : "Unmute task emails"}
              className={cn(!emailsOn && "bg-tone-warning-soft text-tone-warning-fg")}
            >
              {emailsOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </Button>
            <SegmentedControl
              ariaLabel="View"
              value={view}
              onValueChange={setView}
              options={[
                { value: "list", label: "List", icon: ListChecks },
                { value: "board", label: "Board", icon: LayoutGrid },
              ]}
            />
            <Button variant="outline" onClick={() => setShowFilters((f) => !f)} aria-expanded={showFilters}>
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activeFilters > 0 && (
                <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white">{activeFilters}</span>
              )}
            </Button>
            <Button variant="brand" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              New task
              <kbd className="ml-1 hidden rounded border border-white/30 bg-white/10 px-1 font-mono text-[10px] sm:inline">N</kbd>
            </Button>
          </>
        }
      />

      {/* Filters */}
      <Card className={cn("mb-4", !showFilters && activeFilters === 0 && "hidden")}>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="min-w-[180px]">
            <Label className="text-xs">Assignee</Label>
            <AssigneePicker
              value={effectiveAssignee && effectiveAssignee !== "me" ? effectiveAssignee : null}
              onChange={(id) => setFilterAssignee(id ?? "")}
              users={users}
              placeholder="All assignees"
              className="mt-1 w-full"
            />
          </div>
          <div className="min-w-[140px]">
            <Label className="text-xs">Priority</Label>
            <Select
              value={filterPriority || ALL}
              onValueChange={(v: string | null) => setFilterPriority(!v || v === ALL ? "" : v)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => (!v || v === ALL ? "All" : v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {TASK_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Label className="text-xs">Job</Label>
            <Select value={filterJob || ALL} onValueChange={(v: string | null) => setFilterJob(!v || v === ALL ? "" : v)}>
              <SelectTrigger className="mt-1">
                <SelectValue>
                  {(v: string) => {
                    if (!v || v === ALL) return "All jobs";
                    const j = jobs.find((x) => x.id === v);
                    return j ? jobLabel(j) : "—";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All jobs</SelectItem>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {jobLabel(j)} <span className="text-muted-foreground">· {j.jobNumber}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {filterCase && (
            <div className="flex items-center gap-1 self-end rounded-md border bg-gray-50 px-2 py-1.5 text-xs">
              Code-violation case
              <button type="button" className="ml-1 rounded p-0.5 hover:bg-gray-200" aria-label="Clear case filter" onClick={() => setFilterCase("")}>
                ×
              </button>
            </div>
          )}
          <div className="min-w-[180px]">
            <Label className="text-xs">Job stage</Label>
            <Select
              value={filterStage || ALL}
              onValueChange={(v: string | null) => setFilterStage(!v || v === ALL ? "" : v)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue>
                  {(v: string) => (!v || v === ALL ? "All stages" : stages.find((s) => s.id === v)?.name || "—")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All stages</SelectItem>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[150px]">
            <Label className="text-xs">Source</Label>
            <Select value={filterSource || ALL} onValueChange={(v: string | null) => setFilterSource(!v || v === ALL ? "" : (v as "manual" | "workflow"))}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => (!v || v === ALL ? "All sources" : v === "manual" ? "Manual" : "Workflow steps")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sources</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="workflow">Workflow steps</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
            <Checkbox checked={overdueOnly} onCheckedChange={(c) => setOverdueOnly(Boolean(c))} />
            Overdue only
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
            <Checkbox checked={readyOnly} onCheckedChange={(c) => { setReadyOnly(Boolean(c)); if (c) setBlockedOnly(false); }} />
            Ready only
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
            <Checkbox checked={blockedOnly} onCheckedChange={(c) => { setBlockedOnly(Boolean(c)); if (c) setReadyOnly(false); }} />
            Blocked only
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
            <Checkbox checked={showInactive} onCheckedChange={(c) => setShowInactive(Boolean(c))} />
            Show not-active steps
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
            <Checkbox checked={includeCompleted} onCheckedChange={(c) => setIncludeCompleted(Boolean(c))} />
            Show completed
          </label>
        </CardContent>
      </Card>

      {/* Quick-add (list view only) */}
      {view === "list" && (
        <Card className="mb-3">
          <CardContent className="flex flex-wrap items-center gap-2 pt-4">
            <Input
              placeholder="Quick add — task title, press Enter…"
              value={quickAdd.title}
              onChange={(e) => setQuickAdd({ ...quickAdd, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitQuickAdd();
                }
              }}
              className="min-w-[240px] flex-1"
            />
            <Input
              type="date"
              value={quickAdd.dueAt}
              onChange={(e) => setQuickAdd({ ...quickAdd, dueAt: e.target.value })}
              className="w-[160px]"
            />
            <AssigneePicker
              value={quickAdd.assignedUserId}
              onChange={(id) => setQuickAdd({ ...quickAdd, assignedUserId: id })}
              users={users}
              className="w-[180px]"
            />
            <Button size="sm" disabled={!quickAdd.title.trim() || create.isPending} onClick={submitQuickAdd}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </CardContent>
        </Card>
      )}

      <AddTaskDialog open={open} onOpenChange={setOpen} allowJobPicker />

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : view === "board" ? (
        <BoardView
          tasks={stageFilteredTasks}
          users={users}
          onUpdate={(id, patch) => updateTask.mutate({ id, patch })}
          onOpen={setOpenTaskId}
        />
      ) : (
        <ListView
          buckets={buckets}
          completed={stageFilteredTasks.filter((t) => t.status === "COMPLETED" || t.status === "CANCELLED")}
          showCompleted={includeCompleted}
          users={users}
          onUpdate={(id, patch) => updateTask.mutate({ id, patch })}
          onOpen={setOpenTaskId}
        />
      )}

      <TaskDetailSheet
        taskId={openTaskId}
        users={users}
        currentUserId={session?.user.id ?? ""}
        isAdmin={session?.user.role === "ADMIN"}
        onClose={() => setOpenTaskId(null)}
      />
    </div>
  );
}

type ViewProps = {
  users: UserOption[];
  onUpdate: (id: string, patch: UpdatePatch) => void;
  onOpen: (id: string) => void;
};

function BoardView({ tasks, users, onUpdate, onOpen }: ViewProps & { tasks: TaskListItem[] }) {
  const columns = useMemo<KanbanColumnDef[]>(
    () =>
      TASK_STATUSES.map((status) => ({
        id: status,
        title: STATUS_LABEL[status],
        tone: STATUS_TONE[status],
        defaultCollapsed: status === "CANCELLED",
      })),
    [],
  );
  return (
    <KanbanBoard<TaskListItem>
      boardId="tasks"
      columns={columns}
      items={tasks}
      getColumnId={(t) => t.status}
      dragHandle
      columnWidth={300}
      heightClassName="h-[calc(100dvh-20rem)]"
      renderCard={(t) => <TaskCard task={t} users={users} onUpdate={onUpdate} onOpen={onOpen} mode="board" />}
      canMove={(t, to) => {
        // BLOCKED needs a reason; the drawer asks for it.
        if (to === "BLOCKED" && !t.blockedReason) {
          onOpen(t.id);
          return false;
        }
        return true;
      }}
      onMove={(id, to) => onUpdate(id, { status: to as TaskStatus })}
      emptyLabel="Drop here"
    />
  );
}

type Buckets = { overdue: TaskListItem[]; today: TaskListItem[]; week: TaskListItem[]; later: TaskListItem[]; noDate: TaskListItem[] };

function ListView({
  buckets,
  completed,
  showCompleted,
  ...shared
}: ViewProps & { buckets: Buckets; completed: TaskListItem[]; showCompleted: boolean }) {
  const empty =
    Object.values(buckets).every((b) => b.length === 0) && (!showCompleted || completed.length === 0);
  return (
    <div className="space-y-4">
      {empty && <p className="py-12 text-center text-sm text-muted-foreground">Nothing here. Nice.</p>}
      <Section title="Overdue" tone="destructive" tasks={buckets.overdue} {...shared} />
      <Section title="Today" tone="primary" tasks={buckets.today} {...shared} />
      <Section title="This Week" tasks={buckets.week} {...shared} />
      <Section title="Later" tasks={buckets.later} {...shared} />
      <Section title="No due date" tasks={buckets.noDate} {...shared} />
      {showCompleted && <Section title="Completed / Cancelled" tasks={completed} {...shared} />}
    </div>
  );
}

function Section({
  title,
  tone,
  tasks,
  users,
  onUpdate,
  onOpen,
}: ViewProps & { title: string; tone?: "destructive" | "primary"; tasks: TaskListItem[] }) {
  if (tasks.length === 0) return null;
  return (
    <Card>
      <CardHeader className="py-2">
        <CardTitle
          className={cn(
            "flex items-center gap-2 text-sm",
            tone === "destructive" && "text-red-600",
            tone === "primary" && "text-blue-700",
          )}
        >
          {title} <span className="text-xs text-muted-foreground">({tasks.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} users={users} onUpdate={onUpdate} onOpen={onOpen} mode="list" />
        ))}
      </CardContent>
    </Card>
  );
}
