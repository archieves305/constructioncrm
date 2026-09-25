"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { useAssignableUsers } from "@/components/tasks/use-tasks";
import { fetchJson } from "@/lib/fetch-json";
import { WORKFLOW_ROLE_LABEL, WORKFLOW_ROLES } from "@/lib/workflows/role-labels";
import { allowedTransitions, transitionNeedsReason } from "@/lib/violations/rules";
import type { ClosureBlocker } from "@/lib/violations/rules";
import { CASE_STATUS_LABEL, NOTICE_TYPE_LABEL, SEVERITY_LABEL } from "./status";
import { useCaseAction, type CaseData } from "./use-violations";
import { ChevronDown } from "lucide-react";

/** Lifecycle moves. Closure has its own dialog. */
export function ChangeStatusMenu({ data }: { data: CaseData }) {
  const [target, setTarget] = useState<string | null>(null);
  const change = useCaseAction<{ status: string; reason: string | null }>(data.id, "/status", { success: "Status changed" });
  const options = allowedTransitions(data.status).filter((s) => s !== "CANCELLED" || data.permissions.canCancel);
  if (!data.permissions.canEdit || options.length === 0) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          Change status <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {options.map((s) => (
            <DropdownMenuItem key={s} onClick={() => setTarget(s)}>
              {CASE_STATUS_LABEL[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={Boolean(target)}
        onOpenChange={(o) => !o && setTarget(null)}
        title={`Move to ${target ? CASE_STATUS_LABEL[target] : ""}`}
        tone={target === "CANCELLED" ? "danger" : "info"}
        confirmLabel={target === "CANCELLED" ? "Cancel case" : "Change status"}
        requireReason={target ? transitionNeedsReason(target as never) : false}
        pending={change.isPending}
        onConfirm={(reason) => {
          if (target) change.mutate({ status: target, reason: reason || null }, { onSuccess: () => setTarget(null) });
        }}
      />
    </>
  );
}

/** Close: with every blocker clear it is a confirm; otherwise ADMIN/MANAGER override with a reason and an acknowledgement. */
export function CloseCaseDialog({ data, open, onOpenChange }: { data: CaseData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: blockers, isLoading } = useQuery<{ blockers: ClosureBlocker[] }>({ queryKey: ["violation-blockers", data.id], queryFn: () => fetchJson(`/api/violations/${data.id}/close`), enabled: open });
  const close = useCaseAction<Record<string, unknown>>(data.id, "/close", { success: "Case closed" });
  const list = blockers?.blockers ?? [];
  const clear = list.length === 0;
  if (open && isLoading) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close {data.caseNumber}</DialogTitle>
          </DialogHeader>
          <Skeleton className="h-16" />
        </DialogContent>
      </Dialog>
    );
  }
  if (clear) {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Close ${data.caseNumber}`}
        description="Every item is verified or withdrawn, the agency's confirmation is on file, fines and liens are resolved. Open workflow steps are skipped as “case closed”."
        confirmLabel="Close case"
        reasonLabel="Closing notes (optional)"
        pending={close.isPending}
        onConfirm={(reason) => close.mutate({ reason: reason || null }, { onSuccess: () => onOpenChange(false) })}
      />
    );
  }
  if (!data.permissions.canOverrideClosure) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This case cannot close yet</DialogTitle>
            <DialogDescription>Construction completion is not compliance. Clear these first, or ask an admin or manager to close with an override.</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {list.map((b) => (
              <li key={b.key}>{b.message}</li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Close ${data.caseNumber} without every blocker cleared`}
      tone="danger"
      warning={
        <div>
          <p className="font-medium">Not ready to close:</p>
          <ul className="mt-1 list-disc pl-5">
            {list.map((b) => (
              <li key={b.key}>{b.message}</li>
            ))}
          </ul>
        </div>
      }
      confirmLabel="Close with override"
      requireReason={{ minLength: 10 }}
      reasonLabel="Why this case is being closed anyway"
      checkboxLabel="I understand the CRM records this closure as an override, with my name and reason, and that the agency has not confirmed compliance where noted above."
      pending={close.isPending}
      onConfirm={(reason) => close.mutate({ override: { reason } }, { onSuccess: () => onOpenChange(false) })}
    />
  );
}

export function ReopenCaseDialog({ data, open, onOpenChange }: { data: CaseData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const reopen = useCaseAction<{ reason: string }>(data.id, "/reopen", { success: "Case reopened" });
  return <ConfirmDialog open={open} onOpenChange={onOpenChange} title={`Reopen ${data.caseNumber}`} confirmLabel="Reopen" requireReason pending={reopen.isPending} onConfirm={(reason) => reopen.mutate({ reason }, { onSuccess: () => onOpenChange(false) })} />;
}

/** ADMIN/MANAGER: the agency's written confirmation. */
export function AgencyConfirmDialog({ data, open, onOpenChange }: { data: CaseData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [f, setF] = useState({ confirmedAt: new Date().toISOString().slice(0, 10), confirmedByName: data.officerName ?? "", method: "email", reference: "", officialComplianceDate: "", notes: "" });
  const confirm = useCaseAction<Record<string, unknown>>(data.id, "/agency-confirm", { success: "Agency confirmation recorded" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record the agency&apos;s compliance confirmation</DialogTitle>
          <DialogDescription>The formal confirmation from the issuing agency. This is what allows the case to close; construction completion never counts.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Confirmed on</Label>
            <Input type="date" className="mt-1" value={f.confirmedAt} onChange={(e) => set("confirmedAt", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Official compliance date (if different)</Label>
            <Input type="date" className="mt-1" value={f.officialComplianceDate} onChange={(e) => set("officialComplianceDate", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Confirmed by (agency)</Label>
            <Input className="mt-1" value={f.confirmedByName} onChange={(e) => set("confirmedByName", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Method</Label>
            <Select value={f.method} onValueChange={(v: string | null) => v && set("method", v)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => v.charAt(0).toUpperCase() + v.slice(1)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {["email", "letter", "portal", "phone", "inspection"].map((m) => (
                  <SelectItem key={m} value={m}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Reference (letter #, portal id, email subject)</Label>
            <Input className="mt-1" value={f.reference} onChange={(e) => set("reference", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea className="mt-1" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <Callout tone="info">Attach the confirmation letter on the Documents tab as well, so the closeout package is complete.</Callout>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={confirm.isPending || !f.confirmedAt} onClick={() => confirm.mutate({ confirmedAt: f.confirmedAt, confirmedByName: f.confirmedByName.trim() || null, method: f.method, reference: f.reference.trim() || null, officialComplianceDate: f.officialComplianceDate || null, notes: f.notes.trim() || null }, { onSuccess: () => onOpenChange(false) })}>
            {confirm.isPending ? "Saving…" : "Record confirmation"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Move = { taskId: string; key: string | null; title: string; oldDueAt: string | null; newDueAt: string | null; locked: boolean };

/** Two steps: the new date + why → the preview of every step that moves → apply. */
export function DeadlineChangeDialog({ data, open, onOpenChange }: { data: CaseData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [newDeadline, setNewDeadline] = useState(data.currentDeadline?.slice(0, 10) ?? "");
  const [kind, setKind] = useState("AGENCY_RESCHEDULE");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<{ current: string | null; moves: Move[] } | null>(null);
  const previewReq = useCaseAction<Record<string, unknown>, { current: string | null; moves: Move[] }>(data.id, "/deadline/preview", { errorFallback: "Could not build the preview" });
  const apply = useCaseAction<Record<string, unknown>>(data.id, "/deadline", { success: "Deadline changed" });
  const KINDS: Record<string, string> = { AGENCY_RESCHEDULE: "Agency rescheduled", EXTENSION_GRANTED: "Extension granted", HEARING_ORDER: "Set by a hearing order", CORRECTION: "Correcting a data-entry error" };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setPreview(null); onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{preview ? "Review the date changes" : "Change the compliance deadline"}</DialogTitle>
          <DialogDescription>{preview ? "Every open step anchored to the deadline moves with it; hand-edited dates are kept." : `Currently ${data.currentDeadline ? format(new Date(data.currentDeadline), "MMM d, yyyy") : "not set"}. Nothing changes until you confirm the preview.`}</DialogDescription>
        </DialogHeader>
        {!preview ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">New deadline</Label>
              <Input type="date" className="mt-1" value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Why</Label>
              <Select value={kind} onValueChange={(v: string | null) => v && setKind(v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue>{(v: string) => KINDS[v] ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KINDS).map(([k, l]) => (
                    <SelectItem key={k} value={k}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Reference</Label>
              <Input className="mt-1" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Letter, order or email" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Reason (recorded)</Label>
              <Textarea className="mt-1" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {preview.moves.length === 0 ? (
              <Callout tone="neutral">No open workflow steps are anchored to the deadline. Only the case&apos;s date changes.</Callout>
            ) : (
              <ul className="divide-y rounded-md border text-sm">
                {preview.moves.map((m) => (
                  <li key={m.taskId} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate">{m.title}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{m.oldDueAt ? format(new Date(m.oldDueAt), "MMM d") : "—"}</span>
                    <span className="text-xs">→</span>
                    <span className={`text-xs tabular-nums ${m.locked ? "text-muted-foreground" : "font-medium"}`}>{m.newDueAt ? format(new Date(m.newDueAt), "MMM d") : "—"}</span>
                    {m.locked && <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-600">kept — hand-edited</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{preview ? "Step 2 of 2" : "Step 1 of 2"}</span>
          <div className="flex gap-2">
            {preview ? (
              <>
                <Button variant="ghost" onClick={() => setPreview(null)}>
                  Back
                </Button>
                <Button variant="brand" disabled={apply.isPending} onClick={() => apply.mutate({ newDeadline, kind, reason: reason.trim(), reference: reference.trim() || null }, { onSuccess: () => { setPreview(null); onOpenChange(false); } })}>
                  {apply.isPending ? "Applying…" : "Confirm — change deadline"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button disabled={!newDeadline || !reason.trim() || previewReq.isPending} onClick={() => previewReq.mutate({ newDeadline }, { onSuccess: (p) => setPreview(p) })}>
                  {previewReq.isPending ? "Building preview…" : "Preview changes"}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Request an extension, and decide a pending one (granting moves the deadline through the same path). */
export function ExtensionDialog({ data, open, onOpenChange }: { data: CaseData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const pending = data.extensions.find((e) => e.status === "REQUESTED") ?? null;
  const [requestedDeadline, setRequestedDeadline] = useState("");
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"GRANTED" | "DENIED" | "WITHDRAWN">("GRANTED");
  const [granted, setGranted] = useState("");
  const [notes, setNotes] = useState("");
  const request = useCaseAction<Record<string, unknown>>(data.id, "/extension", { success: "Extension requested" });
  const decide = useCaseAction<Record<string, unknown>>(data.id, `/extension/${pending?.id ?? ""}`, { success: (r) => ((r as { result?: { moved: number } }).result?.moved ? "Extension granted — deadline and dependent steps moved" : "Extension decision recorded") });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{pending ? "Record the agency's decision" : "Request a compliance-deadline extension"}</DialogTitle>
          <DialogDescription>{pending ? `Requested ${format(new Date(pending.requestedDeadline), "MMM d, yyyy")}. Granting moves the current deadline and previews nothing — the dependent steps move as the deadline-change path does.` : "Recorded on the case; the request itself goes to the agency by letter, portal or email."}</DialogDescription>
        </DialogHeader>
        {pending ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Decision</Label>
              <Select value={decision} onValueChange={(v: string | null) => v && setDecision(v as typeof decision)}>
                <SelectTrigger className="mt-1">
                  <SelectValue>{(v: string) => v.charAt(0) + v.slice(1).toLowerCase()}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GRANTED">Granted</SelectItem>
                  <SelectItem value="DENIED">Denied</SelectItem>
                  <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {decision === "GRANTED" && (
              <div>
                <Label className="text-xs">Granted until (blank = as requested)</Label>
                <Input type="date" className="mt-1" value={granted} onChange={(e) => setGranted(e.target.value)} />
              </div>
            )}
            <div className="sm:col-span-2">
              <Label className="text-xs">Decision notes</Label>
              <Textarea className="mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <div>
              <Label className="text-xs">Requested deadline</Label>
              <Input type="date" className="mt-1" value={requestedDeadline} onChange={(e) => setRequestedDeadline(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Reason given to the agency</Label>
              <Textarea className="mt-1" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {pending ? (
            <Button variant="brand" disabled={decide.isPending} onClick={() => decide.mutate({ status: decision, grantedDeadline: decision === "GRANTED" && granted ? granted : null, decisionNotes: notes.trim() || null }, { onSuccess: () => onOpenChange(false) })}>
              {decide.isPending ? "Saving…" : "Record decision"}
            </Button>
          ) : (
            <Button variant="brand" disabled={!requestedDeadline || request.isPending} onClick={() => request.mutate({ requestedDeadline, reason: reason.trim() || null }, { onSuccess: () => onOpenChange(false) })}>
              {request.isPending ? "Saving…" : "Record request"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The case header fields. The current deadline is deliberately not here — it moves through the deadline-change dialog. */
export function EditCaseDialog({ data, open, onOpenChange }: { data: CaseData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: users = [] } = useAssignableUsers();
  const [f, setF] = useState({
    title: data.title,
    agencyCaseNumber: data.agencyCaseNumber ?? "",
    parcelNumber: data.parcelNumber ?? "",
    ownerNameSnapshot: data.ownerNameSnapshot ?? "",
    jurisdiction: data.jurisdiction ?? "",
    department: data.department ?? "",
    officerName: data.officerName ?? "",
    officerPhone: data.officerPhone ?? "",
    officerEmail: data.officerEmail ?? "",
    noticeType: data.noticeType ?? "",
    noticeDate: data.noticeDate?.slice(0, 10) ?? "",
    receivedAt: data.receivedAt.slice(0, 10),
    appealDeadline: data.appealDeadline?.slice(0, 10) ?? "",
    priority: data.priority,
    severity: data.severity,
    caseManagerId: data.caseManagerId,
    responsibleRole: data.responsibleRole ?? "",
    hearingRequired: data.hearingRequired,
    reinspectionRequired: data.reinspectionRequired,
    emergency: data.emergency,
    constructionRequired: data.constructionRequired,
    estimatedCost: data.estimatedCost ?? "",
    actualCost: data.actualCost ?? "",
    summary: data.summary ?? "",
  });
  const save = useCaseAction<Record<string, unknown>>(data.id, "", { method: "PATCH", success: "Case saved" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const canAssign = data.permissions.canAssign;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {data.caseNumber}</DialogTitle>
          <DialogDescription>The compliance deadline is changed from the header&apos;s “Change deadline”, so its history and the dependent dates stay honest.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Title</Label>
            <Input className="mt-1" value={f.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Agency case / citation #</Label>
            <Input className="mt-1" value={f.agencyCaseNumber} onChange={(e) => set("agencyCaseNumber", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Parcel / folio</Label>
            <Input className="mt-1" value={f.parcelNumber} onChange={(e) => set("parcelNumber", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Owner (as on the notice)</Label>
            <Input className="mt-1" value={f.ownerNameSnapshot} onChange={(e) => set("ownerNameSnapshot", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Notice type</Label>
            <Select value={f.noticeType || "__none"} onValueChange={(v: string | null) => set("noticeType", !v || v === "__none" ? "" : v)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => (!v || v === "__none" ? "—" : (NOTICE_TYPE_LABEL[v] ?? v))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">—</SelectItem>
                {Object.entries(NOTICE_TYPE_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Jurisdiction</Label>
            <Input className="mt-1" value={f.jurisdiction} onChange={(e) => set("jurisdiction", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Department</Label>
            <Input className="mt-1" value={f.department} onChange={(e) => set("department", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Code officer</Label>
            <Input className="mt-1" value={f.officerName} onChange={(e) => set("officerName", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Officer phone</Label>
            <Input className="mt-1" value={f.officerPhone} onChange={(e) => set("officerPhone", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Officer email</Label>
            <Input className="mt-1" value={f.officerEmail} onChange={(e) => set("officerEmail", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Notice date</Label>
            <Input type="date" className="mt-1" value={f.noticeDate} onChange={(e) => set("noticeDate", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Received</Label>
            <Input type="date" className="mt-1" value={f.receivedAt} onChange={(e) => set("receivedAt", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Appeal deadline</Label>
            <Input type="date" className="mt-1" value={f.appealDeadline} onChange={(e) => set("appealDeadline", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Priority</Label>
            <Select value={f.priority} onValueChange={(v: string | null) => v && set("priority", v as typeof f.priority)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => v.charAt(0) + v.slice(1).toLowerCase()}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                  <SelectItem key={p} value={p}>
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Severity</Label>
            <Select value={f.severity} onValueChange={(v: string | null) => v && set("severity", v as typeof f.severity)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => SEVERITY_LABEL[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SEVERITY_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Case manager</Label>
            <AssigneePicker className="mt-1 w-full" value={f.caseManagerId} users={users} onChange={(id) => set("caseManagerId", id)} />
            {!canAssign && <p className="text-[11px] text-muted-foreground">Office roles reassign cases.</p>}
          </div>
          <div>
            <Label className="text-xs">Responsible team</Label>
            <Select value={f.responsibleRole || "__none"} onValueChange={(v: string | null) => set("responsibleRole", !v || v === "__none" ? "" : v)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => (!v || v === "__none" ? "—" : (WORKFLOW_ROLE_LABEL[v as keyof typeof WORKFLOW_ROLE_LABEL] ?? v))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">—</SelectItem>
                {WORKFLOW_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {WORKFLOW_ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Estimated correction cost</Label>
            <Input className="mt-1" inputMode="decimal" value={f.estimatedCost} onChange={(e) => set("estimatedCost", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Actual correction cost</Label>
            <Input className="mt-1" inputMode="decimal" value={f.actualCost} onChange={(e) => set("actualCost", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            {(
              [
                ["hearingRequired", "Hearing required"],
                ["reinspectionRequired", "Reinspection required"],
                ["emergency", "Emergency / unsafe condition"],
                ["constructionRequired", "Corrective construction required"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox checked={f[k]} onCheckedChange={(v) => set(k, Boolean(v))} /> {l}
              </label>
            ))}
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Summary</Label>
            <Textarea className="mt-1" rows={3} value={f.summary} onChange={(e) => set("summary", e.target.value)} />
          </div>
        </div>
        <Callout tone="neutral">Changing the flags here does not re-plan the workflow; use Scope on the Workflow tab for that.</Callout>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={save.isPending || !f.title.trim()}
            onClick={() =>
              save.mutate(
                {
                  title: f.title.trim(),
                  agencyCaseNumber: f.agencyCaseNumber.trim() || null,
                  parcelNumber: f.parcelNumber.trim() || null,
                  ownerNameSnapshot: f.ownerNameSnapshot.trim() || null,
                  jurisdiction: f.jurisdiction.trim() || null,
                  department: f.department.trim() || null,
                  officerName: f.officerName.trim() || null,
                  officerPhone: f.officerPhone.trim() || null,
                  officerEmail: f.officerEmail.trim() || null,
                  noticeType: f.noticeType || null,
                  noticeDate: f.noticeDate || null,
                  receivedAt: f.receivedAt || undefined,
                  appealDeadline: f.appealDeadline || null,
                  priority: f.priority,
                  severity: f.severity,
                  ...(canAssign ? { caseManagerId: f.caseManagerId } : {}),
                  responsibleRole: f.responsibleRole || null,
                  hearingRequired: f.hearingRequired,
                  reinspectionRequired: f.reinspectionRequired,
                  emergency: f.emergency,
                  constructionRequired: f.constructionRequired,
                  estimatedCost: f.estimatedCost.trim() || null,
                  actualCost: f.actualCost.trim() || null,
                  summary: f.summary.trim() || null,
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
