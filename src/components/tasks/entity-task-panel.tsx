"use client";

import { useMemo, useState } from "react";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import type { QueryKey } from "@tanstack/react-query";
import { format, isPast, isToday } from "date-fns";
import { CheckSquare, MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useSession } from "@/lib/auth/session-client";
import { cn } from "@/lib/utils";
import { AddTaskDialog } from "./add-task-dialog";
import { TaskCountBadge } from "./task-count-badge";
import { TaskDetailSheet } from "./task-detail-sheet";
import { PRIORITY_DOT_CLASS, PRIORITY_LABEL } from "./task-colors";
import { primaryLink, type TaskEntityContext, type TaskListItem } from "./types";
import { useAssignableUsers, useTasks, useUpdateTask } from "./use-tasks";

/**
 * The tasks that belong to one record — a lead, a job, an invoice, a daily
 * log, a prospect — with an "Add task" that pre-links the new one.
 *
 * Reads through `/api/tasks`, never the parent's `tasks` include: that route
 * applies the role scope, so a sales rep on a job page sees only the tasks
 * they own or raised, exactly as they would on /tasks.
 */
export function EntityTaskPanel({
  context,
  invalidateKeys,
  title = "Tasks",
  compact = false,
  defaultAssigneeId,
  emptyText = "Nothing open here yet.",
  className,
}: {
  context: TaskEntityContext;
  invalidateKeys?: QueryKey[];
  title?: string;
  compact?: boolean;
  defaultAssigneeId?: string | null;
  emptyText?: string;
  className?: string;
}) {
  const { data: session } = useSession();
  const [showCompleted, setShowCompleted] = useState(false);
  const [source, setSource] = useState<"all" | "manual" | "workflow">("all");
  const [adding, setAdding] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const link = primaryLink(context);
  const filters = useMemo(
    () => ({
      ...(link ? { [link.key]: link.id } : {}),
      includeCompleted: showCompleted,
      ...(source !== "all" ? { source } : {}),
    }),
    [link, showCompleted, source],
  );
  const { data: tasks = [], isLoading } = useTasks(filters, { enabled: Boolean(link) });
  const { data: users = [] } = useAssignableUsers();
  const update = useUpdateTask({ invalidateKeys });

  const open = tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
  const done = tasks.filter((t) => t.status === "COMPLETED" || t.status === "CANCELLED");
  const overdue = open.filter((t) => t.dueAt && isPast(new Date(t.dueAt)) && !isToday(new Date(t.dueAt))).length;
  const canAdd = session?.user.role !== "READ_ONLY";

  const defaults = useMemo(
    () => ({ assignedUserId: defaultAssigneeId ?? undefined }),
    [defaultAssigneeId],
  );

  return (
    <div className={cn("rounded-lg border bg-white", className)}>
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <CheckSquare className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <TaskCountBadge open={open.length} overdue={overdue} compact />
        {(context.jobId || context.violationCaseId) && !compact && (
          <SegmentedControl
            ariaLabel="Task source"
            size="sm"
            className="ml-2"
            value={source}
            onValueChange={setSource}
            options={[
              { value: "all", label: "All" },
              { value: "manual", label: "Manual" },
              { value: "workflow", label: "Workflow" },
            ]}
          />
        )}
        <div className="flex-1" />
        {done.length > 0 && (
          <button
            type="button"
            onClick={() => setShowCompleted((s) => !s)}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {showCompleted ? "Hide completed" : `Show ${done.length} completed`}
          </button>
        )}
        {canAdd && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            Add task
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="px-4 py-3"><ListSkeleton rows={3} /></div>
      ) : open.length === 0 && (!showCompleted || done.length === 0) ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y">
          {[...open, ...(showCompleted ? done : [])].map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              compact={compact}
              onToggle={(checked) => update.mutate({ id: t.id, patch: { status: checked ? "COMPLETED" : "PENDING" } })}
              onOpen={() => setOpenTaskId(t.id)}
            />
          ))}
        </ul>
      )}

      <AddTaskDialog
        open={adding}
        onOpenChange={setAdding}
        context={context}
        defaults={defaults}
        invalidateKeys={invalidateKeys}
      />
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

function TaskRow({
  task,
  compact,
  onToggle,
  onOpen,
}: {
  task: TaskListItem;
  compact: boolean;
  onToggle: (checked: boolean) => void;
  onOpen: () => void;
}) {
  const closed = task.status === "COMPLETED" || task.status === "CANCELLED";
  const due = task.dueAt ? new Date(task.dueAt) : null;
  const overdue = due && !closed && isPast(due) && !isToday(due);
  const dueToday = due && !closed && isToday(due);

  return (
    <li className={cn("flex items-center gap-3 px-4", compact ? "py-1.5" : "py-2.5")}>
      <Checkbox
        checked={task.status === "COMPLETED"}
        aria-label={task.status === "COMPLETED" ? "Reopen" : "Mark complete"}
        onCheckedChange={(c) => onToggle(Boolean(c))}
      />
      <span
        className={cn("size-2 shrink-0 rounded-full", PRIORITY_DOT_CLASS[task.priority])}
        title={`${PRIORITY_LABEL[task.priority]} priority`}
      />
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "min-w-0 flex-1 truncate text-left text-sm hover:underline",
          closed ? "text-muted-foreground line-through" : "font-medium",
        )}
      >
        {task.title}
        {task.status === "BLOCKED" && task.blockedReason && (
          <span className="ml-2 font-normal text-amber-700">· Blocked — {task.blockedReason}</span>
        )}
      </button>
      {(task._count?.events ?? 0) > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
          <MessageSquare className="size-3" />
          {task._count!.events}
        </span>
      )}
      {due && (
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            overdue ? "font-semibold text-red-600" : dueToday ? "font-medium text-amber-700" : "text-muted-foreground",
          )}
        >
          {overdue ? "Overdue · " : dueToday ? "Today" : format(due, "MMM d")}
          {overdue && format(due, "MMM d")}
        </span>
      )}
      <UserAvatar user={task.assignedTo} size="sm" />
    </li>
  );
}
