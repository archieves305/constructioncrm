"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isToday, isThisWeek, isPast } from "date-fns";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, LayoutGrid, ListChecks, GripVertical, MessageSquare, Bell, BellOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";

type TaskStatus = "PENDING" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueAt: string | null;
  blockedReason: string | null;
  lead: { id: string; fullName: string } | null;
  job: { id: string; jobNumber: string; title: string } | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  _count?: { events: number };
};

type UserOption = { id: string; firstName: string; lastName: string; isActive: boolean };
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

const STATUSES: TaskStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<TaskStatus, string> = {
  PENDING: "bg-gray-100 text-gray-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  BLOCKED: "bg-amber-100 text-amber-900",
  COMPLETED: "bg-green-100 text-green-800",
  // Cancelled is now grey: it shared amber with BLOCKED, and "stalled, needs
  // help" reading the same as "abandoned" is the wrong signal on a board.
  CANCELLED: "bg-gray-100 text-gray-500",
};
const PRIORITY_COLOR: Record<Priority, string> = {
  LOW: "border-gray-300 text-gray-700",
  MEDIUM: "border-blue-300 text-blue-700",
  HIGH: "border-amber-400 text-amber-800",
  URGENT: "border-red-500 text-red-700",
};
const UNASSIGNED = "__none";

type UpdatePatch = Partial<{
  status: TaskStatus;
  priority: Priority;
  assignedUserId: string | null;
  dueAt: string | null;
  blockedReason: string | null;
}>;

