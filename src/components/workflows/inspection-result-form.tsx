"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Callout } from "@/components/shared/callout";
import { cn } from "@/lib/utils";
import { useRecordInspection } from "./use-workflow";
import { subjectOfTask } from "./types";
import type { WorkflowTaskItem } from "./types";

const RESULTS = [
  { value: "PASS", label: "Passed", hint: "Completes this step." },
  { value: "CONDITIONAL", label: "Passed with conditions", hint: "Completes this step and raises a correction task for the conditions." },
  { value: "FAIL", label: "Failed", hint: "Blocks this step and raises a correction task; it reopens for re-inspection when the fix is done." },
] as const;

/** Pass / Fail / Conditional on an inspection step, with notes and the date. */
export function InspectionResultForm({ task, canRecord }: { task: WorkflowTaskItem; canRecord: boolean }) {
  const record = useRecordInspection(task.id, subjectOfTask(task));
  const [result, setResult] = useState<"PASS" | "FAIL" | "CONDITIONAL">("PASS");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [open, setOpen] = useState(false);
  const closed = task.status === "COMPLETED" || task.status === "CANCELLED";
  const failed = task.status === "BLOCKED" && task.inspectionResult === "FAIL";
  const correction = task.dependencies.find((d) => d.dependsOn.workflowTaskKey?.includes(":correction:") && d.dependsOn.status !== "COMPLETED" && d.dependsOn.status !== "CANCELLED");

  if (closed && task.inspectionResult) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ClipboardCheck className="size-3.5" /> Inspection {task.inspectionResult.toLowerCase()}
        {task.inspectionRecordedAt ? ` on ${format(new Date(task.inspectionRecordedAt), "MMM d, yyyy")}` : ""}
      </p>
    );
  }
  if (failed) {
    return (
      <Callout tone="danger" title="Failed inspection">
        {task.blockedReason?.replace(/^Failed inspection\s*[—-]?\s*/, "") || "Waiting on corrections."}{" "}
        {correction ? (
          <>
            Reopens for re-inspection when{" "}
            <Link href={`/tasks?task=${correction.dependsOnTaskId}`} className="underline">
              {correction.dependsOn.title}
            </Link>{" "}
            is done.
          </>
        ) : (
          "Reopens for re-inspection when the correction task is done."
        )}
      </Callout>
    );
  }
  if (!canRecord || closed) return null;

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(true)}>
        <ClipboardCheck className="size-3.5" /> Record inspection result
      </Button>
    );
  }
  return (
    <div className="space-y-3 rounded-md border bg-white p-3">
      <Label className="text-xs">Inspection result</Label>
      <RadioGroup value={result} onValueChange={(v) => setResult(v as typeof result)} className="gap-1">
        {RESULTS.map((r) => (
          <label key={r.value} className={cn("flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm", result === r.value && "border-brand bg-brand/5")}>
            <RadioGroupItem value={r.value} className="mt-0.5" aria-label={r.label} />
            <span>
              <span className="font-medium">{r.label}</span>
              <span className="block text-[11px] text-muted-foreground">{r.hint}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="insp-date" className="text-xs">
            Inspected on
          </Label>
          <Input id="insp-date" type="date" className="mt-1 h-8" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="insp-notes" className="text-xs">
          Inspector notes {result !== "PASS" ? "(what needs correcting)" : "(optional)"}
        </Label>
        <Textarea id="insp-notes" rows={2} className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={record.isPending || (result !== "PASS" && !notes.trim())} onClick={() => record.mutate({ result, notes: notes.trim() || null, inspectedAt: date || undefined }, { onSuccess: () => setOpen(false) })}>
          {record.isPending ? "Saving…" : result === "PASS" ? "Record pass" : result === "FAIL" ? "Record failure" : "Record conditional pass"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
