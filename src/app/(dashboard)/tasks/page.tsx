"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { format, isToday, isThisWeek, isPast } from "date-fns";
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
import { Plus, LayoutGrid, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueAt: string | null;
  lead: { id: string; fullName: string } | null;
  job: { id: string; jobNumber: string; title: string } | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
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

const STATUSES: TaskStatus[] = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const STATUS_COLORS: Record<TaskStatus, string> = {
  PENDING: "bg-gray-100 text-gray-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-amber-100 text-amber-800",
};

export default function TasksPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "board">("list");
  const [open, setOpen] = useState(false);
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

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks-v2"] });
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: form.title,
        priority: form.priority,
      };
      if (form.description) payload.description = form.description;
      if (form.assignedUserId) payload.assignedUserId = form.assignedUserId;
      if (form.jobId) payload.jobId = form.jobId;
      if (form.dueAt) payload.dueAt = form.dueAt;
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
    onError: (e: Error) => toast.error(e.message),
  });

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
                value={form.assignedUserId || "__none"}
                onValueChange={(v: string | null) =>
                  setForm({
                    ...form,
                    assignedUserId: !v || v === "__none" ? "" : v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned">
                    {(v: string) => {
                      if (!v || v === "__none") return "Unassigned";
                      const u = activeUsers.find((x) => x.id === v);
                      return u ? `${u.firstName} ${u.lastName}` : "—";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Unassigned</SelectItem>
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
                value={form.jobId || "__none"}
                onValueChange={(v: string | null) =>
                  setForm({ ...form, jobId: !v || v === "__none" ? "" : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No job">
                    {(v: string) => {
                      if (!v || v === "__none") return "No job";
                      const j = jobs.find((x) => x.id === v);
                      return j ? jobLabel(j) : "—";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No job</SelectItem>
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
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create Task"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : view === "board" ? (
        <BoardView tasks={stageFilteredTasks} onStatusChange={setStatus} />
      ) : (
        <ListView
          buckets={buckets}
          completed={stageFilteredTasks.filter(
            (t) => t.status === "COMPLETED" || t.status === "CANCELLED",
          )}
          showCompleted={includeCompleted}
          onStatusChange={setStatus}
        />
      )}
    </div>
  );
}

function BoardView({
  tasks,
  onStatusChange,
}: {
  tasks: Task[];
  onStatusChange: ReturnType<typeof useMutation<unknown, Error, { id: string; status: TaskStatus }>>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {STATUSES.map((s) => {
        const col = tasks.filter((t) => t.status === s);
        return (
          <div key={s} className="rounded-lg border bg-gray-50">
            <div className="flex items-center justify-between border-b bg-white px-3 py-2 rounded-t-lg">
              <Badge variant="outline" className={cn("border-0", STATUS_COLORS[s])}>
                {s.replace("_", " ")}
              </Badge>
              <span className="text-xs text-muted-foreground">{col.length}</span>
            </div>
            <div className="space-y-2 p-2 min-h-[200px]">
              {col.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">None</p>
              ) : (
                col.map((t) => <TaskCard key={t.id} task={t} onStatusChange={onStatusChange} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({
  buckets,
  completed,
  showCompleted,
  onStatusChange,
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
  onStatusChange: ReturnType<typeof useMutation<unknown, Error, { id: string; status: TaskStatus }>>;
}) {
  return (
    <div className="space-y-4">
      <Section
        title="Overdue"
        tone="destructive"
        tasks={buckets.overdue}
        onStatusChange={onStatusChange}
      />
      <Section title="Today" tone="primary" tasks={buckets.today} onStatusChange={onStatusChange} />
      <Section title="This Week" tasks={buckets.week} onStatusChange={onStatusChange} />
      <Section title="Later" tasks={buckets.later} onStatusChange={onStatusChange} />
      <Section title="No due date" tasks={buckets.noDate} onStatusChange={onStatusChange} />
      {showCompleted && (
        <Section title="Completed / Cancelled" tasks={completed} onStatusChange={onStatusChange} />
      )}
    </div>
  );
}

function Section({
  title,
  tone,
  tasks,
  onStatusChange,
}: {
  title: string;
  tone?: "destructive" | "primary";
  tasks: Task[];
  onStatusChange: ReturnType<typeof useMutation<unknown, Error, { id: string; status: TaskStatus }>>;
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
          <TaskCard key={t.id} task={t} onStatusChange={onStatusChange} />
        ))}
      </CardContent>
    </Card>
  );
}

function TaskCard({
  task,
  onStatusChange,
}: {
  task: Task;
  onStatusChange: ReturnType<typeof useMutation<unknown, Error, { id: string; status: TaskStatus }>>;
}) {
  const overdue =
    task.dueAt &&
    isPast(new Date(task.dueAt)) &&
    !isToday(new Date(task.dueAt)) &&
    task.status !== "COMPLETED" &&
    task.status !== "CANCELLED";

  return (
    <div className="flex items-start gap-3 rounded border bg-white p-3">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={task.status === "COMPLETED"}
        onChange={() =>
          onStatusChange.mutate({
            id: task.id,
            status: task.status === "COMPLETED" ? "PENDING" : "COMPLETED",
          })
        }
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-sm",
            (task.status === "COMPLETED" || task.status === "CANCELLED") &&
              "line-through text-muted-foreground",
          )}
        >
          {task.title}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <Badge
            variant={task.priority === "URGENT" ? "destructive" : "outline"}
            className="text-[10px]"
          >
            {task.priority}
          </Badge>
          {task.dueAt && (
            <span className={cn(overdue && "font-semibold text-red-600", "text-muted-foreground")}>
              Due {format(new Date(task.dueAt), "MMM d")}
            </span>
          )}
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
          {task.assignedTo && (
            <span className="text-muted-foreground">
              @{task.assignedTo.firstName}
            </span>
          )}
        </div>
      </div>
      <Select
        value={task.status}
        onValueChange={(v: string | null) =>
          v && onStatusChange.mutate({ id: task.id, status: v as TaskStatus })
        }
      >
        <SelectTrigger className="h-7 w-[130px] text-xs">
          <SelectValue>{(v: string) => v?.replace("_", " ") || task.status}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {s.replace("_", " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
