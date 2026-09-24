"use client";

import { format, isPast, isToday } from "date-fns";
import { CheckSquare, Lock, MessageSquare, MoreHorizontal, Paperclip, ShieldAlert, Play, RotateCcw, SkipForward, Eye, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import type { UpdatePatch, UserOption } from "@/components/tasks/types";
import { WORKFLOW_ROLE_LABEL } from "@/lib/workflows/role-labels";
import { cn } from "@/lib/utils";
import { deriveTaskState, isOpenState, WORKFLOW_STATE_LABEL, WORKFLOW_STATE_PILL } from "./status";
import type { WorkflowTaskItem } from "./types";

/**
 * One step in a phase. Everything a coordinator needs at a glance — state,
 * owner, due, what it waits on, what it needs — with inline edits for owner
 * and date and a menu for the state moves that need a dialog.
 */
export function WorkflowTaskRow({
  task,
  index,
  users,
  canEdit,
  canCoordinate,
  onOpen,
  onUpdate,
  onSkip,
  onComplete,
}: {
  task: WorkflowTaskItem;
  index: number;
  users: UserOption[];
  canEdit: boolean;
  canCoordinate: boolean;
  onOpen: () => void;
  onUpdate: (patch: UpdatePatch & { dueLocked?: boolean }) => void;
  onSkip: () => void;
  onComplete: () => void;
}) {
  const state = deriveTaskState(task);
  const open = isOpenState(state);
  const notActive = state === "NOT_ACTIVE";
  const due = task.dueAt ? new Date(task.dueAt) : null;
  const overdue = due && open && !notActive && isPast(due) && !isToday(due);
  const dueToday = due && open && !notActive && isToday(due);
  const waitingOn = task.dependencies.filter((d) => d.kind === "BLOCKING" && d.dependsOn.status !== "COMPLETED" && d.dependsOn.status !== "CANCELLED");
  const checklist = task.checklist ?? [];
  const ticked = checklist.filter((c) => c.done).length;
  const isStep = task.workflowTaskKey !== null;

  return (
    <li
      id={`task-${task.id}`}
      className={cn(
        "group flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:flex-nowrap",
        notActive && "opacity-60",
        state === "COMPLETED" || state === "SKIPPED" ? "bg-gray-50/60" : "bg-white",
      )}
    >
      <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{index}</span>
      <Badge
        className={cn("h-5 shrink-0 border-0 px-1.5 text-[10px] font-medium", WORKFLOW_STATE_PILL[state])}
        title={
          notActive && waitingOn.length > 0
            ? `Waiting on: ${waitingOn.map((d) => d.dependsOn.title).join(", ")}`
            : state === "BLOCKED" && task.blockedReason
              ? task.blockedReason
              : state === "SKIPPED" && task.skipReason
                ? task.skipReason
                : undefined
        }
      >
        {WORKFLOW_STATE_LABEL[state]}
      </Badge>

      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
        <div className="flex min-w-0 items-center gap-1.5">
          {task.blocking && <ShieldAlert className="size-3.5 shrink-0 text-tone-warning-fg" aria-label="Blocking gate" />}
          <button
            type="button"
            onClick={onOpen}
            className={cn("min-w-0 truncate text-left text-sm hover:underline", open ? "font-medium" : "text-muted-foreground line-through")}
          >
            {task.title}
          </button>
          {!isStep && <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-600">manual</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {task.workflowRole && <span>{WORKFLOW_ROLE_LABEL[task.workflowRole]}</span>}
          {waitingOn.length > 0 && open && (
            <span className="truncate" title={waitingOn.map((d) => d.dependsOn.title).join(", ")}>
              after: {waitingOn.slice(0, 2).map((d) => d.dependsOn.title).join(", ")}
              {waitingOn.length > 2 ? ` +${waitingOn.length - 2}` : ""}
            </span>
          )}
          {state === "BLOCKED" && task.blockedReason && <span className="text-tone-warning-fg">{task.blockedReason}</span>}
          {state === "SKIPPED" && task.skipReason && <span>skipped — {task.skipReason}</span>}
          {checklist.length > 0 && (
            <span className="inline-flex items-center gap-0.5" title="Checklist">
              <CheckSquare className="size-3" /> {ticked}/{checklist.length}
            </span>
          )}
          {task.requiredEvidence && (
            <span className="inline-flex items-center gap-0.5" title={`Needs ${task.requiredEvidence.toLowerCase().replace("_", " ")}`}>
              <Paperclip className="size-3" />
              {(task._count?.files ?? 0) > 0 ? task._count!.files : ""}
            </span>
          )}
          {(task._count?.events ?? 0) > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <MessageSquare className="size-3" /> {task._count!.events}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="relative">
          <input
            type="date"
            aria-label="Due date"
            value={task.dueAt ? task.dueAt.slice(0, 10) : ""}
            disabled={!canEdit || !open}
            onChange={(e) => onUpdate({ dueAt: e.target.value || null })}
            className={cn(
              "h-7 w-[132px] rounded border bg-white px-1.5 text-[11px] disabled:bg-transparent disabled:text-muted-foreground",
              overdue && "border-red-300 font-semibold text-red-700",
              dueToday && "border-amber-300 text-amber-800",
              !task.dueAt && "text-muted-foreground",
            )}
          />
          {task.dueLocked && (
            <button
              type="button"
              title="Date set by hand — click to hand it back to the workflow"
              aria-label="Unlock due date"
              className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 text-muted-foreground shadow"
              onClick={() => canEdit && onUpdate({ dueLocked: false })}
            >
              <Lock className="size-3" />
            </button>
          )}
        </div>
        <AssigneePicker
          size="sm"
          className="h-7 w-[140px] text-[11px]"
          value={task.assignedTo?.id ?? null}
          users={users}
          onChange={(id) => canEdit && onUpdate({ assignedUserId: id })}
        />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${task.title}`} />}>
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpen}>
              <Eye className="size-4" /> View details
            </DropdownMenuItem>
            {open && canEdit && state !== "IN_PROGRESS" && (
              <DropdownMenuItem onClick={() => onUpdate({ status: "IN_PROGRESS" })}>
                <Play className="size-4" /> {notActive ? "Start out of order" : "Start"}
              </DropdownMenuItem>
            )}
            {open && canEdit && (
              <DropdownMenuItem
                disabled={notActive && waitingOn.length > 0}
                title={notActive && waitingOn.length > 0 ? `Waiting on ${waitingOn.map((d) => d.dependsOn.title).join(", ")}` : undefined}
                onClick={onComplete}
              >
                <Check className="size-4" /> Complete
              </DropdownMenuItem>
            )}
            {open && isStep && canCoordinate && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSkip}>
                  <SkipForward className="size-4" /> Skip step…
                </DropdownMenuItem>
              </>
            )}
            {!open && canEdit && (
              <DropdownMenuItem onClick={() => onUpdate({ status: "PENDING" })}>
                <RotateCcw className="size-4" /> Reopen
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {due && !canEdit && (
        <span className="sr-only">{format(due, "MMM d, yyyy")}</span>
      )}
    </li>
  );
}
