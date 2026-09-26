"use client";

import { useEffect, useMemo, useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Eye } from "lucide-react";
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
import { useAssignableUsers, useCreateTask } from "./use-tasks";
import { fullName, type CreateTaskPayload, type Priority, type TaskEntityContext, type TaskListItem } from "./types";

export type AddTaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The record this task is being raised from. Shown as a chip, not editable. */
  context?: TaskEntityContext;
  /** Offer a job picker when there is no context (the /tasks page). */
  allowJobPicker?: boolean;
  defaults?: { title?: string; description?: string; assignedUserId?: string; dueAt?: string; priority?: Priority };
  /** Parent entity keys to refresh after creating, e.g. [["job", id]]. */
  invalidateKeys?: QueryKey[];
  onCreated?: (task: TaskListItem) => void;
  /**
   * Post somewhere other than POST /api/tasks (the Workflow tab adds a task
   * into a phase through its own route). Receives the same payload.
   */
  submitOverride?: (payload: CreateTaskPayload) => Promise<void>;
};

type FormState = {
  title: string;
  description: string;
  priority: Priority;
  assignedUserId: string | null;
  dueAt: string;
  remindAt: string;
  jobId: string | null;
  watcherIds: string[];
};

function initialForm(d: AddTaskDialogProps["defaults"]): FormState {
  return {
    title: d?.title ?? "",
    description: d?.description ?? "",
    priority: d?.priority ?? "MEDIUM",
    assignedUserId: d?.assignedUserId ?? null,
    dueAt: d?.dueAt ?? "",
    remindAt: "",
    jobId: null,
    watcherIds: [],
  };
}

/**
 * The one way to raise a task from anywhere in the app.
 *
 * Extracted from the tasks page so a lead, a job, an invoice row, a daily log
 * and a prospect card all open the same dialog with their own context
 * pre-filled. ⌘/Ctrl+Enter submits; the form resets when the dialog closes.
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

  // Re-seed when reopened with different defaults (e.g. a different invoice).
  useEffect(() => {
    if (open) setForm(initialForm(defaults));
    else setShowWatchers(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults?.title, defaults?.assignedUserId, defaults?.dueAt, defaults?.priority]);

  const watcherCandidates = useMemo(
    () => users.filter((u) => u.id !== form.assignedUserId && u.id !== session?.user.id),
    [users, form.assignedUserId, session?.user.id],
  );

  const [overriding, setOverriding] = useState(false);
  const canSubmit = form.title.trim().length > 0 && !create.isPending && !overriding;

  function submit() {
    if (!canSubmit) return;
    const payload: CreateTaskPayload = {
      title: form.title.trim(),
      priority: form.priority,
    };
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.assignedUserId) payload.assignedUserId = form.assignedUserId;
    if (form.dueAt) payload.dueAt = form.dueAt;
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
        .then(() => onOpenChange(false))
        .catch(() => undefined)
        .finally(() => setOverriding(false));
      return;
    }

    create.mutate(payload, {
      onSuccess: (task) => {
        const assignee = users.find((u) => u.id === task.assignedTo?.id);
        const notified = assignee && assignee.id !== session?.user.id;
        toast.success(notified ? `Task created — ${assignee.firstName} notified` : "Task created");
        onCreated?.(task);
        onOpenChange(false);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!canSubmit} onClick={submit}>
              {create.isPending ? "Creating…" : "Create task"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