export default function TasksPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "board">("list");
  const [open, setOpen] = useState(false);
  // The URL owns which task is open, so email deep links (/tasks?task=<id>),
  // the back button and a copied link all behave the same way.
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

  function closeDetail() {
    setOpenTaskId(null);
  }
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterJob, setFilterJob] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [includeCompleted, setIncludeCompleted] = useState(false);

  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "MEDIUM" as Priority,
    assignedUserId: "",
    jobId: "",
    dueAt: "",
  });
  const [quickAdd, setQuickAdd] = useState({ title: "", dueAt: "", assignedUserId: "" });

  const params = new URLSearchParams();
  if (filterAssignee) params.set("assignedUserId", filterAssignee);
  if (filterPriority) params.set("priority", filterPriority);
  if (filterJob) params.set("jobId", filterJob);
  if (includeCompleted) params.set("includeCompleted", "true");

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["tasks-v2", filterAssignee, filterPriority, filterJob, includeCompleted],
    queryFn: () => fetch(`/api/tasks?${params.toString()}`).then((r) => r.json()),
  });

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ["admin-users"],
    queryFn: () => fetch("/api/admin/users").then((r) => r.json()),
  });
  const activeUsers = users.filter((u) => u.isActive);

  const { data: me } = useQuery<{ user: { id: string; role: string } }>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/me").then((r) => r.json()),
  });

  const { data: prefs } = useQuery<{ taskEmailsEnabled: boolean }>({
    queryKey: ["me-preferences"],
    queryFn: () => fetch("/api/me/preferences").then((r) => r.json()),
  });

  const setPrefs = useMutation({
    mutationFn: (taskEmailsEnabled: boolean) =>
      fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskEmailsEnabled }),
      }).then((r) => {
        if (!r.ok) throw new Error("Could not save that preference");
        return r.json();
      }),
    onSuccess: (d: { taskEmailsEnabled: boolean }) => {
      qc.invalidateQueries({ queryKey: ["me-preferences"] });
      toast.success(
        d.taskEmailsEnabled
          ? "Task emails on — you'll be told when work is assigned to you"
          : "Task emails off — you'll only see assignments in the app",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: jobsData } = useQuery<{ data: JobOption[] }>({
    queryKey: ["jobs-for-tasks"],
    queryFn: () => fetch("/api/jobs?pageSize=500").then((r) => r.json()),
  });
  const jobs = jobsData?.data || [];

  const { data: stages = [] } = useQuery<StageOption[]>({
    queryKey: ["jobStages"],
    queryFn: () => fetch("/api/jobs/stages").then((r) => r.json()),
  });

  const stageFilteredTasks = useMemo(() => {
    if (!filterStage) return tasks;
    const jobIdsAtStage = new Set(
      jobs.filter((j) => j.currentStage.id === filterStage).map((j) => j.id),
    );
    return tasks.filter((t) => t.job && jobIdsAtStage.has(t.job.id));
  }, [tasks, filterStage, jobs]);

  const updateTask = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdatePatch }) =>
      fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then((r) => {
        if (!r.ok) throw new Error("Update failed");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks-v2"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async (input: {
      title: string;
      description?: string;
      priority?: Priority;
      assignedUserId?: string;
      jobId?: string;
      dueAt?: string;
    }) => {
      const payload: Record<string, unknown> = {
        title: input.title,
        priority: input.priority ?? "MEDIUM",
      };
      if (input.description) payload.description = input.description;
      if (input.assignedUserId) payload.assignedUserId = input.assignedUserId;
      if (input.jobId) payload.jobId = input.jobId;
      if (input.dueAt) payload.dueAt = input.dueAt;
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Create failed" }));
        throw new Error(err.error || "Create failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks-v2"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
          setQuickAdd({ title: "", dueAt: "", assignedUserId: "" });
          toast.success("Task added");
        },
      },
    );
  }

  function submitFullForm() {
    create.mutate(
      {
        title: form.title,
        description: form.description || undefined,
        priority: form.priority,
        assignedUserId: form.assignedUserId || undefined,
        jobId: form.jobId || undefined,
        dueAt: form.dueAt || undefined,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setForm({
            title: "",
            description: "",
            priority: "MEDIUM",
            assignedUserId: "",
            jobId: "",
            dueAt: "",
          });
          toast.success("Task created");
        },
      },
    );
  }

  const buckets = useMemo(() => {
    const overdue: Task[] = [];
    const today: Task[] = [];
    const week: Task[] = [];
    const later: Task[] = [];
    const noDate: Task[] = [];
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

  return (
    <div>
      <PageHeader
        title="Tasks"
        description={`${stageFilteredTasks.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED").length} open`}
        actions={
          <>
            <button
              type="button"
              onClick={() => setPrefs.mutate(!(prefs?.taskEmailsEnabled ?? true))}
              disabled={setPrefs.isPending || !prefs}
              title={
                prefs?.taskEmailsEnabled ?? true
                  ? "Task emails are on — click to mute"
                  : "Task emails are muted — click to turn back on"
              }
              className={cn(
                "flex items-center gap-1 rounded border px-2 py-1 text-xs",
                prefs?.taskEmailsEnabled ?? true
                  ? "text-muted-foreground hover:bg-gray-50"
                  : "border-amber-300 bg-amber-50 text-amber-800",
              )}
            >
              {prefs?.taskEmailsEnabled ?? true ? (
                <Bell className="h-3.5 w-3.5" />
              ) : (
                <BellOff className="h-3.5 w-3.5" />
              )}
              {prefs?.taskEmailsEnabled ?? true ? "Emails on" : "Muted"}
            </button>
            <div className="flex rounded border p-0.5">
              <button
                type="button"
                onClick={() => setView("list")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-xs",
                  view === "list" ? "bg-gray-100" : "",
                )}
              >
                <ListChecks className="h-3.5 w-3.5" /> List
              </button>
              <button
                type="button"
                onClick={() => setView("board")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-xs",
                  view === "board" ? "bg-gray-100" : "",
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Board
              </button>
            </div>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Task
            </Button>
          </>
        }
      />

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="min-w-[160px]">
            <Label className="text-xs">Assignee</Label>
            <Select
              value={filterAssignee || "__all"}
              onValueChange={(v: string | null) =>
                setFilterAssignee(!v || v === "__all" ? "" : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All">
                  {(v: string) =>
                    !v || v === "__all"
                      ? "All"
                      : activeUsers.find((u) => u.id === v)
                        ? `${activeUsers.find((u) => u.id === v)!.firstName} ${activeUsers.find((u) => u.id === v)!.lastName}`
                        : "—"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All assignees</SelectItem>
                {activeUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[140px]">
            <Label className="text-xs">Priority</Label>
            <Select
              value={filterPriority || "__all"}
              onValueChange={(v: string | null) =>
                setFilterPriority(!v || v === "__all" ? "" : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All">
                  {(v: string) => (!v || v === "__all" ? "All" : v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Label className="text-xs">Job</Label>
            <Select
              value={filterJob || "__all"}
              onValueChange={(v: string | null) =>
                setFilterJob(!v || v === "__all" ? "" : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All">
                  {(v: string) => {
                    if (!v || v === "__all") return "All jobs";
                    const j = jobs.find((x) => x.id === v);
                    return j ? jobLabel(j) : "—";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All jobs</SelectItem>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {jobLabel(j)}{" "}
                    <span className="text-muted-foreground">
                      · {j.jobNumber}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Label className="text-xs">Job stage</Label>
            <Select
              value={filterStage || "__all"}
              onValueChange={(v: string | null) =>
                setFilterStage(!v || v === "__all" ? "" : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All">
                  {(v: string) => {
                    if (!v || v === "__all") return "All stages";
                    return stages.find((s) => s.id === v)?.name || "—";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All stages</SelectItem>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={includeCompleted}
              onChange={(e) => setIncludeCompleted(e.target.checked)}
            />
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
              className="flex-1 min-w-[240px]"
            />
            <Input
              type="date"
              value={quickAdd.dueAt}
              onChange={(e) => setQuickAdd({ ...quickAdd, dueAt: e.target.value })}
              className="w-[160px]"
            />
            <Select
              value={quickAdd.assignedUserId || UNASSIGNED}
              onValueChange={(v: string | null) =>
                setQuickAdd({
                  ...quickAdd,
                  assignedUserId: !v || v === UNASSIGNED ? "" : v,
                })
              }
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue>
                  {(v: string) => {
                    if (!v || v === UNASSIGNED) return "Unassigned";
                    const u = activeUsers.find((x) => x.id === v);
                    return u ? `${u.firstName} ${u.lastName}` : "—";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {activeUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!quickAdd.title.trim() || create.isPending}
              onClick={submitQuickAdd}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Order roofing materials"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v: string | null) =>
                    setForm({ ...form, priority: (v as Priority) || "MEDIUM" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue>{(v: string) => v || "MEDIUM"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={form.dueAt}
                  onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Assign to</Label>
              <Select
                value={form.assignedUserId || UNASSIGNED}
                onValueChange={(v: string | null) =>
                  setForm({
                    ...form,
                    assignedUserId: !v || v === UNASSIGNED ? "" : v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned">
                    {(v: string) => {
                      if (!v || v === UNASSIGNED) return "Unassigned";
                      const u = activeUsers.find((x) => x.id === v);
                      return u ? `${u.firstName} ${u.lastName}` : "—";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {activeUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Link to job (optional)</Label>
              <Select
                value={form.jobId || UNASSIGNED}
                onValueChange={(v: string | null) =>
                  setForm({ ...form, jobId: !v || v === UNASSIGNED ? "" : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No job">
                    {(v: string) => {
                      if (!v || v === UNASSIGNED) return "No job";
                      const j = jobs.find((x) => x.id === v);
                      return j ? jobLabel(j) : "—";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>No job</SelectItem>
                  {jobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {jobLabel(j)}{" "}
                      <span className="text-muted-foreground">
                        · {j.jobNumber}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              disabled={!form.title || create.isPending}
              onClick={submitFullForm}
            >
              {create.isPending ? "Creating…" : "Create Task"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : view === "board" ? (
        <BoardView
          tasks={stageFilteredTasks}
          users={activeUsers}
          onUpdate={(id, patch) => updateTask.mutate({ id, patch })}
          onOpen={setOpenTaskId}
        />
      ) : (
        <ListView
          buckets={buckets}
          completed={stageFilteredTasks.filter(
            (t) => t.status === "COMPLETED" || t.status === "CANCELLED",
          )}
          showCompleted={includeCompleted}
          users={activeUsers}
          onUpdate={(id, patch) => updateTask.mutate({ id, patch })}
          onOpen={setOpenTaskId}
        />
      )}

      <TaskDetailSheet
        taskId={openTaskId}
        users={users}
        currentUserId={me?.user?.id ?? ""}
        isAdmin={me?.user?.role === "ADMIN"}
        onClose={closeDetail}
      />
    </div>
  );
}

function BoardView({
  tasks,
  users,
  onUpdate,
  onOpen,
}: {
  tasks: Task[];
  users: UserOption[];
  onUpdate: (id: string, patch: UpdatePatch) => void;
  onOpen: (id: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(e: DragEndEvent) {
    const taskId = e.active?.id;
    const colId = e.over?.id;
    if (!taskId || !colId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const newStatus = colId as TaskStatus;
    if (task.status === newStatus) return;
    onUpdate(String(taskId), { status: newStatus });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {STATUSES.map((s) => {
          const col = tasks.filter((t) => t.status === s);
          return (
            <BoardColumn
              key={s}
              status={s}
              tasks={col}
              users={users}
              onUpdate={onUpdate}
              onOpen={onOpen}
            />
          );
        })}
      </div>
    </DndContext>
  );
}

function BoardColumn({
  status,
  tasks,
  users,
  onUpdate,
  onOpen,
}: {
  status: TaskStatus;
  tasks: Task[];
  users: UserOption[];
  onUpdate: (id: string, patch: UpdatePatch) => void;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border bg-gray-50 transition-colors",
        isOver && "ring-2 ring-blue-400 bg-blue-50/50",
      )}
    >
      <div className="flex items-center justify-between border-b bg-white px-3 py-2 rounded-t-lg">
        <Badge variant="outline" className={cn("border-0", STATUS_COLORS[status])}>
          {STATUS_LABEL[status]}
        </Badge>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="space-y-2 p-2 min-h-[200px]">
        {tasks.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Drop here</p>
        ) : (
          tasks.map((t) => (
            <DraggableCard
              key={t.id}
              task={t}
              users={users}
              onUpdate={onUpdate}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableCard({
  task,
  users,
  onUpdate,
  onOpen,
}: {
  task: Task;
  users: UserOption[];
  onUpdate: (id: string, patch: UpdatePatch) => void;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative",
        isDragging && "opacity-60 shadow-lg",
      )}
    >
      <div className="flex items-start">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag"
          className="mt-3 mr-1 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <TaskCard
            task={task}
            users={users}
            onUpdate={onUpdate}
            onOpen={onOpen}
            mode="board"
          />
        </div>
      </div>
    </div>
  );
}

function ListView({
  buckets,
  completed,
  showCompleted,
  users,
  onUpdate,
  onOpen,
}: {
  buckets: {
    overdue: Task[];
    today: Task[];
    week: Task[];
    later: Task[];
    noDate: Task[];
  };
  completed: Task[];
  showCompleted: boolean;
  users: UserOption[];
  onUpdate: (id: string, patch: UpdatePatch) => void;
  onOpen: (id: string) => void;
}) {
  const shared = { users, onUpdate, onOpen };
  return (
    <div className="space-y-4">
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
}: {
  title: string;
  tone?: "destructive" | "primary";
  tasks: Task[];
  users: UserOption[];
  onUpdate: (id: string, patch: UpdatePatch) => void;
  onOpen: (id: string) => void;
}) {
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
          <TaskCard
            key={t.id}
            task={t}
            users={users}
            onUpdate={onUpdate}
            onOpen={onOpen}
            mode="list"
          />
        ))}
      </CardContent>
    </Card>
  );
}

function TaskCard({
  task,
  users,
  onUpdate,
  onOpen,
  mode,
}: {
  task: Task;
  users: UserOption[];
  onUpdate: (id: string, patch: UpdatePatch) => void;
  onOpen: (id: string) => void;
  mode: "list" | "board";
}) {
  const overdue =
    task.dueAt &&
    isPast(new Date(task.dueAt)) &&
    !isToday(new Date(task.dueAt)) &&
    task.status !== "COMPLETED" &&
    task.status !== "CANCELLED";

  const dueValue = task.dueAt ? task.dueAt.slice(0, 10) : "";

  return (
    <div className="flex items-start gap-3 rounded border bg-white p-3">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={task.status === "COMPLETED"}
        onChange={() =>
          onUpdate(task.id, {
            status: task.status === "COMPLETED" ? "PENDING" : "COMPLETED",
          })
        }
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(task.id)}
            className={cn(
              "truncate text-left text-sm hover:underline",
              (task.status === "COMPLETED" || task.status === "CANCELLED") &&
                "line-through text-muted-foreground",
            )}
          >
            {task.title}
          </button>
          {(task._count?.events ?? 0) > 0 && (
            <span
              className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"
              title={`${task._count!.events} note${task._count!.events === 1 ? "" : "s"}`}
            >
              <MessageSquare className="h-3 w-3" />
              {task._count!.events}
            </span>
          )}
        </div>
        {task.status === "BLOCKED" && task.blockedReason && (
          <div className="mt-0.5 truncate text-[11px] text-amber-700">
            Blocked — {task.blockedReason}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          {/* Priority — inline edit */}
          <Select
            value={task.priority}
            onValueChange={(v: string | null) =>
              v && onUpdate(task.id, { priority: v as Priority })
            }
          >
            <SelectTrigger
              className={cn(
                "h-6 w-[88px] text-[10px] uppercase",
                PRIORITY_COLOR[task.priority],
              )}
            >
              <SelectValue>{(v: string) => v || task.priority}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Due date — inline edit */}
          <input
            type="date"
            value={dueValue}
            onChange={(e) =>
              onUpdate(task.id, {
                dueAt: e.target.value || null,
              })
            }
            className={cn(
              "h-6 rounded border bg-white px-1 text-[11px]",
              overdue && "border-red-300 text-red-700 font-semibold",
              !task.dueAt && "text-muted-foreground",
            )}
          />

          {/* Assignee — inline edit */}
          <Select
            value={task.assignedTo?.id ?? UNASSIGNED}
            onValueChange={(v: string | null) =>
              onUpdate(task.id, {
                assignedUserId: !v || v === UNASSIGNED ? null : v,
              })
            }
          >
            <SelectTrigger className="h-6 w-[140px] text-[11px]">
              <SelectValue>
                {(v: string) => {
                  if (!v || v === UNASSIGNED) return "Unassigned";
                  const u = users.find((x) => x.id === v);
                  return u
                    ? `${u.firstName} ${u.lastName.charAt(0)}.`
                    : task.assignedTo
                      ? `${task.assignedTo.firstName}`
                      : "—";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {task.job && (
            <Link
              href={`/jobs/${task.job.id}`}
              className="font-mono text-blue-600 hover:underline"
            >
              {task.job.jobNumber}
            </Link>
          )}
          {task.lead && !task.job && (
            <Link
              href={`/leads/${task.lead.id}`}
              className="text-blue-600 hover:underline"
            >
              {task.lead.fullName}
            </Link>
          )}
        </div>
      </div>
      {/* Status (only on list view; board uses drag-drop instead) */}
      {mode === "list" && (
        <Select
          value={task.status}
          onValueChange={(v: string | null) => {
            if (!v) return;
            // BLOCKED needs a reason the server insists on, and there is
            // nowhere to type one here — send them to the drawer that asks.
            if (v === "BLOCKED" && !task.blockedReason) {
              onOpen(task.id);
              return;
            }
            onUpdate(task.id, { status: v as TaskStatus });
          }}
        >
          <SelectTrigger className="h-7 w-[130px] text-xs">
            <SelectValue>
              {(v: string) => STATUS_LABEL[v as TaskStatus] ?? task.status}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
