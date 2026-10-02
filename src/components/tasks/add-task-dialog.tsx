"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { ChevronDown, Eye, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useSession } from "@/lib/auth/session-client";
import { cn } from "@/lib/utils";
import { AssigneePicker } from "./assignee-picker";
import { DueDatePresets } from "./due-date-presets";
import { PriorityChips } from "./priority-chips";
import { JobPicker } from "@/components/shared/job-picker";
import { EntityContextChip } from "./task-entity-chip";
import { useAssignableUsers, useCreateTask, useInvalidateTasks } from "./use-tasks";
import { uploadTaskFile } from "@/components/workflows/use-task-file-upload";
import { formatFileSize, uploadProblem } from "@/lib/files/limits";
import { fullName, type CreateTaskPayload, type Priority, type TaskEntityContext, type TaskListItem } from "./types";

export type AddTaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The record this task is being raised from. Shown as a chip, not editable. */
  context?: TaskEntityContext;
  /** Offer a job picker when there is no context (the /tasks page). */
  allowJobPicker?: boolean;
  defaults?: {
    title?: string;
    description?: string;
    assignedUserId?: string;
    /** yyyy-MM-dd */
    dueAt?: string;
    priority?: Priority;
    /** ISO instant; implies a timed task on that day (the calendar's "+ at 9:00"). */
    scheduledStart?: string;
    allDay?: boolean;
    jobId?: string;
  };
  /** Parent entity keys to refresh after creating, e.g. [["job", id]]. */
  invalidateKeys?: QueryKey[];
  onCreated?: (task: TaskListItem) => void;
  /**
   * Post somewhere other than POST /api/tasks (the Workflow tab adds a task
   * into a phase through its own route). Receives the same payload; resolving
   * with the created task lets the dialog attach the picked files to it.
   */
  submitOverride?: (payload: CreateTaskPayload) => Promise<{ id: string } | void>;
};

type FormState = {
  title: string;
  description: string;
  priority: Priority;
  assignedUserId: string | null;
  dueAt: string;
  allDay: boolean;
  /** HH:mm, browser-local */
  startTime: string;
  endTime: string;
  remindAt: string;
  jobId: string | null;
  watcherIds: string[];
};

const DEFAULT_START = "09:00";
const DEFAULT_END = "10:00";

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function initialForm(d: AddTaskDialogProps["defaults"]): FormState {
  const start = d?.scheduledStart ? new Date(d.scheduledStart) : null;
  const timed = d?.allDay === false || Boolean(start);
  return {
    title: d?.title ?? "",
    description: d?.description ?? "",
    priority: d?.priority ?? "MEDIUM",
    assignedUserId: d?.assignedUserId ?? null,
    dueAt: d?.dueAt ?? (start ? format(start, "yyyy-MM-dd") : ""),
    allDay: !timed,
    startTime: start ? hhmm(start) : DEFAULT_START,
    endTime: start ? hhmm(new Date(start.getTime() + 60 * 60_000)) : DEFAULT_END,
    remindAt: "",
    jobId: d?.jobId ?? null,
    watcherIds: [],
  };
}

/** A local day + HH:mm → the instant the server stores. */
function localIso(day: string, time: string): string {
  return new Date(`${day}T${time}:00`).toISOString();
}

/**
 * The one way to raise a task from anywhere in the app.
 *
 * Extracted from the tasks page so a lead, a job, an invoice row, a daily log
 * and a prospect card all open the same dialog with their own context
 * pre-filled. ⌘/Ctrl+Enter submits; the form resets when the dialog closes.
 *
 * Files picked here are held until the task exists, then stored against it one
 * at a time. A file that fails never undoes the task — the toast names it and
 * it can be attached from the task.
 */
