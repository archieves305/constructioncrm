"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Paperclip, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import { HttpError } from "@/lib/fetch-json";
import type { WorkflowSubjectRef, WorkflowTaskItem } from "./types";
import { EvidenceLine, evidenceHref } from "./evidence-line";
import { useTaskFileUpload } from "./use-task-file-upload";

export type ChecklistTick = { key: string; done: boolean };

/**
 * Complete with everything the step needs in one place: the checklist to
 * tick (one at a time or all at once), a file to attach, and the record the
 * step waits on. Ticks are kept in the dialog and saved with the completion
 * in a single request — and saved on their own if the dialog is closed
 * before completing, so a half-worked checklist is not lost. The server is
 * the authority; this dialog just keeps the first attempt from being a red
 * toast.
 */
export function CompleteTaskDialog({
  task,
  subject,
  open,
  onOpenChange,
  onComplete,
  onSaveTicks,
  onOpenTask,
  canOverrideGate,
}: {
  task: WorkflowTaskItem | null;
  subject: WorkflowSubjectRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves when the server accepted; rejects with the server error otherwise. */
  onComplete: (extra: { checklist?: ChecklistTick[]; evidenceOverrideReason?: string }) => Promise<unknown>;
  /** The dialog was closed with ticks made and the step not completed. */
  onSaveTicks: (ticks: ChecklistTick[]) => void;
  onOpenTask: () => void;
  canOverrideGate: boolean;
}) {
  const [error, setError] = useState<{ message: string; hint: string | null } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [pending, setPending] = useState(false);
  // What the person ticked here, on top of what the step already has.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [forTask, setForTask] = useState<string | null>(null);
  const [attached, setAttached] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useTaskFileUpload(task?.id, { onDone: () => setAttached((n) => n + 1) });

  if ((task?.id ?? null) !== forTask) {
    setForTask(task?.id ?? null);
    setTicks({});
    setAttached(0);
    setError(null);
    setOverrideReason("");
  }

  const checklist = (task?.checklist ?? []).map((c) => ({ ...c, done: ticks[c.key] ?? c.done }));
  const left = checklist.filter((c) => !c.done).length;
  const changed = (task?.checklist ?? []).filter((c) => ticks[c.key] !== undefined && ticks[c.key] !== c.done).map((c) => ({ key: c.key, done: ticks[c.key]! }));
  const files = (task?._count?.files ?? 0) + attached;

  const close = (o: boolean) => {
    if (!o) {
      if (changed.length > 0 && !pending) onSaveTicks(changed);
      setError(null);
      setOverrideReason("");
    }
    onOpenChange(o);
  };

  async function run(withOverride: boolean) {
    setPending(true);
    setError(null);
    try {
      await onComplete({
        ...(changed.length > 0 ? { checklist: changed } : {}),
        ...(withOverride && overrideReason.trim() ? { evidenceOverrideReason: overrideReason.trim() } : {}),
      });
      setTicks({});
      onOpenChange(false);
    } catch (e) {
      const hint = e instanceof HttpError ? ((e.body as { hint?: string } | undefined)?.hint ?? null) : null;
      setError({ message: e instanceof Error ? e.message : "Could not complete this step", hint });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete “{task?.title}”</DialogTitle>
          <DialogDescription>
            {checklist.length > 0 || task?.requiredEvidence
              ? "Tick what is done; anything the step still needs is checked when you complete."
              : "Marks the step done and wakes up whatever was waiting on it."}
          </DialogDescription>
        </DialogHeader>

        {checklist.length > 0 && (
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">
                Checklist · {checklist.length - left}/{checklist.length}
              </Label>
              {left > 0 && (
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setTicks(Object.fromEntries(checklist.map((c) => [c.key, true])))}>
                  Tick all
                </Button>
              )}
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {checklist.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-sm">
                  <Checkbox className="mt-0.5" checked={c.done} onCheckedChange={(v) => setTicks((t) => ({ ...t, [c.key]: Boolean(v) }))} aria-label={c.label} />
                  <span className={c.done ? "text-muted-foreground line-through" : ""}>{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {task?.requiredEvidence && <EvidenceLine task={task} subject={subject} onOpenTask={onOpenTask} />}

        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={upload.isPending || !task} onClick={() => fileInput.current?.click()}>
            <Upload className="size-3.5" /> {upload.isPending ? "Uploading…" : "Attach a photo or file"}
          </Button>
          {files > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Paperclip className="size-3" /> {files} attached
            </span>
          )}
          {files === 0 && !task?.requiredEvidence && <span className="text-xs text-muted-foreground">Optional</span>}
        </div>

        {error && (
          <Callout tone="warning" title={error.message}>
            {error.hint === "attach_file" || error.hint === "attach_photo" ? (
              "Attach it with the button above, then complete again."
            ) : error.hint === "permit_status" ? (
              "Use “Set permit status” at the top of the Workflow tab."
            ) : error.hint && evidenceHref(subject, error.hint) ? (
              <Link href={evidenceHref(subject, error.hint)!.href} className="underline">
                Go to {evidenceHref(subject, error.hint)!.label}
              </Link>
            ) : null}
          </Callout>
        )}

        {error && error.hint !== "checklist" && error.hint !== "skip_reason" && canOverrideGate && (
          <div className="rounded-md border border-dashed p-3">
            <Label htmlFor="override-reason" className="text-xs">
              Complete anyway (admin/manager) — say why the requirement does not apply
            </Label>
            <Textarea
              id="override-reason"
              rows={2}
              className="mt-1"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="e.g. Signed copy is in the paper job folder"
            />
            <Button size="sm" variant="outline" className="mt-2" disabled={!overrideReason.trim() || pending} onClick={() => run(true)}>
              Complete anyway
            </Button>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => run(false)}>
            {pending ? "Completing…" : "Mark complete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
