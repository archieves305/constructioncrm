"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Download, PackageCheck, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { formatFileSize } from "@/lib/files/limits";
import { permitDocLabel } from "@/lib/permit-intel/doc-types";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { METHOD_LABEL, OUTCOME_LABEL, type PermitCycle, type PermitDetail } from "./types";
import { usePermitWrite } from "./use-permit-intel";

const METHOD_ITEMS = ["PORTAL", "EMAIL", "IN_PERSON", "MAIL", "UNKNOWN"].map((v) => ({ value: v, label: METHOD_LABEL[v] }));
const OUTCOME_ITEMS = (["APPROVED", "CORRECTIONS", "DENIED", "WITHDRAWN"] as const).map((v) => ({ value: v, label: OUTCOME_LABEL[v] }));
const OUTCOME_TONE = { PENDING: "info", APPROVED: "success", CORRECTIONS: "warning", DENIED: "danger", WITHDRAWN: "neutral" } as const;
// what a package normally leaves out: what came back from the department
const NOT_SENT = new Set(["correction_notice", "approved_permit", "stamped_plans", "inspection_report", "fee_receipt", "closeout", "blank_application"]);

const day = (iso: string | null) => (iso ? format(new Date(iso), "MMM d, yyyy") : "—");

/**
 * What a package starts with: every document KNU sends, except what came
 * back from the department, and except a document already sent in an
 * earlier package once a newer one of the same type is on file (the old NOC
 * is not sent beside its replacement). A person can tick anything back.
 */
export function defaultPackage(files: { id: string; permitDocType: string | null; permitLock: string | null; createdAt: string }[]): string[] {
  return files
    .filter((f) => !NOT_SENT.has(f.permitDocType ?? ""))
    .filter((f) => !(f.permitLock === "submitted" && f.permitDocType && files.some((g) => g.id !== f.id && g.permitDocType === f.permitDocType && g.createdAt > f.createdAt)))
    .map((f) => f.id);
}

/**
 * The review cycles: each submission and the building department's answer
 * to it. A package frozen here is the record of exactly what was sent.
 */
