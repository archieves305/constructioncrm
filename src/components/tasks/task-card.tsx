"use client";

import { dayKey } from "@/lib/time/zone";
import { MessageSquare, Paperclip } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AssigneePicker } from "./assignee-picker";
import { TaskEntityChip } from "./task-entity-chip";
import { PRIORITY_OUTLINE_CLASS, STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES } from "./task-colors";
import { deriveTaskState, WORKFLOW_STATE_LABEL, WORKFLOW_STATE_PILL } from "@/components/workflows/status";
import { stepHasOpenRequirement } from "@/lib/workflows/step-requirements";
import type { Priority, TaskListItem, TaskStatus, UpdatePatch, UserOption } from "./types";
import { isPastDue } from "@/lib/calendar/status";
import { format } from "date-fns";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { undoPatch } from "@/lib/tasks/quick-done";

/**
 * One task as a row. From 768 px up it is editable in place: tick it done,
 * change priority / due / assignee / status inline. On a phone the values are
 * text and a tap opens the sheet (Mark done is there), so a mis-tap while
 * scrolling never changes anything. Shared by the tasks list and board and
 * the entity panels.
 */
export function TaskCard({
  task,
  users,
  onUpdate,
  onOpen,
  mode,
}: {
  task: TaskListItem;
  users: UserOption[];
  onUpdate: (id: string, patch: UpdatePatch) => void;
  onOpen: (id: string) => void;
  mode: "list" | "board";
}) {
  const closed = task.status === "COMPLETED" || task.status === "CANCELLED";
  const overdue =
    isPastDue(task.dueAt, task.allDay) && !closed;
  // The office's day, not the UTC slice: a timed task ending 8pm ET is 00:00Z tomorrow.
  const dueValue = task.dueAt ? dayKey(new Date(task.dueAt)) : "";
  const wfState = task.workflowTaskKey
    ? deriveTaskState({ status: task.status, activatedAt: task.activatedAt ?? null, skipReason: task.skipReason, inspectionResult: task.inspectionResult as "FAIL" | null })
    : null;

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-white p-3">
      {/* The tick (and Base UI's hidden input beside it) only from 768 px up. */}
      <div className="hidden md:block">
      <Checkbox
        className="mt-1"
        checked={task.status === "COMPLETED"}
        aria-label={task.status === "COMPLETED" ? "Reopen task" : "Mark task complete"}
        onCheckedChange={(checked) => {
          // A step with a checklist to finish or a gate opens instead: the
          // sheet shows what it needs, where a bare tick would only be refused.
          if (checked && stepHasOpenRequirement(task)) return onOpen(task.id);
          if (!checked) return onUpdate(task.id, { status: "PENDING" });
          const prior = { status: task.status, blockedReason: task.blockedReason };
          onUpdate(task.id, { status: "COMPLETED" });
          toast.success(`Done: ${task.title}`, { action: { label: "Undo", onClick: () => onUpdate(task.id, undoPatch(prior) as UpdatePatch) } });
        }}
      />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(task.id)}
            className={cn(
              "truncate text-left text-sm font-medium hover:underline",
              closed && "font-normal text-muted-foreground line-through",
            )}
          >
            {task.title}
          </button>
          {wfState && (
            <span className={cn("shrink-0 rounded-full px-1.5 text-3xs font-medium", WORKFLOW_STATE_PILL[wfState])} title="Workflow step">
              {WORKFLOW_STATE_LABEL[wfState]}
            </span>
          )}
          {(task._count?.events ?? 0) > 0 && (
            <span
              className="flex shrink-0 items-center gap-0.5 text-2xs text-muted-foreground"
              title={`${task._count!.events} note${task._count!.events === 1 ? "" : "s"}`}
            >
              <MessageSquare className="size-3" />
              {task._count!.events}
            </span>
          )}
          {(task._count?.files ?? 0) > 0 && (
            <span
              className="flex shrink-0 items-center gap-0.5 text-2xs text-muted-foreground"
              title={`${task._count!.files} file${task._count!.files === 1 ? "" : "s"} attached`}
            >
              <Paperclip className="size-3" />
              {task._count!.files}
            </span>
          )}
        </div>
        {task.status === "BLOCKED" && task.blockedReason && (
          <div className="mt-0.5 truncate text-2xs text-tone-warning-fg">Blocked — {task.blockedReason}</div>
        )}
        {/* Phone: the values as text; the whole row opens the sheet. */}
        <button
          type="button"
          onClick={() => onOpen(task.id)}
          className="mt-1.5 flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left text-xs text-muted-foreground md:hidden"
          aria-label={`Open ${task.title}`}
        >
          <StatusBadge kind="task" value={task.status} />
          <StatusBadge kind="priority" value={task.priority} dot={false} />
          <span className={cn(overdue && "font-semibold text-tone-danger-fg")}>
            {task.dueAt ? `Due ${format(new Date(task.dueAt), "MMM d")}` : "No date"}
          </span>
          <span className="truncate">{task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : "Unassigned"}</span>
        </button>
        <div className="mt-1.5 md:hidden empty:hidden">
          <TaskEntityChip task={task} />
        </div>
        <div className="mt-1.5 hidden flex-wrap items-center gap-2 text-xs md:flex">
          <Select
            value={task.priority}
            onValueChange={(v: string | null) => v && onUpdate(task.id, { priority: v as Priority })}
          >
            <SelectTrigger aria-label="Priority" className={cn("h-6 w-[88px] text-3xs uppercase", PRIORITY_OUTLINE_CLASS[task.priority])}>
              <SelectValue>{(v: string) => v || task.priority}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TASK_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            type="date"
            value={dueValue}
            aria-label="Due date"
            onChange={(e) => onUpdate(task.id, { dueAt: e.target.value || null })}
            className={cn(
              "h-6 rounded border bg-white px-1 text-2xs",
              overdue && "border-tone-danger-line font-semibold text-tone-danger-fg",
              !task.dueAt && "text-muted-foreground",
            )}
          />

          <AssigneePicker
            size="sm"
            className="h-6 w-[150px] text-2xs"
            value={task.assignedTo?.id ?? null}
            users={users}
            onChange={(id) => onUpdate(task.id, { assignedUserId: id })}
          />

          <TaskEntityChip task={task} />
        </div>
      </div>
      {mode === "list" && (
        <div className="hidden md:block">
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
          <SelectTrigger aria-label="Status" className="h-7 w-[130px] text-xs">
            <SelectValue>{(v: string) => STATUS_LABEL[v as TaskStatus] ?? task.status}</SelectValue>
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
      )}
    </div>
  );
}
