"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NoteComposer } from "./note-composer";
import { TaskTimeline, type TimelineEvent, type UserLookup } from "./task-timeline";
import { cn } from "@/lib/utils";
import { X, Plus } from "lucide-react";

type TaskStatus = "PENDING" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

type Person = { id: string; firstName: string; lastName: string };

type TaskDetail = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueAt: string | null;
  blockedReason: string | null;
  completedAt: string | null;
  lead: { id: string; fullName: string } | null;
  job: { id: string; jobNumber: string; title: string } | null;
  assignedTo: Person | null;
  createdBy: Person | null;
  completedBy: Person | null;
  watchers: { id: string; user: Person }[];
  events: TimelineEvent[];
};

export type UserOption = { id: string; firstName: string; lastName: string; isActive: boolean };

const STATUSES: TaskStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
];

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
  CANCELLED: "bg-gray-100 text-gray-500",
};

const PRIORITY_COLORS: Record<Priority, string> = {
  LOW: "bg-gray-100 text-gray-700",
  MEDIUM: "bg-blue-50 text-blue-700",
  HIGH: "bg-amber-100 text-amber-800",
  URGENT: "bg-red-100 text-red-700",
};

export function TaskDetailSheet({
  taskId,
  users,
  currentUserId,
  isAdmin,
  onClose,
}: {
  taskId: string | null;
  users: UserOption[];
  currentUserId: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [blockedReason, setBlockedReason] = useState("");
  const [askingBlockReason, setAskingBlockReason] = useState(false);
  const [addingWatcher, setAddingWatcher] = useState(false);

  const { data: task, isLoading } = useQuery<TaskDetail>({
    queryKey: ["task", taskId],
    queryFn: () => fetch(`/api/tasks/${taskId}`).then((r) => {
      if (!r.ok) throw new Error("Could not load this task");
      return r.json();
    }),
    enabled: Boolean(taskId),
  });

  const userLookup: UserLookup = useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()])),
    [users],
  );

  function refresh() {
    qc.invalidateQueries({ queryKey: ["task", taskId] });
    qc.invalidateQueries({ queryKey: ["tasks-v2"] });
  }

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Update failed");
      }
      return r.json();
    },
    onSuccess: () => {
      refresh();
      setAskingBlockReason(false);
      setBlockedReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addNote = useMutation({
    mutationFn: async (body: string) => {
      const r = await fetch(`/api/tasks/${taskId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) throw new Error("Could not post that note");
      return r.json();
    },
    onSuccess: (note: { mentionedUserIds?: string[] }) => {
      refresh();
      const n = note.mentionedUserIds?.length ?? 0;
      toast.success(n > 0 ? `Note added — ${n} person${n === 1 ? "" : "s"} notified` : "Note added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editNote = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const r = await fetch(`/api/tasks/${taskId}/notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) throw new Error("Could not save that edit");
      return r.json();
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteNote = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/tasks/${taskId}/notes/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Could not delete that note");
      return r.json();
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const addWatcher = useMutation({
    mutationFn: async (userId: string) => {
      const r = await fetch(`/api/tasks/${taskId}/watchers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!r.ok) throw new Error("Could not add that watcher");
      return r.json();
    },
    onSuccess: () => {
      refresh();
      setAddingWatcher(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeWatcher = useMutation({
    mutationFn: async (userId: string) => {
      const r = await fetch(`/api/tasks/${taskId}/watchers?userId=${userId}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error("Could not remove that watcher");
      return r.json();
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  function changeStatus(next: TaskStatus) {
    // BLOCKED needs a reason, and the server rejects it without one. Ask here
    // rather than letting the user discover that through a red toast.
    if (next === "BLOCKED" && !task?.blockedReason) {
      setAskingBlockReason(true);
      return;
    }
    patch.mutate({ status: next });
  }

  const watcherIds = new Set(task?.watchers.map((w) => w.user.id) ?? []);
  const addableWatchers = users.filter((u) => u.isActive && !watcherIds.has(u.id));

  return (
    <Sheet open={Boolean(taskId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {isLoading || !task ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <SheetHeader className="border-b px-6 py-4">
              <SheetTitle className="pr-8 text-base leading-snug">{task.title}</SheetTitle>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <Badge className={cn("border-0", STATUS_COLORS[task.status])}>
                  {STATUS_LABEL[task.status]}
                </Badge>
                <Badge className={cn("border-0", PRIORITY_COLORS[task.priority])}>
                  {task.priority}
                </Badge>
                {task.job && (
                  <Link
                    href={`/jobs/${task.job.id}`}
                    className="text-xs font-mono text-blue-600 hover:underline"
                  >
                    {task.job.jobNumber}
                  </Link>
                )}
                {task.lead && !task.job && (
                  <Link
                    href={`/leads/${task.lead.id}`}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {task.lead.fullName}
                  </Link>
                )}
              </div>
            </SheetHeader>

            <div className="space-y-5 px-6 py-5">
              {task.description && (
                <p className="whitespace-pre-wrap rounded-md border-l-2 border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {task.description}
                </p>
              )}

              {task.status === "BLOCKED" && task.blockedReason && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <strong>Blocked:</strong> {task.blockedReason}
                </p>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field label="Assigned to" value={fullName(task.assignedTo) ?? "Unassigned"} />
                <Field label="Raised by" value={fullName(task.createdBy) ?? "—"} />
                <Field
                  label="Due"
                  value={task.dueAt ? format(new Date(task.dueAt), "EEE, MMM d, yyyy") : "No due date"}
                />
                <Field
                  label="Completed"
                  value={
                    task.completedAt
                      ? `${format(new Date(task.completedAt), "MMM d")} by ${fullName(task.completedBy) ?? "—"}`
                      : "—"
                  }
                />
              </dl>

              <div>
                <Label className="text-xs">Status</Label>
                <Select value={task.status} onValueChange={(v) => v && changeStatus(v as TaskStatus)}>
                  <SelectTrigger className="mt-1 h-8 w-[190px] text-sm">
                    <SelectValue>{(v: string) => STATUS_LABEL[v as TaskStatus] ?? v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {askingBlockReason && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <Label className="text-xs text-amber-900">What is it waiting on?</Label>
                  <Input
                    autoFocus
                    className="mt-1 bg-white"
                    placeholder="e.g. Waiting on the city inspection"
                    value={blockedReason}
                    onChange={(e) => setBlockedReason(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && blockedReason.trim()) {
                        patch.mutate({ status: "BLOCKED", blockedReason: blockedReason.trim() });
                      }
                      if (e.key === "Escape") setAskingBlockReason(false);
                    }}
                  />
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      disabled={!blockedReason.trim() || patch.isPending}
                      onClick={() =>
                        patch.mutate({ status: "BLOCKED", blockedReason: blockedReason.trim() })
                      }
                    >
                      Mark blocked
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAskingBlockReason(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              <div>
                <Label className="text-xs">Watchers</Label>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {task.watchers.length === 0 && !addingWatcher && (
                    <span className="text-xs text-muted-foreground">
                      Nobody following beyond the assignee and raiser
                    </span>
                  )}
                  {task.watchers.map((w) => (
                    <span
                      key={w.id}
                      className="inline-flex items-center gap-1 rounded-full border bg-gray-50 py-0.5 pl-2.5 pr-1 text-xs"
                    >
                      {w.user.firstName} {w.user.lastName}
                      <button
                        type="button"
                        aria-label={`Remove ${w.user.firstName} as a watcher`}
                        className="rounded-full p-0.5 hover:bg-gray-200"
                        onClick={() => removeWatcher.mutate(w.user.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {addingWatcher ? (
                    <Select onValueChange={(v: string | null) => v && addWatcher.mutate(v)}>
                      <SelectTrigger className="h-7 w-[180px] text-xs">
                        <SelectValue placeholder="Pick someone">
                          {() => "Pick someone"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {addableWatchers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.firstName} {u.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-gray-50"
                      onClick={() => setAddingWatcher(true)}
                    >
                      <Plus className="h-3 w-3" /> Add
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t bg-gray-50/60 px-6 py-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Activity
              </h3>
              <TaskTimeline
                events={task.events}
                users={userLookup}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onEditNote={(id, body) => {
                  const next = window.prompt("Edit note", body);
                  if (next !== null && next.trim() && next !== body) {
                    editNote.mutate({ id, body: next.trim() });
                  }
                }}
                onDeleteNote={(id) => deleteNote.mutate(id)}
              />
              <div className="mt-4">
                <NoteComposer
                  users={users.filter((u) => u.isActive)}
                  submitting={addNote.isPending}
                  onSubmit={(body) => addNote.mutate(body)}
                />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function fullName(p: Person | null): string | null {
  if (!p) return null;
  return `${p.firstName} ${p.lastName}`.trim() || null;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-gray-800">{value}</dd>
    </div>
  );
}