export function PermitCycles({ detail }: { detail: PermitDetail }) {
  const { permit, permissions } = detail;
  const latest = permit.cycles[0] ?? null;
  const waiting = latest?.outcome === "PENDING" && (!!latest.submission || !!latest.submittedAt);
  const [freezing, setFreezing] = useState(false);
  const [answering, setAnswering] = useState<PermitCycle | null>(null);
  const [manual, setManual] = useState(false);

  return (
    <div className="space-y-4">
      {permissions.canSubmit && (
        <div className="flex flex-wrap justify-end gap-2">
          {!waiting && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setManual(true)}>
                Record a submission made elsewhere
              </Button>
              <Button size="sm" variant="brand" onClick={() => setFreezing(true)}>
                <Send className="size-3.5" /> {latest ? "Submit again" : "Submit to the department"}
              </Button>
            </>
          )}
          {waiting && latest && (
            <Button size="sm" variant="brand" onClick={() => setAnswering(latest)}>
              Record the department&apos;s answer
            </Button>
          )}
        </div>
      )}

      {permit.cycles.length === 0 ? (
        <EmptyState icon={PackageCheck} title="Not submitted yet" description="When the package is ready, freeze it here: the CRM keeps an exact copy of what was sent and starts the review clock." />
      ) : (
        permit.cycles.map((c) => <CycleCard key={c.id} cycle={c} />)
      )}

      <Dialog open={freezing} onOpenChange={setFreezing}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{freezing && <FreezeForm detail={detail} onClose={() => setFreezing(false)} />}</DialogContent>
      </Dialog>
      <Dialog open={!!answering} onOpenChange={(o) => !o && setAnswering(null)}>
        <DialogContent className="sm:max-w-md">{answering && <AnswerForm detail={detail} cycle={answering} onClose={() => setAnswering(null)} />}</DialogContent>
      </Dialog>
      <Dialog open={manual} onOpenChange={setManual}>
        <DialogContent className="sm:max-w-md">{manual && <ManualForm detail={detail} onClose={() => setManual(false)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function CycleCard({ cycle: c }: { cycle: PermitCycle }) {
  const s = c.submission;
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm">Review cycle {c.number}</CardTitle>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses(OUTCOME_TONE[c.outcome]).pill)}>{OUTCOME_LABEL[c.outcome]}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Submitted {day(c.submittedAt)}
          {s ? ` · ${METHOD_LABEL[s.method] ?? s.method}${s.confirmationRef ? ` · confirmation ${s.confirmationRef}` : ""} · by ${s.submittedBy.firstName} ${s.submittedBy.lastName}` : " · no package in the CRM"}
          {c.outcomeAt ? ` · answered ${day(c.outcomeAt)}` : ""}
          {c.reviewerName ? ` · reviewer ${c.reviewerName}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {c.notes && <p className="whitespace-pre-wrap text-sm">{c.notes}</p>}
        {s && (
          <>
            <ul className="divide-y rounded-md border text-sm">
              {s.manifest.map((m) => (
                <li key={m.fileId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                  <span className="min-w-0 truncate">{m.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {permitDocLabel(m.docType)} · {formatFileSize(m.bytes)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="truncate font-mono text-[10px] text-muted-foreground" title="SHA-256 of the frozen package">
                sha256 {s.sha256.slice(0, 16)}… · {formatFileSize(s.sizeBytes)}
              </span>
              <Button size="sm" variant="outline" render={<a href={`/api/permit-submissions/${s.id}/download`} />} nativeButton={false}>
                <Download className="size-3.5" /> Download the package
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FreezeForm({ detail, onClose }: { detail: PermitDetail; onClose: () => void }) {
  const { permit, files, checklist } = detail;
  const write = usePermitWrite(permit.id, permit.jobId);
  const sendable = files.filter((f) => !f.missing);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(defaultPackage(sendable)));
  const [method, setMethod] = useState(detail.permit.jurisdiction?.submissionMethod && detail.permit.jurisdiction.submissionMethod !== "UNKNOWN" ? detail.permit.jurisdiction.submissionMethod : "PORTAL");
  const [confirmationRef, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [submittedOn, setSubmittedOn] = useState(format(new Date(), "yyyy-MM-dd"));
  const gaps = useMemo(() => checklist.filter((l) => l.requirement.required && l.requirement.documentType && !l.files.some((f) => picked.has(f.id))), [checklist, picked]);
  const missing = files.filter((f) => f.missing);
  const toggle = (id: string, on: boolean) => setPicked((s) => {
    const n = new Set(s);
    if (on) n.add(id);
    else n.delete(id);
    return n;
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Submit to the building department</DialogTitle>
        <DialogDescription>
          The documents you tick are frozen into one package exactly as they are now. After this they cannot be deleted, renamed or replaced — a correction is a new version in the next submission.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {gaps.length > 0 && (
          <Callout tone="warning" title="Not everything the checklist asks for is in the package">
            {gaps.map((g) => g.requirement.title).join(", ")}. You can still submit.
          </Callout>
        )}
        {missing.length > 0 && <p className="text-xs text-tone-danger-fg">{missing.length} document{missing.length === 1 ? " is" : "s are"} missing from the store and cannot be sent: {missing.map((f) => f.fileName).join(", ")}.</p>}
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
          {sendable.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">Upload the documents on the Documents tab first.</p>
          ) : (
            sendable.map((f) => (
              <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                <Checkbox checked={picked.has(f.id)} onCheckedChange={(v) => toggle(f.id, v === true)} />
                <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{permitDocLabel(f.permitDocType)}</span>
              </label>
            ))
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Sent by</Label>
            <Select items={METHOD_ITEMS} value={method} onValueChange={(v: string | null) => v && setMethod(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHOD_ITEMS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sub-day">Submitted on</Label>
            <Input id="sub-day" type="date" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sub-ref">Confirmation or application number</Label>
          <Input id="sub-ref" value={confirmationRef} onChange={(e) => setRef(e.target.value)} placeholder="What the portal or the counter gave you" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sub-notes">Notes</Label>
          <Textarea id="sub-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="brand"
          disabled={picked.size === 0 || write.isPending || !submittedOn}
          onClick={() =>
            write.mutate(
              { url: `/api/permits/${permit.id}/submissions`, method: "POST", body: { fileIds: [...picked], method, confirmationRef, notes, submittedAt: `${submittedOn}T12:00:00.000Z` } },
              {
                onSuccess: () => {
                  toast.success(`Package frozen with ${picked.size} document${picked.size === 1 ? "" : "s"} — the permit is now in review`);
                  onClose();
                },
              },
            )
          }
        >
          {write.isPending ? "Freezing…" : `Freeze ${picked.size} document${picked.size === 1 ? "" : "s"} as submitted`}
        </Button>
      </DialogFooter>
    </>
  );
}

function AnswerForm({ detail, cycle, onClose }: { detail: PermitDetail; cycle: PermitCycle; onClose: () => void }) {
  const write = usePermitWrite(detail.permit.id, detail.permit.jobId);
  const [outcome, setOutcome] = useState<string>("APPROVED");
  const [on, setOn] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reviewerName, setReviewer] = useState(cycle.reviewerName ?? "");
  const [permitNumber, setNumber] = useState(detail.permit.permitNumber ?? "");
  const [notes, setNotes] = useState("");
  return (
    <>
      <DialogHeader>
        <DialogTitle>The department&apos;s answer — cycle {cycle.number}</DialogTitle>
        <DialogDescription>The permit&apos;s status follows: approved → issued, corrections, denied, or withdrawn → preparing.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Answer</Label>
            <Select items={OUTCOME_ITEMS} value={outcome} onValueChange={(v: string | null) => v && setOutcome(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTCOME_ITEMS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ans-day">On</Label>
            <Input id="ans-day" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          </div>
        </div>
        {outcome === "APPROVED" && (
          <div className="space-y-1.5">
            <Label htmlFor="ans-number">Permit number issued</Label>
            <Input id="ans-number" value={permitNumber} onChange={(e) => setNumber(e.target.value)} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ans-reviewer">Reviewer</Label>
          <Input id="ans-reviewer" value={reviewerName} onChange={(e) => setReviewer(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ans-notes">Notes</Label>
          <Textarea id="ans-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={outcome === "CORRECTIONS" ? "What they asked for — upload the letter on the Documents tab as a correction notice" : undefined} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={write.isPending || !on}
          onClick={() =>
            write.mutate(
              { url: `/api/permit-cycles/${cycle.id}`, method: "PATCH", body: { outcome, outcomeAt: `${on}T12:00:00.000Z`, reviewerName, notes, permitNumber: outcome === "APPROVED" ? permitNumber : undefined } },
              {
                onSuccess: () => {
                  toast.success("Answer recorded");
                  onClose();
                },
              },
            )
          }
        >
          {write.isPending ? "Saving…" : "Record the answer"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ManualForm({ detail, onClose }: { detail: PermitDetail; onClose: () => void }) {
  const write = usePermitWrite(detail.permit.id, detail.permit.jobId);
  const [on, setOn] = useState(detail.permit.submittedDate?.slice(0, 10) ?? format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  return (
    <>
      <DialogHeader>
        <DialogTitle>Record a submission made elsewhere</DialogTitle>
        <DialogDescription>For a package sent before it was in the CRM. This opens the next review cycle without a frozen package.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="man-day">Submitted on</Label>
          <Input id="man-day" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="man-notes">Notes</Label>
          <Textarea id="man-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={write.isPending || !on} onClick={() => write.mutate({ url: `/api/permits/${detail.permit.id}/cycles`, method: "POST", body: { submittedAt: `${on}T12:00:00.000Z`, notes } }, { onSuccess: () => { toast.success("Submission recorded"); onClose(); } })}>
          {write.isPending ? "Saving…" : "Record it"}
        </Button>
      </DialogFooter>
    </>
  );
}
