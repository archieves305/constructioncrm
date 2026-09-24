"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import type { WorkflowTaskItem } from "./types";

/**
 * Skipping is the workflow's "not applicable". A reason is mandatory — it goes
 * on the timeline as SKIPPED and is what the reporting later reads — and a
 * blocking gate gets an extra warning because skipping it releases everything
 * waiting behind it.
 */
export function SkipTaskDialog({
  task,
  open,
  onOpenChange,
  onConfirm,
  pending,
  canOverrideGate,
}: {
  task: WorkflowTaskItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  pending?: boolean;
  canOverrideGate: boolean;
}) {
  const [reason, setReason] = useState("");
  const close = (o: boolean) => {
    if (!o) setReason("");
    onOpenChange(o);
  };
  const gateLocked = Boolean(task?.blocking) && !canOverrideGate;
  const dependents = task?._count?.dependents ?? 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Skip this step?</DialogTitle>
          <DialogDescription>
            “{task?.title}” will be marked Skipped. It stays in the workflow with your reason, and anything waiting on it can proceed.
          </DialogDescription>
        </DialogHeader>
        {task?.blocking && (
          <Callout tone={gateLocked ? "danger" : "warning"} title={gateLocked ? "This is a blocking gate" : "This is a blocking gate"}>
            {gateLocked
              ? "Only an admin or manager can skip a blocking step. Ask them, or complete it."
              : `Skipping it releases ${dependents > 0 ? `${dependents} step${dependents === 1 ? "" : "s"}` : "the steps"} held behind it.`}
          </Callout>
        )}
        <div>
          <Label htmlFor="skip-reason" className="text-xs">
            Why is this step being skipped?
          </Label>
          <Textarea
            id="skip-reason"
            autoFocus
            rows={3}
            className="mt-1"
            placeholder="e.g. Owner is supplying the dumpster; no tear-off on this job"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={gateLocked}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && reason.trim() && !gateLocked) {
                onConfirm(reason.trim());
                setReason("");
              }
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button disabled={!reason.trim() || pending || gateLocked} onClick={() => { onConfirm(reason.trim()); setReason(""); }}>
            {pending ? "Skipping…" : "Skip step"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