export function AddTaskDialog({
  open,
  onOpenChange,
  context,
  allowJobPicker = false,
  defaults,
  invalidateKeys,
  onCreated,
  submitOverride,
}: AddTaskDialogProps) {
  const { data: session } = useSession();
  const { data: users = [] } = useAssignableUsers();
  const create = useCreateTask({ invalidateKeys });
  const [form, setForm] = useState<FormState>(() => initialForm(defaults));
  const [showWatchers, setShowWatchers] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [attaching, setAttaching] = useState<{ done: number; total: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const invalidateTasks = useInvalidateTasks();
  const qc = useQueryClient();

  // Re-seed when reopened with different defaults (e.g. a different invoice).
  useEffect(() => {
    if (open) {
      setForm(initialForm(defaults));
      setFiles([]);
    } else setShowWatchers(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults?.title, defaults?.assignedUserId, defaults?.dueAt, defaults?.priority, defaults?.scheduledStart, defaults?.allDay, defaults?.jobId]);

  const watcherCandidates = useMemo(
    () => users.filter((u) => u.id !== form.assignedUserId && u.id !== session?.user.id),
    [users, form.assignedUserId, session?.user.id],
  );

  const [overriding, setOverriding] = useState(false);
  const canSubmit = form.title.trim().length > 0 && !create.isPending && !overriding && !attaching;

  function pickFiles(list: FileList | null) {
    const picked = Array.from(list ?? []);
    const ok: File[] = [];
    for (const f of picked) {
      const problem = uploadProblem(f);
      if (problem) toast.error(problem);
      else ok.push(f);
    }
    if (ok.length) setFiles((prev) => [...prev, ...ok]);
    if (fileInput.current) fileInput.current.value = "";
  }

  /** Store the picked files against the new task. Returns the names that failed. */
  async function attachTo(taskId: string): Promise<string[]> {
    const failed: string[] = [];
    setAttaching({ done: 0, total: files.length });
    for (const [i, f] of files.entries()) {
      try {
        await uploadTaskFile(taskId, f);
      } catch {
        failed.push(f.name);
      }
      setAttaching({ done: i + 1, total: files.length });
    }
    setAttaching(null);
    invalidateTasks(invalidateKeys, taskId);
    qc.invalidateQueries({ queryKey: ["job-workflow"] });
    qc.invalidateQueries({ queryKey: ["case-workflow"] });
    if (failed.length) {
      toast.error(`The task was created, but ${failed.join(", ")} could not be attached. Open the task to attach ${failed.length === 1 ? "it" : "them"}.`, { duration: 10_000 });
    }
    return failed;
  }

  function submit() {
    if (!canSubmit) return;
    const payload: CreateTaskPayload = {
      title: form.title.trim(),
      priority: form.priority,
    };
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.assignedUserId) payload.assignedUserId = form.assignedUserId;
    if (form.dueAt) {
      if (form.allDay) payload.dueAt = form.dueAt;
      else {
        if (form.startTime >= form.endTime) {
          toast.error("The start must be before the end");
          return;
        }
        payload.allDay = false;
        payload.scheduledStart = localIso(form.dueAt, form.startTime);
        payload.dueAt = localIso(form.dueAt, form.endTime);
      }
    }
    if (form.remindAt) payload.remindAt = form.remindAt;
    if (form.watcherIds.length) payload.watcherUserIds = form.watcherIds;
    if (context) {
      for (const k of ["leadId", "jobId", "estimateId", "invoiceId", "prospectId", "dailyLogId", "violationCaseId", "violationItemId"] as const) {
        if (context[k]) payload[k] = context[k];
      }
    } else if (form.jobId) {
      payload.jobId = form.jobId;
    }

    if (submitOverride) {
      setOverriding(true);
      submitOverride(payload)
        .then(async (created) => {
          if (created?.id && files.length) {
            const failed = await attachTo(created.id);
            const n = files.length - failed.length;
            if (n > 0) toast.success(`${n} file${n === 1 ? "" : "s"} attached`);
          }
          onOpenChange(false);
        })
        .catch(() => undefined)
        .finally(() => setOverriding(false));
      return;
    }

    create.mutate(payload, {
      onSuccess: async (task) => {
        const attached = files.length ? files.length - (await attachTo(task.id)).length : 0;
        const assignee = users.find((u) => u.id === task.assignedTo?.id);
        const notified = assignee && assignee.id !== session?.user.id;
        const withFiles = attached > 0 ? ` · ${attached} file${attached === 1 ? "" : "s"} attached` : "";
        toast.success((notified ? `Task created — ${assignee.firstName} notified` : "Task created") + withFiles);
        onCreated?.(task);
        onOpenChange(false);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (attaching ? undefined : onOpenChange(o))}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-lg"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      >
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>New task</DialogTitle>
          {context && (
            <div className="pt-1">
              <EntityContextChip context={context} />
            </div>
          )}
        </DialogHeader>

        <div className="divide-y">
          <section className="space-y-3 px-5 py-4">
            <Input
              autoFocus
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="What needs doing?"
              className="h-10 text-base font-medium"
              aria-label="Task title"
            />
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Details, links, what done looks like… (optional)"
              className="text-sm"
            />
            <div>
              <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => pickFiles(e.target.files)} />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={Boolean(attaching)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Paperclip className="size-3.5" />
                Attach files
              </button>
              {files.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-gray-50 px-2 py-0.5 text-xs">
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-muted-foreground">{formatFileSize(f.size)}</span>
                      {!attaching && (
                        <button
                          type="button"
                          onClick={() => setFiles(files.filter((_, j) => j !== i))}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${f.name}`}
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="space-y-3 px-5 py-4">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Priority</Label>
              <PriorityChips value={form.priority} onChange={(p) => setForm({ ...form, priority: p })} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Due</Label>
              <DueDatePresets value={form.dueAt} onChange={(d) => setForm({ ...form, dueAt: d })} />
            </div>
            {form.dueAt && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={form.allDay} onCheckedChange={(c) => setForm({ ...form, allDay: Boolean(c) })} />
                  All day
                </label>
                {!form.allDay && (
                  <div className="flex items-center gap-2 text-sm">
                    <Input type="time" step={900} className="h-7 w-[110px] text-xs" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} aria-label="Start time" />
                    <span className="text-muted-foreground">to</span>
                    <Input type="time" step={900} className="h-7 w-[110px] text-xs" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} aria-label="End time" />
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs text-muted-foreground">Remind me on</Label>
              <Input
                type="date"
                className="h-7 w-[150px] text-xs"
                value={form.remindAt}
                onChange={(e) => setForm({ ...form, remindAt: e.target.value })}
                aria-label="Reminder date"
              />
              <span className="text-[11px] text-muted-foreground">optional · arrives with that morning&apos;s digest</span>
            </div>
          </section>

          <section className="space-y-3 px-5 py-4">
            <div className={cn("grid gap-3", !context && allowJobPicker ? "sm:grid-cols-2" : "")}>
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">Assign to</Label>
                <AssigneePicker
                  value={form.assignedUserId}
                  onChange={(id) => setForm({ ...form, assignedUserId: id })}
                  users={users}
                  className="w-full"
                />
              </div>
              {!context && allowJobPicker && (
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Job (optional)</Label>
                  <JobPicker value={form.jobId} onChange={(j) => setForm({ ...form, jobId: j?.id ?? null })} placeholder="No job" />
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowWatchers((s) => !s)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Eye className="size-3.5" />
                Watchers{form.watcherIds.length ? ` (${form.watcherIds.length})` : ""}
                <ChevronDown className={cn("size-3.5 transition-transform", showWatchers && "rotate-180")} />
              </button>
              {showWatchers && (
                <div className="mt-2 grid max-h-36 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2">
                  {watcherCandidates.map((u) => {
                    const checked = form.watcherIds.includes(u.id);
                    return (
                      <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-gray-50">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) =>
                            setForm({
                              ...form,
                              watcherIds: c
                                ? [...form.watcherIds, u.id]
                                : form.watcherIds.filter((id) => id !== u.id),
                            })
                          }
                        />
                        <span className="truncate">{fullName(u)}</span>
                      </label>
                    );
                  })}
                  {watcherCandidates.length === 0 && (
                    <span className="col-span-2 text-xs text-muted-foreground">Nobody else to add</span>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-b-xl border-t bg-gray-50/70 px-5 py-3">
          <span className="text-[11px] text-muted-foreground">
            <kbd className="rounded border bg-white px-1 font-mono">⌘</kbd>{" "}
            <kbd className="rounded border bg-white px-1 font-mono">↵</kbd> to create
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={Boolean(attaching)} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!canSubmit} onClick={submit}>
              {attaching ? `Attaching ${Math.min(attaching.done + 1, attaching.total)} of ${attaching.total}…` : create.isPending || overriding ? "Creating…" : "Create task"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
