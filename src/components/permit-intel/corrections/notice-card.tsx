"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CheckCheck, FileText, Loader2, Mail, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/shared/callout";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { isClosedStatus } from "@/lib/permit-intel/corrections-plan";
import { toneClasses, type Tone } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import type { PermitFile, PermitParty } from "../types";
import { ItemForm, ItemRow } from "./item-row";
import type { CorrectionNotice, CorrectionsData } from "./types";
import { useCorrectionsWrite } from "./use-corrections";

const NOTICE_STATUS: Record<CorrectionNotice["status"], { label: string; tone: Tone }> = {
  EXTRACTING: { label: "Reading…", tone: "info" },
  REVIEW: { label: "To check", tone: "warning" },
  CONFIRMED: { label: "Confirmed", tone: "success" },
  FAILED: { label: "Not read", tone: "danger" },
};

const day = (iso: string | null) => (iso ? format(new Date(iso), "MMM d, yyyy") : "—");
const money = (n: number) => (n < 0.01 ? "under a cent" : `$${n.toFixed(2)}`);

/**
 * One correction notice. While the AI reads it the card waits; then its items
 * are a proposal a person checks, fixes and confirms; once confirmed they are
 * worked one by one, and the response letter is written from them.
 */
export function NoticeCard({
  notice: n,
  permitId,
  permissions,
  parties,
  files,
  onDraftEmail,
}: {
  notice: CorrectionNotice;
  permitId: string;
  permissions: CorrectionsData["permissions"];
  parties: PermitParty[];
  files: PermitFile[];
  onDraftEmail: (itemIds: string[]) => void;
}) {
  const write = useCorrectionsWrite(permitId);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [rereading, setRereading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showText, setShowText] = useState(false);
  const confirmed = n.status === "CONFIRMED";
  const s = NOTICE_STATUS[n.status];
  const closed = n.items.filter((i) => isClosedStatus(i.status)).length;
  const unsure = n.items.filter((i) => i.confidence != null && i.confidence < 0.7).length;
  const canRead = permissions.aiReady && (!!n.file || !!n.rawText);

  const letter = () =>
    write.mutate(
      { url: `/api/correction-notices/${n.id}/response-letter`, method: "POST" },
      { onSuccess: (f) => toast.success(`${(f as { fileName: string }).fileName} is on the permit's Documents tab`) },
    );

  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-1 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm">Corrections on review cycle {n.cycle.number}</CardTitle>
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses(s.tone).pill)}>
            {n.status === "EXTRACTING" && <Loader2 className="size-3 animate-spin" />}
            {s.label}
          </span>
          {confirmed && n.items.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {closed} of {n.items.length} resolved
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Received {day(n.receivedAt)}
          {n.reviewerName ? ` · reviewer ${n.reviewerName}` : ""}
          {" · "}
          {n.file ? (
            <a href={`/api/files/${n.file.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              {n.file.fileName}
            </a>
          ) : (
            <button type="button" className="text-primary hover:underline" onClick={() => setShowText((v) => !v)}>
              {showText ? "hide the pasted text" : "pasted text"}
            </button>
          )}
          {n.confirmedBy ? ` · confirmed by ${n.confirmedBy.firstName} ${n.confirmedBy.lastName}` : ""}
        </p>
        {confirmed && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Label htmlFor={`due-${n.id}`} className="text-xs">
              Corrected package due back
            </Label>
            <Input
              id={`due-${n.id}`}
              type="date"
              className="h-7 w-[150px] text-xs"
              disabled={!permissions.canEdit}
              defaultValue={n.responseDueAt ? format(new Date(n.responseDueAt), "yyyy-MM-dd") : ""}
              onBlur={(e) => {
                const v = e.target.value;
                const before = n.responseDueAt ? format(new Date(n.responseDueAt), "yyyy-MM-dd") : "";
                if (v !== before) write.mutate({ url: `/api/correction-notices/${n.id}`, method: "PATCH", body: { responseDueAt: v ? `${v}T12:00:00.000Z` : null } });
              }}
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {showText && n.rawText && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{n.rawText}</pre>}

        {n.status === "EXTRACTING" && (
          <Callout tone="info" icon={Loader2} title="The AI is reading the notice">
            This takes up to a minute or two for a long letter. You can leave the page; the items will be here.
          </Callout>
        )}
        {n.status === "FAILED" && (
          <Callout tone="danger" title="The notice was not read">
            {n.error ?? "Read it again, or type the items by hand."}
          </Callout>
        )}
        {n.summary && (
          <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
            <p className="mb-0.5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="size-3" /> The AI&apos;s reading{n.aiCall ? ` · ${money(n.aiCall.costUsd)}` : ""}
            </p>
            <p className="leading-snug">{n.summary}</p>
          </div>
        )}
        {n.status === "REVIEW" && (
          <Callout tone="warning" title={`Check the ${n.items.length} item${n.items.length === 1 ? "" : "s"} against the notice, then confirm`}>
            Each comment should be copied exactly. Fix who must act, delete anything that is not a correction, and add what was missed.{unsure ? ` ${unsure} item${unsure === 1 ? " is" : "s are"} marked “check this”.` : ""}
          </Callout>
        )}

        {n.items.length > 0 && (
          <ul className="divide-y rounded-md border">
            {n.items.map((i) => (
              <ItemRow
                key={i.id}
                item={i}
                permitId={permitId}
                confirmed={confirmed}
                canEdit={permissions.canEdit && n.status !== "EXTRACTING"}
                parties={parties}
                files={files}
                selected={picked.has(i.id)}
                onSelect={
                  confirmed && permissions.canEdit
                    ? (on) =>
                        setPicked((p) => {
                          const next = new Set(p);
                          if (on) next.add(i.id);
                          else next.delete(i.id);
                          return next;
                        })
                    : undefined
                }
              />
            ))}
          </ul>
        )}

        {permissions.canEdit && n.status !== "EXTRACTING" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add an item
            </Button>
            {!confirmed && canRead && (
              <Button size="sm" variant="ghost" onClick={() => setRereading(true)}>
                <RefreshCw className="size-3.5" /> Read again
              </Button>
            )}
            {!confirmed && (
              <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
                <Trash2 className="size-3.5" /> Remove the notice
              </Button>
            )}
            <span className="flex-1" />
            {confirmed ? (
              <>
                <Button size="sm" variant="outline" disabled={!picked.size} onClick={() => onDraftEmail([...picked])}>
                  <Mail className="size-3.5" /> Email about {picked.size ? `${picked.size} item${picked.size === 1 ? "" : "s"}` : "the picked items"}
                </Button>
                <Button size="sm" variant="outline" disabled={write.isPending} onClick={letter}>
                  <FileText className="size-3.5" /> Write the response letter
                </Button>
              </>
            ) : (
              permissions.canConfirm && (
                <Button size="sm" variant="brand" disabled={!n.items.length} onClick={() => setConfirming(true)}>
                  <CheckCheck className="size-3.5" /> Confirm {n.items.length} item{n.items.length === 1 ? "" : "s"}
                </Button>
              )
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">{adding && <ItemForm permitId={permitId} noticeId={n.id} parties={parties} onClose={() => setAdding(false)} />}</DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Confirm ${n.items.length} correction${n.items.length === 1 ? "" : "s"}?`}
        description={`Each becomes a task, the permit moves to Corrections${n.cycle.outcome === "PENDING" ? ` and review cycle ${n.cycle.number} is recorded as answered with corrections` : ""}, and the corrected package gets a due date.`}
        confirmLabel="Confirm"
        pending={write.isPending}
        onConfirm={() => write.mutate({ url: `/api/correction-notices/${n.id}/confirm`, method: "POST" }, { onSuccess: () => setConfirming(false) })}
      />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        tone="warning"
        title="Remove this notice?"
        description="Its proposed items go with it. The uploaded letter stays on the permit's Documents tab."
        confirmLabel="Remove"
        pending={write.isPending}
        onConfirm={() => write.mutate({ url: `/api/correction-notices/${n.id}`, method: "DELETE" }, { onSuccess: () => setRemoving(false) })}
      />
      <ConfirmDialog
        open={rereading}
        onOpenChange={setRereading}
        title="Read the notice again?"
        description={n.items.length ? "The proposed items are replaced by the new reading, with any edits you made to them." : "The AI reads the notice again."}
        confirmLabel="Read again"
        pending={write.isPending}
        onConfirm={() => write.mutate({ url: `/api/correction-notices/${n.id}/reread`, method: "POST" }, { onSuccess: () => setRereading(false) })}
      />
    </Card>
  );
}
