"use client";

import { isPast, isToday } from "date-fns";
import { MessageSquare } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AssigneePicker } from "./assignee-picker";
import { TaskEntityChip } from "./task-entity-chip";
import { PRIORITY_OUTLINE_CLASS, STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES } from "./task-colors";
import { deriveTaskState, WORKFLOW_STATE_LABEL, WORKFLOW_STATE_PILL } from "@/components/workflows/status";
import type { Priority, TaskListItem, TaskStatus, UpdatePatch, UserOption } from "./types";

/**
 * One task as an editable row: tick it done, retitle via the sheet, and change
 * priority / due / assignee inline. Lifted verbatim from the tasks page so the
 * list and board there and the entity panels elsewhere are the same card.
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
    Boolean(task.dueAt) && isPast(new Date(task.dueAt!)) && !isToday(new Date(task.dueAt!)) && !closed;
  const dueValue = task.dueAt ? task.dueAt.slice(0, 10) : "";
  const wfState = task.workflowTaskKey
    ? deriveTaskState({ status: task.status, activatedAt: task.activatedAt ?? null, skipReason: task.skipReason, inspectionResult: task.inspectionResult as "FAIL" | null })
    : null;

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-white p-3">
      <Checkbox
        className="mt-1"
        checked={task.status === "COMPLETED"}
        aria-label={task.status === "COMPLETED" ? "Reopen task" : "Mark task complete"}
        onCheckedChange={(checked) =>
          onUpdate(task.id, { status: checked ? "COMPLETED" : "PENDING" })
        }
      />
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
            <span className={cn("shrink-0 rounded-full px-1.5 text-[10px] font-medium", WORKFLOW_STATE_PILL[wfState])} title="Workflow step">
              {WORKFLOW_STATE_LABEL[wfState]}
            </span>
          )}
          {(task._count?.events ?? 0) > 0 && (
            <span
              className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"
              title={`${task._count!.events} note${task._count!.events === 1 ? "" : "s"}`}
            >
              <MessageSquare className="size-3" />
              {task._count!.events}
            </span>
          )}
        </div>
        {task.status === "BLOCKED" && task.blockedReason && (
          <div className="mt-0.5 truncate text-[11px] text-amber-700">Blocked — {task.blockedReason}</div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <Select
            value={task.priority}
            onValueChange={(v: string | null) => v && onUpdate(task.id, { priority: v as Priority })}
          >
            <SelectTrigger className={cn("h-6 w-[88px] text-[10px] uppercase", PRIORITY_OUTLINE_CLASS[task.priority])}>
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
              "h-6 rounded border bg-white px-1 text-[11px]",
              overdue && "border-red-300 font-semibold text-red-700",
              !task.dueAt && "text-muted-foreground",
            )}
          />

          <AssigneePicker
            size="sm"
            className="h-6 w-[150px] text-[11px]"
            value={task.assignedTo?.id ?? null}
            users={users}
            onChange={(id) => onUpdate(task.id, { assignedUserId: id })}
          />

          <TaskEntityChip task={task} />
        </div>
      </div>
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
      )}
    </div>
  );
}
