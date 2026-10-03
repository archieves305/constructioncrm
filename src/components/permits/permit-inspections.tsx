"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ClipboardCheck, Link2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { fetchJson } from "@/lib/fetch-json";
import { INSPECTION_TYPES, matchInspectionStep, stepCoversSeveral } from "@/lib/permits/rules";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { taskKeys } from "@/components/tasks/use-tasks";
import { workflowKeys } from "@/components/workflows/use-workflow";
import { dayOf, formatDay, formatWhen, joinWhen, RESULT_LABEL, RESULT_TONE, timeOf, typeLabel, type InspectionStep, type PermitInspection } from "./shared";

type Outcome = { taskId: string | null; applied: boolean; stepStatus: string | null; correctionTaskId: string | null };
type Saved = PermitInspection & { workflow?: Outcome | null; permitClosed?: boolean };

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Everything that shows a permit, an inspection or the step it belongs to. */
function useRefresh(jobId: string, permitId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["job", jobId] });
    qc.invalidateQueries({ queryKey: ["inspections", permitId] });
    qc.invalidateQueries({ queryKey: ["inspections-list"] });
    qc.invalidateQueries({ queryKey: ["permits"] });
    qc.invalidateQueries({ queryKey: workflowKeys.job(jobId) });
    qc.invalidateQueries({ queryKey: taskKeys.all });
  };
}

/** What the server did with a result, in a sentence. */
function announce(r: Saved) {
  const wf = r.workflow;
  const closed = r.permitClosed ? " The permit is now Final." : "";
  if (r.result === "FAIL") {
    toast.success(wf?.applied ? "Failed inspection recorded — the workflow step is blocked and a correction task was created" : "Failed inspection recorded — a correction task was created");
  } else if (r.result === "CONDITIONAL") {
    toast.success(`Recorded with conditions — a correction task was created.${closed}`);
  } else {
    toast.success(`${wf?.applied ? "Inspection passed — the workflow step is complete." : "Inspection passed."}${closed}`);
  }
}

/**
 * A permit's inspections: book one, record its result, correct or remove it.
 * A result recorded here is the workflow step's result too — the dialog says
 * which step and what will happen to it.
 */
export function PermitInspections({ jobId, permitId, inspections, steps, canEdit }: { jobId: string; permitId: string; inspections: PermitInspection[]; steps: InspectionStep[]; canEdit: boolean }) {
  const refresh = useRefresh(jobId, permitId);
  const [adding, setAdding] = useState(false);
  const [recording, setRecording] = useState<PermitInspection | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PermitInspection | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/inspections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      setRemoving(null);
      toast.success("Inspection removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/inspections/${id}`, json("PATCH", { result: "CANCELLED" })),
    onSuccess: () => {
      refresh();
      toast.success("Inspection cancelled");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Inspections</h4>
        {canEdit && !adding && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Schedule inspection
          </Button>
        )}
      </div>

      {adding && <ScheduleForm jobId={jobId} permitId={permitId} onDone={() => setAdding(false)} />}

      {inspections.length === 0 && !adding && <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">No inspections on this permit yet.</p>}

      {inspections.map((i) => (
        <div key={i.id} className="rounded-md border bg-white text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses(RESULT_TONE[i.result] ?? "neutral").pill)}>{RESULT_LABEL[i.result] ?? i.result}</span>
            <span className="font-medium">{typeLabel(i.type)}</span>
            <span className="text-xs text-muted-foreground">
              {i.result === "SCHEDULED" || !i.completedAt ? formatWhen(i.scheduledFor) : formatDay(i.completedAt)}
              {i.inspectorName ? ` · ${i.inspectorName}` : ""}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {canEdit && i.result === "SCHEDULED" && (
                <Button size="sm" variant="brand" className="h-7 text-xs" onClick={() => setRecording(i)}>
                  <ClipboardCheck className="size-3.5" /> Record result
                </Button>
              )}
              {canEdit && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(editing === i.id ? null : i.id)}>
                  {editing === i.id ? "Close" : "Edit"}
                </Button>
              )}
            </div>
          </div>
          {(i.notes || i.task) && editing !== i.id && (
            <div className="space-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
              {i.notes && <p className="whitespace-pre-wrap">{i.notes}</p>}
              {i.task && (
                <p className="flex items-center gap-1">
                  <Link2 className="size-3" /> Workflow step:{" "}
                  <Link href={`/tasks?task=${i.task.id}`} className="underline underline-offset-2">
                    {i.task.title}
                  </Link>
                </p>
              )}
            </div>
          )}
          {editing === i.id && (
            <EditForm
              jobId={jobId}
              insp={i}
              onDone={() => setEditing(null)}
              onCorrect={() => setRecording(i)}
              onCancelInspection={() => cancel.mutate(i.id)}
              onDelete={() => setRemoving(i)}
            />
          )}
        </div>
      ))}

      {recording && <ResultDialog jobId={jobId} insp={recording} steps={steps} onClose={() => setRecording(null)} />}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this inspection?"
        description={removing ? `${typeLabel(removing.type)} — ${RESULT_LABEL[removing.result] ?? removing.result}. A correction task it raised stays where it is.` : undefined}
        tone="danger"
        confirmLabel="Remove"
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </div>
  );
}

function TypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={(v: string | null) => v && onChange(v)}>
      <SelectTrigger className="h-8">
        <SelectValue>{(v: string) => typeLabel(v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {INSPECTION_TYPES.map((t) => (
          <SelectItem key={t} value={t}>
            {typeLabel(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ScheduleForm({ jobId, permitId, onDone }: { jobId: string; permitId: string; onDone: () => void }) {
  const refresh = useRefresh(jobId, permitId);
  const [form, setForm] = useState({ type: "FINAL", day: "", time: "", inspectorName: "", notes: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const create = useMutation({
    mutationFn: () => fetchJson(`/api/permits/${permitId}/inspections`, json("POST", { type: form.type, scheduledFor: joinWhen(form.day, form.time), inspectorName: form.inspectorName, notes: form.notes })),
    onSuccess: () => {
      refresh();
      toast.success("Inspection scheduled");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-2 rounded-md border bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <Label className="text-[11px]">Type</Label>
          <TypeSelect value={form.type} onChange={(v) => set("type", v)} />
        </div>
        <div>
          <Label className="text-[11px]">Date</Label>
          <Input type="date" className="h-8" value={form.day} onChange={(e) => set("day", e.target.value)} />
        </div>
        <div>
          <Label className="text-[11px]">Time (optional)</Label>
          <Input type="time" className="h-8" value={form.time} disabled={!form.day} onChange={(e) => set("time", e.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <Label className="text-[11px]">Inspector</Label>
          <Input className="h-8" value={form.inspectorName} onChange={(e) => set("inspectorName", e.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <Label className="text-[11px]">Notes</Label>
          <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "Saving…" : "Schedule inspection"}
        </Button>
      </div>
    </div>
  );
}

function EditForm({ jobId, insp, onDone, onCorrect, onCancelInspection, onDelete }: { jobId: string; insp: PermitInspection; onDone: () => void; onCorrect: () => void; onCancelInspection: () => void; onDelete: () => void }) {
  const refresh = useRefresh(jobId, insp.permitId);
  const [form, setForm] = useState({ type: insp.type, day: dayOf(insp.scheduledFor), time: timeOf(insp.scheduledFor), inspectorName: insp.inspectorName ?? "", notes: insp.notes ?? "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () => fetchJson(`/api/inspections/${insp.id}`, json("PATCH", { type: form.type, scheduledFor: joinWhen(form.day, form.time), inspectorName: form.inspectorName, notes: form.notes })),
    onSuccess: () => {
      refresh();
      toast.success("Inspection updated");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-2 border-t bg-gray-50 px-3 py-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <Label className="text-[11px]">Type</Label>
          <TypeSelect value={form.type} onChange={(v) => set("type", v)} />
        </div>
        <div>
          <Label className="text-[11px]">Scheduled date</Label>
          <Input type="date" className="h-8" value={form.day} onChange={(e) => set("day", e.target.value)} />
        </div>
        <div>
          <Label className="text-[11px]">Time (optional)</Label>
          <Input type="time" className="h-8" value={form.time} disabled={!form.day} onChange={(e) => set("time", e.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <Label className="text-[11px]">Inspector</Label>
          <Input className="h-8" value={form.inspectorName} onChange={(e) => set("inspectorName", e.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <Label className="text-[11px]">Notes</Label>
          <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {insp.result === "SCHEDULED" ? (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancelInspection}>
              Cancel inspection
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCorrect}>
              Change result
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs text-tone-danger-fg" onClick={onDelete}>
            Remove
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onDone}>
            Close
          </Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const RESULTS = [
  { value: "PASS", label: "Passed" },
  { value: "CONDITIONAL", label: "Passed with conditions" },
  { value: "FAIL", label: "Failed" },
] as const;
type Result = (typeof RESULTS)[number]["value"];

const NO_STEP = "none";

function ResultDialog({ jobId, insp, steps, onClose }: { jobId: string; insp: PermitInspection; steps: InspectionStep[]; onClose: () => void }) {
  const refresh = useRefresh(jobId, insp.permitId);
  const suggested = steps.find((s) => s.id === insp.taskId) ?? (matchInspectionStep(insp.type as (typeof INSPECTION_TYPES)[number], steps) as InspectionStep | null);
  const [result, setResult] = useState<Result>(insp.result === "FAIL" || insp.result === "CONDITIONAL" ? insp.result : "PASS");
  const [day, setDay] = useState(dayOf(insp.completedAt) || format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState(insp.notes ?? "");
  const [stepId, setStepId] = useState(suggested?.id ?? NO_STEP);
  const [last, setLast] = useState(false);
  const step = steps.find((s) => s.id === stepId) ?? null;
  const several = step ? stepCoversSeveral(step.workflowTaskKey) : false;
  const blocked = step?.status === "BLOCKED";

  const record = useMutation({
    mutationFn: () =>
      fetchJson<Saved>(
        `/api/inspections/${insp.id}`,
        json("PATCH", {
          result,
          notes: notes.trim() || null,
          completedAt: day || null,
          // Unchanged from the suggestion: the server decides the same way it would from any other screen.
          taskId: stepId === NO_STEP ? null : stepId === suggested?.id ? undefined : stepId,
          completesStep: several && last,
        }),
      ),
    onSuccess: (r) => {
      refresh();
      announce(r);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // What this entry will do, said before it is saved.
  let effect: string;
  if (!step) effect = result === "PASS" ? "Recorded on the permit only." : "A correction task will be created on the job.";
  else if (result === "FAIL") effect = `"${step.title}" will be blocked and a correction task created; the step reopens for re-inspection when the correction is done.`;
  else if (blocked) effect = `"${step.title}" is blocked on a correction and reopens when that is done; this result is recorded on the permit.`;
  else if (several && !last) effect = insp.type === "FINAL" || insp.type === "ROOFING_FINAL" ? `"${step.title}" completes by itself once every permit on the job is Final.` : `"${step.title}" stays open for the other inspections it covers.`;
  else effect = result === "CONDITIONAL" ? `"${step.title}" will be completed and a correction task created for the conditions.` : `"${step.title}" will be completed.`;

  const same = result === insp.result;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{insp.result === "SCHEDULED" ? "Record inspection result" : "Change inspection result"}</DialogTitle>
          <DialogDescription>
            {typeLabel(insp.type)} inspection{insp.scheduledFor ? ` · scheduled ${formatWhen(insp.scheduledFor)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={result} onValueChange={(v) => setResult(v as Result)} className="gap-1">
          {RESULTS.map((r) => (
            <label key={r.value} className={cn("flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm", result === r.value && "border-brand bg-brand/5")}>
              <RadioGroupItem value={r.value} aria-label={r.label} />
              <span className="font-medium">{r.label}</span>
            </label>
          ))}
        </RadioGroup>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pi-day" className="text-xs">
              Inspected on
            </Label>
            <Input id="pi-day" type="date" className="mt-1 h-8" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          {steps.length > 0 && (
            <div>
              <Label className="text-xs">Workflow step</Label>
              <Select value={stepId} onValueChange={(v: string | null) => v && setStepId(v)}>
                <SelectTrigger className="mt-1 h-8">
                  <SelectValue>{(v: string) => steps.find((s) => s.id === v)?.title ?? "Not a workflow step"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {steps.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                  <SelectItem value={NO_STEP}>Not a workflow step</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div>
          <Label htmlFor="pi-notes" className="text-xs">
            Inspector notes {result !== "PASS" ? "(what needs correcting)" : "(optional)"}
          </Label>
          <Textarea id="pi-notes" rows={3} className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {step && several && result !== "FAIL" && !blocked && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={last} onCheckedChange={(v) => setLast(Boolean(v))} />
            This is the last inspection &ldquo;{step.title}&rdquo; was waiting for — complete the step
          </label>
        )}
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{effect}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={record.isPending}>
            Cancel
          </Button>
          <Button variant="brand" disabled={record.isPending || same || (result !== "PASS" && !notes.trim())} onClick={() => record.mutate()}>
            {record.isPending ? "Saving…" : result === "PASS" ? "Record pass" : result === "FAIL" ? "Record failure" : "Record conditional pass"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
