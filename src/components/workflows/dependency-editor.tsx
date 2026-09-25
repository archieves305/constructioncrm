"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { deriveTaskState, WORKFLOW_STATE_DOT, WORKFLOW_STATE_LABEL } from "./status";
import { useSubjectWorkflow, useTaskDependencies } from "./use-workflow";
import { subjectOfTask } from "./types";
import type { WorkflowTaskItem } from "./types";

/** "Waits on" for a step: the list with status dots, remove buttons, and an add picker over the job's other steps. */
export function DependencyEditor({ task, canEdit }: { task: WorkflowTaskItem; canEdit: boolean }) {
  const subject = subjectOfTask(task);
  const { add, remove } = useTaskDependencies(task.id, subject);
  const [adding, setAdding] = useState(false);
  const { data } = useSubjectWorkflow(subject, { enabled: adding && Boolean(subject) });
  const blocking = task.dependencies.filter((d) => d.kind === "BLOCKING");
  const dateOnly = task.dependencies.filter((d) => d.kind === "DATE_ONLY");
  const have = new Set(task.dependencies.map((d) => d.dependsOnTaskId));
  const candidates = (data?.tasks ?? []).filter((t) => t.id !== task.id && !have.has(t.id));

  if (blocking.length === 0 && dateOnly.length === 0 && !canEdit) return null;
  return (
    <div>
      <Label className="text-xs">Waits on</Label>
      <ul className="mt-1 space-y-0.5 text-sm">
        {[...blocking, ...dateOnly].map((d) => {
          const s = deriveTaskState({ status: d.dependsOn.status, activatedAt: d.dependsOn.activatedAt });
          return (
            <li key={d.dependsOnTaskId} className="group flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", WORKFLOW_STATE_DOT[s])} aria-hidden />
              <span className={cn("truncate", (s === "COMPLETED" || s === "SKIPPED") && "text-muted-foreground line-through")}>{d.dependsOn.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {WORKFLOW_STATE_LABEL[s]}
                {d.kind === "DATE_ONLY" ? " · date only" : ""}
                {d.source === "manual" ? " · manual" : ""}
              </span>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Stop waiting on ${d.dependsOn.title}`}
                  className="ml-auto rounded p-0.5 text-muted-foreground opacity-0 hover:bg-gray-100 group-hover:opacity-100 focus:opacity-100"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(d.dependsOnTaskId)}
                >
                  <X className="size-3" />
                </button>
              )}
            </li>
          );
        })}
        {blocking.length === 0 && dateOnly.length === 0 && <li className="text-xs text-muted-foreground">Nothing — it can start any time.</li>}
      </ul>
      {canEdit && (task.status === "PENDING" || task.status === "IN_PROGRESS" || task.status === "BLOCKED") && (
        <div className="mt-1.5">
          {adding ? (
            <div className="flex items-center gap-2">
              <Select
                onValueChange={(v: string | null) => {
                  if (!v) return;
                  add.mutate({ dependsOnTaskId: v }, { onSuccess: () => setAdding(false) });
                }}
              >
                <SelectTrigger className="h-7 w-[260px] text-xs">
                  <SelectValue placeholder={data ? "Pick a step to wait on" : "Loading steps…"}>{() => (data ? "Pick a step to wait on" : "Loading steps…")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                      <span className="ml-1 text-muted-foreground">· {WORKFLOW_STATE_LABEL[deriveTaskState(t)]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] text-muted-foreground" onClick={() => setAdding(true)}>
              <Plus className="size-3" /> Wait on another step
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
