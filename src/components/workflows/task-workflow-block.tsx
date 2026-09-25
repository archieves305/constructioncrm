"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Lock, Paperclip, SkipForward, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/shared/callout";
import { taskKeys } from "@/components/tasks/use-tasks";
import { WORKFLOW_ROLE_LABEL } from "@/lib/workflows/role-labels";
import { cn } from "@/lib/utils";
import { EvidenceLine } from "./evidence-line";
import { deriveTaskState, WORKFLOW_STATE_LABEL, WORKFLOW_STATE_PILL } from "./status";
import { SkipTaskDialog } from "./skip-task-dialog";
import { InspectionResultForm } from "./inspection-result-form";
import { DependencyEditor } from "./dependency-editor";
import { subjectHref, subjectOfTask, type WorkflowTaskItem } from "./types";

type FileRow = { id: string; fileName: string; fileType: string; fileSize: number; createdAt: string; uploadedBy: { firstName: string; lastName: string } };

/**
 * The workflow section of the task sheet: where the step sits, what it waits
 * on, its checklist, the evidence it needs (with upload), and Skip. Renders
 * nothing for an ordinary task.
 */
export function TaskWorkflowBlock({
  task,
  files,
  canEdit,
  canOverrideGate,
  canCoordinate,
  canRecordInspection = canEdit,
  onPatch,
}: {
  task: WorkflowTaskItem & { files?: FileRow[] };
  files: FileRow[];
  canEdit: boolean;
  canOverrideGate: boolean;
  canCoordinate: boolean;
  canRecordInspection?: boolean;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const qc = useQueryClient();
  const [skipOpen, setSkipOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("taskId", task.id);
      form.append("category", task.requiredEvidence === "PHOTO" ? "PHOTOS" : "OTHER");
      const r = await fetch("/api/files", { method: "POST", body: form });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.detail(task.id) });
      qc.invalidateQueries({ queryKey: ["job-workflow"] });
      qc.invalidateQueries({ queryKey: ["case-workflow"] });
      toast.success("File attached");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!task.workflowInstanceId) return null;
  const state = deriveTaskState(task);
  const open = state !== "COMPLETED" && state !== "SKIPPED" && state !== "CANCELLED";
  const isStep = task.workflowTaskKey !== null;
  const subject = subjectOfTask(task);
  const moduleName = task.workflowModuleKey ? humanize(task.workflowModuleKey) : "Workflow";
  const phaseName = task.workflowPhaseKey ? humanize(task.workflowPhaseKey.split(":")[1] ?? "") : null;
  const waitingOn = task.dependencies.filter((d) => d.kind === "BLOCKING").filter((d) => d.dependsOn.status !== "COMPLETED" && d.dependsOn.status !== "CANCELLED");
  const checklist = task.checklist ?? [];

  return (
    <section className="space-y-3 rounded-md border border-brand/20 bg-brand/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge className={cn("border-0", WORKFLOW_STATE_PILL[state])}>{WORKFLOW_STATE_LABEL[state]}</Badge>
          <span className="font-medium">{moduleName}</span>
          {phaseName && <span className="text-muted-foreground">· {phaseName}</span>}
          {task.workflowRole && <span className="text-muted-foreground">· {WORKFLOW_ROLE_LABEL[task.workflowRole]}</span>}
          {task.blocking && <span className="rounded bg-tone-warning-soft px-1 text-[10px] text-tone-warning-fg">blocking gate</span>}
          {!isStep && <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-600">manual task in phase</span>}
        </div>
        {subject && (
          <Link href={`${subjectHref(subject)}?tab=workflow#task-${task.id}`} className="inline-flex items-center gap-1 text-xs text-brand-fg hover:underline">
            View in workflow <ArrowUpRight className="size-3" />
          </Link>
        )}
      </div>

      {state === "NOT_ACTIVE" && (
        <Callout tone="neutral" title="Not active yet">
          {waitingOn.length > 0 ? `Waits on: ${waitingOn.map((d) => d.dependsOn.title).join(", ")}.` : "Its predecessors are still open."} You can still start it out of order.
        </Callout>
      )}
      {state === "SKIPPED" && task.skipReason && (
        <Callout tone="neutral" title="Skipped">
          {task.skipReason}
        </Callout>
      )}

      <DependencyEditor task={task} canEdit={canCoordinate} />

      {task.requiredEvidence === "INSPECTION_RESULT" && <InspectionResultForm task={task} canRecord={canRecordInspection} />}

      {checklist.length > 0 && (
        <div>
          <Label className="text-xs">
            Checklist · {checklist.filter((c) => c.done).length}/{checklist.length}
          </Label>
          <ul className="mt-1 space-y-1">
            {checklist.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={c.done} disabled={!canEdit || !open} onCheckedChange={(v) => onPatch({ checklist: [{ key: c.key, done: Boolean(v) }] })} aria-label={c.label} />
                <span className={c.done ? "text-muted-foreground line-through" : ""}>{c.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(task.requiredEvidence || files.length > 0) && (
        <div>
          {task.requiredEvidence && subject && <EvidenceLine task={{ ...task, _count: { ...(task._count ?? { events: 0 }), files: files.length } }} subject={subject} />}
          {files.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-sm">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-1.5">
                  <Paperclip className="size-3 text-muted-foreground" />
                  <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="truncate hover:underline">
                    {f.fileName}
                  </a>
                  <span className="text-[11px] text-muted-foreground">
                    {f.uploadedBy.firstName} {f.uploadedBy.lastName}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && open && (
            <div className="mt-1.5">
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                accept={task.requiredEvidence === "PHOTO" ? "image/*" : undefined}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                  e.target.value = "";
                }}
              />
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
                <Upload className="size-3.5" /> {upload.isPending ? "Uploading…" : task.requiredEvidence === "PHOTO" ? "Attach photo" : "Attach file"}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        {task.dueLocked && (
          <span className="inline-flex items-center gap-1">
            <Lock className="size-3" /> Due date set by hand
            {canEdit && open && (
              <button type="button" className="underline" onClick={() => onPatch({ dueLocked: false })}>
                hand back to workflow
              </button>
            )}
          </span>
        )}
        {isStep && open && canCoordinate && (
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setSkipOpen(true)}>
            <SkipForward className="size-3" /> Skip this step
          </Button>
        )}
      </div>

      <SkipTaskDialog
        task={task}
        open={skipOpen}
        onOpenChange={setSkipOpen}
        canOverrideGate={canOverrideGate}
        onConfirm={(reason) => {
          onPatch({ status: "CANCELLED", skipReason: reason });
          setSkipOpen(false);
        }}
      />
    </section>
  );
}

function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
