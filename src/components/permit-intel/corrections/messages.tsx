"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Mail, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatFileSize } from "@/lib/files/limits";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { PARTY_ROLE_LABEL, type PermitFile, type PermitParty } from "../types";
import type { CorrectionItem, CorrectionsData, PermitMessage } from "./types";
import { useCorrectionsWrite } from "./use-corrections";
import { itemNumber } from "./item-row";

const splitEmails = (v: string) =>
  v
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Start an email about some correction items: to which party, and whether the AI writes the first draft. */
export function DraftForm({
  permitId,
  items,
  parties,
  aiReady,
  onCreated,
  onClose,
}: {
  permitId: string;
  items: CorrectionItem[];
  parties: PermitParty[];
  aiReady: boolean;
  onCreated: (m: PermitMessage) => void;
  onClose: () => void;
}) {
  const write = useCorrectionsWrite<PermitMessage>(permitId);
  // the party most of the picked items name
  const counts = new Map<string, number>();
  for (const i of items) if (i.partyId) counts.set(i.partyId, (counts.get(i.partyId) ?? 0) + 1);
  const likely = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const [partyId, setPartyId] = useState(likely);
  const [ai, setAi] = useState(aiReady && items.length > 0);
  const partyItems = [{ value: "", label: "Someone not on the permit" }, ...parties.map((p) => ({ value: p.id, label: `${p.name} — ${PARTY_ROLE_LABEL[p.role] ?? p.role}${p.email ? "" : " (no email on file)"}` }))];

  const create = () =>
    write.mutate(
      { url: `/api/permits/${permitId}/messages`, method: "POST", body: { partyId: partyId || null, correctionItemIds: items.map((i) => i.id), ai, purpose: items.length ? "correction_request" : "other" } },
      { onSuccess: (m) => onCreated(m) },
    );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Email about {items.length ? `${items.length} correction${items.length === 1 ? "" : "s"}` : "this permit"}</DialogTitle>
        <DialogDescription>You get a draft to read and change. Nothing is sent until you press Send.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {items.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
            {items.map((i) => (
              <li key={i.id} className="truncate">
                <span className="font-semibold">{itemNumber(i)}</span> {i.text}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-1">
          <Label htmlFor="draft-party">To</Label>
          <Select items={partyItems} value={partyId} onValueChange={(v: string | null) => v !== null && setPartyId(v)}>
            <SelectTrigger id="draft-party" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {partyItems.map((p) => (
                <SelectItem key={p.value || "none"} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {items.length > 0 && (
          <label className={cn("flex items-start gap-2 text-sm", !aiReady && "opacity-60")}>
            <Checkbox checked={ai} disabled={!aiReady} onCheckedChange={(v) => setAi(v === true)} className="mt-0.5" />
            <span>
              Let the AI write the first draft
              <span className="block text-xs text-muted-foreground">{aiReady ? "It quotes each comment and asks for what it needs, by the due date." : "AI is not set up on this server."}</span>
            </span>
          </label>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={write.isPending}>
          Cancel
        </Button>
        <Button variant="brand" onClick={create} disabled={write.isPending}>
          {write.isPending ? (ai ? "Writing…" : "Creating…") : ai ? <><Sparkles className="size-3.5" /> Write the draft</> : "Start a blank draft"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Read and change a draft; send it. A sent email is shown as it went. */
export function MessageEditor({
  message: m,
  permitId,
  files,
  items,
  canSend,
  onClose,
}: {
  message: PermitMessage;
  permitId: string;
  files: PermitFile[];
  items: CorrectionItem[];
  canSend: boolean;
  onClose: () => void;
}) {
  const write = useCorrectionsWrite<PermitMessage>(permitId);
  const draft = m.status === "DRAFT";
  const [to, setTo] = useState(m.toEmails.join(", "));
  const [cc, setCc] = useState(m.ccEmails.join(", "));
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const [attach, setAttach] = useState<Set<string>>(new Set(m.attachmentFileIds));
  const [sending, setSending] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // revised files linked to the email's items come first in the list
  const linked = new Set(items.filter((i) => m.correctionItemIds.includes(i.id)).flatMap((i) => i.files.map((f) => f.file.id)));
  const choices = [...files].filter((f) => !f.missing).sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)));
  const attachedBytes = files.filter((f) => attach.has(f.id)).reduce((s, f) => s + f.fileSize, 0);

  const payload = () => ({ toEmails: splitEmails(to), ccEmails: splitEmails(cc), subject, body, attachmentFileIds: [...attach] });
  const save = (then?: () => void) => write.mutate({ url: `/api/permit-messages/${m.id}`, method: "PATCH", body: payload() }, { onSuccess: () => (then ? then() : toast.success("Draft saved")) });
  const send = () =>
    write.mutate(
      { url: `/api/permit-messages/${m.id}`, method: "PATCH", body: payload() },
      {
        onSuccess: () =>
          write.mutate(
            { url: `/api/permit-messages/${m.id}/send`, method: "POST" },
            {
              onSuccess: () => {
                toast.success("Email sent");
                setSending(false);
                onClose();
              },
            },
          ),
      },
    );

  if (!draft) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="pr-6">{m.subject}</DialogTitle>
          <DialogDescription>
            Sent {m.sentAt ? format(new Date(m.sentAt), "MMM d, yyyy h:mm a") : ""}
            {m.sentBy ? ` by ${m.sentBy.firstName} ${m.sentBy.lastName}` : ""} to {m.toEmails.join(", ")}
            {m.ccEmails.length ? ` · cc ${m.ccEmails.join(", ")}` : ""}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-sm">{m.body}</pre>
        {m.attachmentFileIds.length > 0 && <p className="text-xs text-muted-foreground">Attached: {files.filter((f) => m.attachmentFileIds.includes(f.id)).map((f) => f.fileName).join(", ") || `${m.attachmentFileIds.length} file(s)`}</p>}
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Email draft</DialogTitle>
        <DialogDescription>{m.aiCallId ? "Written by the AI from the corrections — read it before sending." : "Write the email, then send it."} Replies come to you.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="msg-to">To</Label>
          <Input id="msg-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="msg-cc">Cc</Label>
          <Input id="msg-cc" value={cc} onChange={(e) => setCc(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="msg-subject">Subject</Label>
          <Input id="msg-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="msg-body">Message</Label>
          <Textarea id="msg-body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        {choices.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium">Attach permit documents</p>
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
              {choices.map((f) => (
                <li key={f.id}>
                  <label className="flex min-w-0 items-center gap-2 text-xs">
                    <Checkbox
                      checked={attach.has(f.id)}
                      onCheckedChange={(v) =>
                        setAttach((s) => {
                          const next = new Set(s);
                          if (v === true) next.add(f.id);
                          else next.delete(f.id);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {linked.has(f.id) ? "revised · " : ""}
                      {formatFileSize(f.fileSize)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {attachedBytes > 20 * 1024 * 1024 && <Callout tone="warning">The attachments come to {formatFileSize(attachedBytes)}; an email takes up to 20 MB.</Callout>}
          </div>
        )}
      </div>
      <DialogFooter className="flex-wrap gap-2">
        <Button variant="ghost" onClick={() => setDiscarding(true)} disabled={write.isPending}>
          Discard
        </Button>
        <span className="flex-1" />
        <Button variant="outline" onClick={() => save()} disabled={write.isPending}>
          Save draft
        </Button>
        {canSend && (
          <Button variant="brand" onClick={() => setSending(true)} disabled={write.isPending || !splitEmails(to).length || !subject.trim() || !body.trim()}>
            <Send className="size-3.5" /> Send
          </Button>
        )}
      </DialogFooter>
      <ConfirmDialog
        open={sending}
        onOpenChange={setSending}
        title="Send this email?"
        description={`To ${splitEmails(to).join(", ")}${splitEmails(cc).length ? `, cc ${splitEmails(cc).join(", ")}` : ""}${attach.size ? `, with ${attach.size} attachment${attach.size === 1 ? "" : "s"}` : ""}. It is recorded on the job's correspondence.`}
        confirmLabel="Send"
        pending={write.isPending}
        onConfirm={send}
      />
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        tone="warning"
        title="Discard this draft?"
        confirmLabel="Discard"
        pending={write.isPending}
        onConfirm={() => write.mutate({ url: `/api/permit-messages/${m.id}`, method: "DELETE" }, { onSuccess: onClose })}
      />
    </>
  );
}

/** The permit's emails: drafts first, then what was sent. */
export function MessagesCard({ data, onOpen, onNew }: { data: CorrectionsData; onOpen: (m: PermitMessage) => void; onNew: () => void }) {
  const drafts = data.messages.filter((m) => m.status === "DRAFT");
  const sent = data.messages.filter((m) => m.status === "SENT");
  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm">Emails ({data.messages.length})</CardTitle>
        {data.permissions.canEdit && (
          <Button size="sm" variant="outline" onClick={onNew}>
            <Mail className="size-3.5" /> New email
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {data.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No emails yet. Pick corrections above and choose “Email about…” to ask an architect, engineer or owner for what they must revise.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {[...drafts, ...sent].map((m) => (
              <li key={m.id}>
                <button type="button" className="flex w-full min-w-0 flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-muted/50" onClick={() => onOpen(m)}>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses(m.status === "DRAFT" ? "warning" : "success").pill)}>{m.status === "DRAFT" ? "Draft" : "Sent"}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{m.subject}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {m.party?.name ?? m.toEmails[0] ?? "no recipient"} · {format(new Date(m.sentAt ?? m.createdAt), "MMM d")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
