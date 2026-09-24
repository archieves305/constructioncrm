"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import { HttpError } from "@/lib/fetch-json";
import type { WorkflowTaskItem } from "./types";
import { EvidenceLine } from "./evidence-line";

/**
 * Complete with the gates in view: the checklist to tick, the evidence the
 * step requires and where to satisfy it. The server is the authority — this
 * dialog just keeps the first attempt from being a red toast.
 */
export function CompleteTaskDialog({
  task,
  jobId,
  open,
  onOpenChange,
  onComplete,
  onTick,
  onOpenTask,
  canOverrideGate,
}: {
  task: WorkflowTaskItem | null;
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves when the server accepted; rejects with the server error otherwise. */
  onComplete: (extra: { evidenceOverrideReason?: string }) => Promise<unknown>;
  onTick: (key: string, done: boolean) => void;
  onOpenTask: () => void;
  canOverrideGate: boolean;
}) {
  const [error, setError] = useState<{ message: string; hint: string | null } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [pending, setPending] = useState(false);
  const close = (o: boolean) => {
    if (!o) {
      setError(null);
      setOverrideReason("");
    }
    onOpenChange(o);
  };

  const checklist = task?.checklist ?? [];
  const left = checklist.filter((c) => !c.done).length;

  async function run(withOverride: boolean) {
    setPending(true);
    setError(null);
    try {
      await onComplete(withOverride && overrideReason.trim() ? { evidenceOverrideReason: overrideReason.trim() } : {});
      close(false);
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
              ? "This step has requirements. Tick what is done; the rest is checked when you complete."
              : "Marks the step done and wakes up whatever was waiting on it."}
          </DialogDescription>
        </DialogHeader>

        {checklist.length > 0 && (
          <div>
            <Label className="text-xs">
              Checklist · {checklist.length - left}/{checklist.length}
            </Label>
            <ul className="mt-1.5 space-y-1.5">
              {checklist.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-sm">
                  <Checkbox className="mt-0.5" checked={c.done} onCheckedChange={(v) => onTick(c.key, Boolean(v))} aria-label={c.label} />
                  <span className={c.done ? "text-muted-foreground line-through" : ""}>{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {task?.requiredEvidence && <EvidenceLine task={task} jobId={jobId} onOpenTask={onOpenTask} />}

        {error && (
          <Callout tone="warning" title={error.message}>
            {error.hint === "attach_file" || error.hint === "attach_photo" ? (
              <button type="button" className="underline" onClick={onOpenTask}>
                Open the step to attach it
              </button>
            ) : error.hint === "permit" ? (
              <Link href={`/jobs/${jobId}?tab=permits`} className="underline">
                Go to the Permits tab
              </Link>
            ) : error.hint === "permit_status" ? (
              "Use “Set permit status” at the top of the Workflow tab."
            ) : error.hint === "payment" ? (
              <Link href={`/jobs/${jobId}?tab=money&sub=payments`} className="underline">
                Go to Payments
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
