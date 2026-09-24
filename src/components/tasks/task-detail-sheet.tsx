"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { TaskEntityChip } from "./task-entity-chip";
import { AutoSourceChip } from "./auto-source-chip";
import { useSession } from "@/lib/auth/session-client";
import { canDeleteTask, canEditTask, canNudgeTask } from "@/lib/tasks/access";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { nudgeCooldownRemainingMs } from "@/lib/tasks/nudge-policy";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITY_BADGE_CLASS, STATUS_BADGE_CLASS, STATUS_LABEL, TASK_STATUSES } from "./task-colors";
import { taskKeys } from "./use-tasks";
import type { Person, TaskListItem, TaskStatus, UserOption } from "./types";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { X, Plus, BellRing, AlarmClock, Pencil, Trash2 } from "lucide-react";
import { TaskWorkflowBlock } from "@/components/workflows/task-workflow-block";
import type { WorkflowTaskItem } from "@/components/workflows/types";

type TaskDetail = TaskListItem &
  Omit<WorkflowTaskItem, keyof TaskListItem | "dependencies"> & {
    completedAt: string | null;
    completedBy: Person | null;
    assignedUserId: string | null;
    createdByUserId: string;
    remindAt: string | null;
    sourceKey: string | null;
    watchers: { id: string; user: Person }[];
    events: TimelineEvent[];
    dependencies?: WorkflowTaskItem["dependencies"];
    files?: { id: string; fileName: string; fileType: string; fileSize: number; createdAt: string; uploadedBy: { firstName: string; lastName: string } }[];
  };

