"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ClipboardCheck, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { useAssignableUsers, useTasks } from "@/components/tasks/use-tasks";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { INSPECTION_RESULT_TONE } from "./status";
import { useCaseAction, type CaseData } from "./use-violations";

type Inspection = CaseData["inspections"][number];

/** Agency inspections: request/schedule, then record the result — a FAIL reopens the re-cited items. */
export function InspectionsPanel({ data }: { data: CaseData }) {
  const [requesting, setRequesting] = useState(false);
  const [resultFor, setResultFor] = useState<Inspection | null>(null);
  const can = data.permissions.canRecordInspection && data.status !== "CLOSED" && data.status !== "CANCELLED";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {data.reinspectionRequestedAt ? `Reinspection requested ${format(new Date(data.reinspectionRequestedAt), "MMM d, yyyy")}` : "No reinspection requested yet"}
          {data.agencyConfirmedAt ? ` · agency confirmed compliance ${format(new Date(data.agencyConfirmedAt), "MMM d, yyyy")}` : ""}
        </p>
        {can && (
          <Button size="sm" variant="brand" onClick={() => setRequesting(true)}>
            <Plus className="size-3.5" /> Request inspection
          </Button>
        )}
      </div>
      {data.inspections.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No agency inspections yet" description="Request a reinspection once corrections are done; record the result when the inspector comes out." />
      ) : (
        <ul className="space-y-2">
          {data.inspections.map((i) => (
            <li key={i.id} id={`inspection-${i.id}`} className="rounded-lg border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px] capitalize">
                  {i.kind.toLowerCase()}
                </Badge>
                <span className="font-medium">{i.scheduledFor ? format(new Date(i.scheduledFor), "EEE MMM d, yyyy · h:mm a") : `Requested ${format(new Date(i.requestedAt), "MMM d, yyyy")}`}</span>
                {i.result ? (
                  <Badge className={cn("border-0 text-[10px]", toneClasses(INSPECTION_RESULT_TONE[i.result] ?? "neutral").pill)}>{i.result}</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {i.status.toLowerCase()}
                  </Badge>
                )}
                {i.inspectorName && <span className="text-xs text-muted-foreground">Inspector: {i.inspectorName}</span>}
                <span className="ml-auto flex items-center gap-2">
                  {i.attendee && <UserAvatar user={i.attendee} size="xs" title={`Attendee: ${i.attendee.firstName} ${i.attendee.lastName}`} />}
                  {can && !i.result && i.status !== "CANCELLED" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setResultFor(i)}>
                      Record result
                    </Button>
                  )}
                </span>
              </div>
              {i.notes && <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">{i.notes}</p>}
              {i.failedItemIds.length > 0 && <p className="mt-1 text-xs text-tone-danger-fg">Re-cited items: {i.failedItemIds.map((id) => data.items.find((it) => it.id === id)?.itemNumber ?? "?").join(", ")}</p>}
              {i.reportFileId && (
                <a className="mt-1 inline-block text-xs underline" href={`/api/files/${i.reportFileId}`} target="_blank" rel="noreferrer">
                  Inspection report
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <RequestInspectionDialog open={requesting} onOpenChange={setRequesting} data={data} />
      <InspectionResultDialog inspection={resultFor} data={data} onClose={() => setResultFor(null)} />
    </div>
  );
}

function RequestInspectionDialog({ open, onOpenChange, data }: { open: boolean; onOpenChange: (o: boolean) => void; data: CaseData }) {
  const { data: users = [] } = useAssignableUsers();
  const [kind, setKind] = useState<"INITIAL" | "REINSPECTION" | "FINAL">("REINSPECTION");
  const [scheduledFor, setScheduledFor] = useState("");
  const [attendee, setAttendee] = useState<string | null>(data.caseManagerId);
  const [inspector, setInspector] = useState(data.officerName ?? "");
  const [notes, setNotes] = useState("");
  const request = useCaseAction<Record<string, unknown>, unknown>(data.id, "/inspections", { success: "Inspection requested" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request an agency inspection</DialogTitle>
          <DialogDescription>A reinspection request marks the case as awaiting the agency.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Kind</Label>
            <Select value={kind} onValueChange={(v: string | null) => v && setKind(v as typeof kind)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => v.charAt(0) + v.slice(1).toLowerCase()}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INITIAL">Initial</SelectItem>
                <SelectItem value="REINSPECTION">Reinspection</SelectItem>
                <SelectItem value="FINAL">Final</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Scheduled for (if known)</Label>
            <Input type="datetime-local" className="mt-1" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Our attendee</Label>
            <AssigneePicker className="mt-1 w-full" value={attendee} users={users} onChange={setAttendee} />
          </div>
          <div>
            <Label className="text-xs">Inspector</Label>
            <Input className="mt-1" value={inspector} onChange={(e) => setInspector(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea className="mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Confirmation number, access arrangements…" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={request.isPending}
            onClick={() =>
              request.mutate(
                { kind, scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null, attendeeUserId: attendee, inspectorName: inspector.trim() || null, notes: notes.trim() || null },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {request.isPending ? "Saving…" : "Request"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The agency's result. FAIL needs the re-cited items; PASS may (ADMIN/MANAGER) count as the agency's confirmation. */
export function InspectionResultDialog({ inspection, data, onClose }: { inspection: Inspection | null; data: CaseData; onClose: () => void }) {
  const [result, setResult] = useState<"PASS" | "FAIL" | "CONDITIONAL">("PASS");
  const [completedAt, setCompletedAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [confirms, setConfirms] = useState(false);
  const { data: steps = [] } = useTasks({ violationCaseId: data.id, source: "workflow", includeInactive: true }, { enabled: Boolean(inspection) });
  const inspectionStep = steps.find((t) => t.workflowTaskKey?.endsWith(":agency_reinspection") && t.status !== "COMPLETED" && t.status !== "CANCELLED") ?? null;
  const record = useCaseAction<Record<string, unknown>>(data.id, `/inspections/${inspection?.id ?? ""}/result`, {
    success: (r) => {
      const res = (r as { result?: { result: string; reopened: number } }).result;
      return res?.result === "FAIL" ? `Failed inspection recorded — ${res.reopened} item${res.reopened === 1 ? "" : "s"} reopened` : "Inspection result recorded";
    },
  });
  const openItems = data.items.filter((i) => i.status !== "WITHDRAWN");
  return (
    <Dialog open={Boolean(inspection)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record the inspection result</DialogTitle>
          <DialogDescription>{inspectionStep ? `Also records it on the workflow step “${inspectionStep.title}”.` : "No open reinspection step on the workflow — the result is recorded on the case only."}</DialogDescription>
        </DialogHeader>
        <RadioGroup value={result} onValueChange={(v) => setResult(v as typeof result)} className="gap-1.5">
          {(["PASS", "CONDITIONAL", "FAIL"] as const).map((r) => (
            <label key={r} className={cn("flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 text-sm", result === r && "border-brand bg-brand/5")}>
              <RadioGroupItem value={r} aria-label={r} />
              <span className="font-medium">{r === "PASS" ? "Pass" : r === "CONDITIONAL" ? "Pass with conditions" : "Fail"}</span>
              <span className="text-xs text-muted-foreground">{r === "PASS" ? "Accepted items are verified" : r === "CONDITIONAL" ? "A correction task is created; the step completes" : "Re-cited items reopen; the step blocks until corrected"}</span>
            </label>
          ))}
        </RadioGroup>
        {result !== "PASS" && (
          <div>
            <Label className="text-xs">Items the agency re-cited {result === "FAIL" && "(required)"}</Label>
            <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
              {openItems.map((i) => (
                <li key={i.id}>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={failed.has(i.id)}
                      onCheckedChange={(v) =>
                        setFailed((s) => {
                          const n = new Set(s);
                          if (v) n.add(i.id);
                          else n.delete(i.id);
                          return n;
                        })
                      }
                    />
                    <span>
                      <span className="font-mono text-xs text-muted-foreground">#{i.itemNumber}</span> {i.description.slice(0, 90)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Inspected on</Label>
            <Input type="date" className="mt-1" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Inspector notes</Label>
            <Textarea className="mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        {result === "PASS" && data.permissions.canConfirmAgency && (
          <label className="flex items-start gap-2 rounded-md border border-dashed p-2.5 text-sm">
            <Checkbox className="mt-0.5" checked={confirms} onCheckedChange={(v) => setConfirms(Boolean(v))} />
            <span>
              This inspection is the agency&apos;s compliance confirmation.
              <span className="block text-xs text-muted-foreground">Records the official confirmation on the case — the closure precondition. Admin/manager only.</span>
            </span>
          </label>
        )}
        {result === "PASS" && !data.permissions.canConfirmAgency && <Callout tone="info">A pass verifies the items. An admin or manager records the agency&apos;s written confirmation separately.</Callout>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={result === "FAIL" ? "destructive" : "brand"}
            disabled={record.isPending || (result === "FAIL" && failed.size === 0)}
            onClick={() =>
              record.mutate(
                { result, completedAt, notes: notes.trim() || null, failedItemIds: Array.from(failed), taskId: inspectionStep?.id ?? null, confirmsAgency: result === "PASS" && confirms },
                { onSuccess: onClose },
              )
            }
          >
            {record.isPending ? "Recording…" : `Record ${result.toLowerCase()}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