export type { UserOption };

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
  const { data: session } = useSession();
  const [blockedReason, setBlockedReason] = useState("");
  const [askingBlockReason, setAskingBlockReason] = useState(false);
  const [addingWatcher, setAddingWatcher] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [nudgeMessage, setNudgeMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { data: task, isLoading } = useQuery<TaskDetail>({
    queryKey: taskKeys.detail(taskId ?? ""),
    queryFn: () => fetchJson(`/api/tasks/${taskId}`),
    enabled: Boolean(taskId),
  });

  const userLookup: UserLookup = useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()])),
    [users],
  );

  function refresh() {
    if (taskId) qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    qc.invalidateQueries({ queryKey: taskKeys.all });
    qc.invalidateQueries({ queryKey: taskKeys.summary });
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

  const nudge = useMutation({
    mutationFn: (message: string) =>
      fetchJson<{ ok: true; willEmail: boolean; skipped: string | null }>(`/api/tasks/${taskId}/nudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message.trim() ? { message: message.trim() } : {}),
      }),
    onSuccess: (r) => {
      refresh();
      setNudging(false);
      setNudgeMessage("");
      const first = task?.assignedTo?.firstName ?? "They";
      toast.success(
        r.willEmail
          ? `Nudge sent to ${first}`
          : r.skipped === "channel-muted" || r.skipped === "muted"
            ? `Nudge recorded, but ${first} has nudge emails muted`
            : "Nudge recorded",
      );
    },
    onError: (e: Error) => toast.error(e.message || "Could not send that nudge"),
  });

  const remove = useMutation({
    mutationFn: () => fetchJson<{ ok: true }>(`/api/tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.all });
      qc.invalidateQueries({ queryKey: taskKeys.summary });
      toast.success("Task deleted");
      setConfirmingDelete(false);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Could not delete that task"),
  });

  function startEditing() {
    if (!task) return;
    setDraftTitle(task.title);
    setDraftDescription(task.description ?? "");
    setEditing(true);
  }

  function saveEdits() {
    const title = draftTitle.trim();
    if (!title) return;
    patch.mutate(
      { title, description: draftDescription.trim() || null },
      { onSuccess: () => setEditing(false) },
    );
  }

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
    // A workflow step is skipped with a reason, never plainly cancelled.
    if (next === "CANCELLED" && task?.workflowTaskKey) {
      toast.info("Workflow steps are skipped, not cancelled — use “Skip this step” below");
      return;
    }
    patch.mutate({ status: next });
  }

  const watcherIds = new Set(task?.watchers.map((w) => w.user.id) ?? []);
  const addableWatchers = users.filter((u) => u.isActive && !watcherIds.has(u.id));

  const isOpen = task ? task.status !== "COMPLETED" && task.status !== "CANCELLED" : false;
  const mayNudge =
    Boolean(task && session?.user && isOpen && task.assignedUserId && task.assignedUserId !== session.user.id) &&
    canNudgeTask(session!.user, { assignedUserId: task!.assignedUserId, createdByUserId: task!.createdByUserId });
  const cooldownMs = task ? nudgeCooldownRemainingMs(task.events) : 0;
  const ownership = task ? { assignedUserId: task.assignedUserId, createdByUserId: task.createdByUserId } : null;
  const mayEdit = Boolean(task && session?.user && ownership && canEditTask(session.user, ownership));
  const mayDelete = Boolean(task && session?.user && ownership && canDeleteTask(session.user, ownership));
  const remindValue = task?.remindAt ? task.remindAt.slice(0, 10) : "";

  return (
    <Sheet open={Boolean(taskId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {isLoading || !task ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <SheetHeader className="border-b px-6 py-4">
              {editing ? (
                <div className="space-y-2 pr-8">
                  <SheetTitle className="sr-only">Edit task</SheetTitle>
                  <Input
                    autoFocus
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="h-9 text-base font-medium"
                    aria-label="Task title"
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveEdits();
                      if (e.key === "Escape") setEditing(false);
                    }}
                  />
                  <Textarea
                    rows={3}
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                    placeholder="Details, links, what done looks like… (optional)"
                    className="text-sm"
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveEdits();
                    }}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!draftTitle.trim() || patch.isPending} onClick={saveEdits}>
                      {patch.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 pr-8">
                  <SheetTitle className="min-w-0 flex-1 text-base leading-snug">{task.title}</SheetTitle>
                  {mayEdit && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="Edit title and description"
                      aria-label="Edit title and description"
                      onClick={startEditing}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )}
                  {mayDelete && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="Delete task"
                      aria-label="Delete task"
                      className="text-muted-foreground hover:text-tone-danger-fg"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <Badge className={cn("border-0", STATUS_BADGE_CLASS[task.status])}>
                  {STATUS_LABEL[task.status]}
                </Badge>
                <Badge className={cn("border-0", PRIORITY_BADGE_CLASS[task.priority])}>
                  {task.priority}
                </Badge>
                <TaskEntityChip task={task} />
                <AutoSourceChip sourceKey={task.sourceKey} />
              </div>
            </SheetHeader>

            <div className="space-y-5 px-6 py-5">
              {!editing && task.description && (
                <p className="whitespace-pre-wrap rounded-md border-l-2 border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {task.description}
                </p>
              )}
              {!editing && !task.description && mayEdit && (
                <button
                  type="button"
                  onClick={startEditing}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  + Add a description
                </button>
              )}

              {task.status === "BLOCKED" && task.blockedReason && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <strong>Blocked:</strong> {task.blockedReason}
                </p>
              )}

              {task.workflowInstanceId && (
                <TaskWorkflowBlock
                  task={{ ...task, dependencies: task.dependencies ?? [] } as WorkflowTaskItem}
                  files={task.files ?? []}
                  canEdit={mayEdit}
                  canOverrideGate={session?.user.role === "ADMIN" || session?.user.role === "MANAGER"}
                  canCoordinate={mayEdit || session?.user.role === "OFFICE_STAFF"}
                  onPatch={(body) => patch.mutate(body)}
                />
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

              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={task.status} onValueChange={(v) => v && changeStatus(v as TaskStatus)}>
                    <SelectTrigger className="mt-1 h-8 w-[190px] text-sm">
                      <SelectValue>{(v: string) => STATUS_LABEL[v as TaskStatus] ?? v}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {mayNudge && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={cooldownMs > 0 || nudge.isPending}
                    title={
                      cooldownMs > 0
                        ? `${task.assignedTo?.firstName ?? "They"} was nudged in the last 24 hours`
                        : `Email ${task.assignedTo?.firstName ?? "the assignee"} asking where this stands`
                    }
                    onClick={() => setNudging((s) => !s)}
                  >
                    <BellRing className="size-3.5" />
                    Send a nudge
                  </Button>
                )}
              </div>

              {nudging && (
                <div className="rounded-md border border-violet-200 bg-violet-50 p-3">
                  <Label className="text-xs text-violet-900">
                    Add a note for {task.assignedTo?.firstName ?? "them"} (optional)
                  </Label>
                  <Textarea
                    autoFocus
                    rows={2}
                    className="mt-1 bg-white"
                    placeholder="e.g. The customer is asking — any update?"
                    value={nudgeMessage}
                    onChange={(e) => setNudgeMessage(e.target.value)}
                  />
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={nudge.isPending} onClick={() => nudge.mutate(nudgeMessage)}>
                      {nudge.isPending ? "Sending…" : "Send nudge"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setNudging(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {isOpen && (
                <div>
                  <Label className="flex items-center gap-1 text-xs">
                    <AlarmClock className="size-3.5" /> Remind me on
                  </Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      type="date"
                      className="h-8 w-[170px] text-sm"
                      value={remindValue}
                      onChange={(e) => patch.mutate({ remindAt: e.target.value || null })}
                    />
                    {remindValue && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:underline"
                        onClick={() => patch.mutate({ remindAt: null })}
                      >
                        Clear
                      </button>
                    )}
                    <span className="text-[11px] text-muted-foreground">arrives with that morning&apos;s digest</span>
                  </div>
                </div>
              )}

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

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this task?</DialogTitle>
            <DialogDescription>
              “{task?.title}” and its notes and history will be removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? "Deleting…" : "Delete task"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

function fullName(p: Person | null | undefined): string | null {
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
