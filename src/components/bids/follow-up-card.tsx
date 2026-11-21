"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock, Check, Copy, Mail, MessageSquareReply, Pause, Phone, Play, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Callout } from "@/components/shared/callout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";

type Kind = "CALL" | "EMAIL" | "REVIEW" | "URGENT_CALL";
type Person = { id: string; name: string; title: string | null; phone: string | null; mobile: string | null; email: string | null };
type Message = { id: string; status: string; subject: string; body: string; toEmails: string[]; ccEmails: string[]; sentAt: string | null; error: string | null; createdAt: string; canSend: boolean };
export type FollowUps = {
  open: boolean;
  onHold: boolean;
  anchor: { day: string; source: string; label: string } | null;
  requestedDay: string | null;
  pause: { until: string; scope: string | null; reason: string | null } | null;
  next: { at: string; label: string | null } | null;
  recipient: { id: string; name: string; email: string | null } | null;
  contacts: Person[];
  upcoming: { slotKey: string; kind: Kind; dueAt: string; dueDay: string; why: string }[];
  actions: { id: string; slotKey: string; kind: Kind; reason: string; status: string; dueAt: string; taskId: string | null; outcome: string | null }[];
  messages: Message[];
  sendFromCrm: boolean;
  canManage: boolean;
};

const KIND_LABEL: Record<Kind, string> = { CALL: "Call", EMAIL: "Email", REVIEW: "Review", URGENT_CALL: "Urgent call" };
const STATUS_TONE: Record<string, string> = { RAISED: "bg-tone-info-soft text-tone-info-fg", DONE: "bg-tone-success-soft text-tone-success-fg", CANCELLED: "bg-surface-muted text-muted-foreground" };
const dayLabel = (k: string) => format(new Date(`${k}T12:00:00`), "EEE MMM d");
const key = (bidId: string) => ["bids", "follow-ups", bidId];

function usePost(bidId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => fetchJson<FollowUps>(`/api/bids/${bidId}/follow-ups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: (data) => {
      qc.setQueryData(key(bidId), (prev: FollowUps | undefined) => ({ ...data, canManage: prev?.canManage ?? true }));
      qc.invalidateQueries({ queryKey: ["partners"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * After a bid goes out: when we follow up with this GC and why, what is due,
 * the drafted emails, and the three things a person logs — a call, a reply,
 * a date or a pause. The schedule is the cadence (`lib/bids/cadence.ts`).
 */
export function FollowUpCard({ bidId }: { bidId: string }) {
  const q = useQuery<FollowUps>({ queryKey: key(bidId), queryFn: () => fetchJson(`/api/bids/${bidId}/follow-ups`), retry: retryServerErrors });
  const [dialog, setDialog] = useState<"call" | "reply" | "pace" | null>(null);
  if (!q.data) return null;
  const f = q.data;
  if (!f.anchor && !f.actions.length && !f.messages.length) return null;
  const drafts = f.messages.filter((m) => m.status !== "SENT" && m.status !== "CANCELLED");
  const sent = f.messages.filter((m) => m.status === "SENT");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><CalendarClock className="size-4" />Follow-up</CardTitle>
        {f.canManage && f.open && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDialog("call")}><Phone className="size-3.5" /> Log call</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDialog("reply")}><MessageSquareReply className="size-3.5" /> Log reply</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDialog("pace")}><Pause className="size-3.5" /> Next date / pause</Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!f.open && <p className="text-xs text-muted-foreground">The bid is closed; nothing more is scheduled.</p>}
        {f.onHold && <Callout tone="warning">The project is on hold, so no follow-ups are scheduled until it reopens.</Callout>}
        {f.open && f.anchor && (
          <p className="text-xs text-muted-foreground">
            Counted from <span className="font-medium text-foreground">{dayLabel(f.anchor.day)}</span>, {f.anchor.label}.
            {f.requestedDay && <> The GC asked us to follow up on <span className="font-medium text-foreground">{dayLabel(f.requestedDay)}</span>.</>}
          </p>
        )}
        {f.pause && (
          <Callout tone="info" title={`${f.pause.scope === "all" ? "Follow-ups" : "Emails"} paused until ${dayLabel(f.pause.until)}`} action={f.canManage ? <ResumeButton bidId={bidId} /> : undefined}>
            {f.pause.reason}
          </Callout>
        )}
        {f.next && f.open && (
          <div className="rounded-md border bg-surface-subtle px-3 py-2">
            <div className="text-2xs uppercase tracking-wide text-muted-foreground">Next</div>
            <div className="font-medium">{f.next.label}</div>
            <div className="text-xs text-muted-foreground">{format(new Date(f.next.at), "EEE MMM d, h:mm a")}</div>
          </div>
        )}
        {f.open && f.upcoming.length > 0 && (
          <div>
            <div className="mb-1 text-2xs uppercase tracking-wide text-muted-foreground">Coming up</div>
            <ul className="space-y-1">
              {f.upcoming.map((u) => (
                <li key={u.slotKey} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="w-24 shrink-0 tabular-nums">{dayLabel(u.dueDay)}</span>
                  <span className="font-medium">{KIND_LABEL[u.kind]}</span>
                  <span className="text-muted-foreground">{u.why}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {drafts.map((m) => <DraftEditor key={m.id} bidId={bidId} m={m} sendFromCrm={f.sendFromCrm} canManage={f.canManage} />)}
        {f.actions.length > 0 && (
          <div>
            <div className="mb-1 text-2xs uppercase tracking-wide text-muted-foreground">Raised</div>
            <ul className="space-y-1">
              {f.actions.slice(0, 8).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 tabular-nums">{format(new Date(a.dueAt), "EEE MMM d")}</span>
                  <span className="font-medium">{KIND_LABEL[a.kind]}</span>
                  <Badge className={`h-5 border-0 px-1.5 text-3xs ${STATUS_TONE[a.status] ?? ""}`}>{a.status === "RAISED" ? "open" : a.status.toLowerCase()}</Badge>
                  {a.outcome && <span className="truncate text-muted-foreground">{a.outcome}</span>}
                  {a.taskId && a.status === "RAISED" && <Link href={`/tasks?task=${a.taskId}`} className="text-tone-info-fg underline">task</Link>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {sent.length > 0 && <p className="text-xs text-muted-foreground">{sent.length} follow-up email{sent.length === 1 ? "" : "s"} sent in the last 90 days.</p>}
      </CardContent>
      {dialog === "call" && <LogDialog bidId={bidId} mode="call" contacts={f.contacts} onClose={() => setDialog(null)} />}
      {dialog === "reply" && <LogDialog bidId={bidId} mode="reply" contacts={f.contacts} onClose={() => setDialog(null)} />}
      {dialog === "pace" && <PaceDialog bidId={bidId} f={f} onClose={() => setDialog(null)} />}
    </Card>
  );
}

function ResumeButton({ bidId }: { bidId: string }) {
  const post = usePost(bidId);
  return (
    <Button size="sm" variant="outline" className="h-7 bg-white text-xs" loading={post.isPending} onClick={() => post.mutate({ type: "resume" }, { onSuccess: () => toast.success("Follow-ups resumed") })}>
      <Play className="size-3.5" /> Resume
    </Button>
  );
}

function DraftEditor({ bidId, m, sendFromCrm, canManage }: { bidId: string; m: Message; sendFromCrm: boolean; canManage: boolean }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const [to, setTo] = useState(m.toEmails.join(", "));
  const editable = canManage && m.canSend;
  const dirty = subject !== m.subject || body !== m.body || to !== m.toEmails.join(", ");
  const call = useMutation({
    mutationFn: async (action: "save" | "send" | "mark_sent" | "discard") => {
      const toEmails = to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      if (action === "save" || dirty) await fetchJson(`/api/bid-messages/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body, toEmails }) });
      if (action !== "save") await fetchJson(`/api/bid-messages/${m.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "discard" ? { action, reason: "not needed" } : { action }) });
      return action;
    },
    onSuccess: (action) => {
      toast.success(action === "save" ? "Draft saved" : action === "discard" ? "Draft discarded" : action === "send" ? "Email sent" : "Recorded as sent");
      qc.invalidateQueries({ queryKey: key(bidId) });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      toast.success("Copied — paste it into Outlook");
    } catch {
      toast.error("Could not copy; select the text instead");
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Mail className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium">Drafted follow-up email</span>
        {m.status === "FAILED" && <Badge className="h-5 border-0 bg-tone-danger-soft px-1.5 text-3xs text-tone-danger-fg">not sent</Badge>}
      </div>
      {m.error && <p className="text-xs text-tone-danger-fg">{m.error}</p>}
      <Field label="To" id={`to-${m.id}`} labelClassName="text-xs">
        <Input id={`to-${m.id}`} value={to} disabled={!editable} onChange={(e) => setTo(e.target.value)} placeholder="name@gc.com" />
      </Field>
      <Field label="Subject" id={`subj-${m.id}`} labelClassName="text-xs">
        <Input id={`subj-${m.id}`} value={subject} disabled={!editable} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label="Message" id={`body-${m.id}`} labelClassName="text-xs">
        <Textarea id={`body-${m.id}`} rows={9} value={body} disabled={!editable} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {m.ccEmails.length > 0 && <p className="text-2xs text-muted-foreground">A copy goes to {m.ccEmails.join(", ")}; replies come back to the sender.</p>}
      {editable && (
        <div className="flex flex-wrap gap-1.5">
          {sendFromCrm ? (
            <Button size="sm" className="h-7 text-xs" loading={call.isPending && call.variables === "send"} onClick={() => call.mutate("send")}><Send className="size-3.5" /> Send</Button>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={copy}><Copy className="size-3.5" /> Copy for Outlook</Button>
          )}
          <Button size="sm" variant={sendFromCrm ? "outline" : "default"} className="h-7 text-xs" loading={call.isPending && call.variables === "mark_sent"} onClick={() => call.mutate("mark_sent")}><Check className="size-3.5" /> Mark sent</Button>
          {dirty && <Button size="sm" variant="ghost" className="h-7 text-xs" loading={call.isPending && call.variables === "save"} onClick={() => call.mutate("save")}>Save draft</Button>}
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" loading={call.isPending && call.variables === "discard"} onClick={() => call.mutate("discard")}><Trash2 className="size-3.5" /> Discard</Button>
        </div>
      )}
      {!sendFromCrm && editable && <p className="text-2xs text-muted-foreground">Sending from the CRM is off: copy it into Outlook, send it there, then press Mark sent.</p>}
    </div>
  );
}

const OUTCOMES = [
  { value: "SPOKE", label: "Spoke with them" },
  { value: "LEFT_MESSAGE", label: "Left a message" },
  { value: "NO_ANSWER", label: "No answer" },
];

function LogDialog({ bidId, mode, contacts, onClose }: { bidId: string; mode: "call" | "reply"; contacts: Person[]; onClose: () => void }) {
  const post = usePost(bidId);
  const [contactId, setContactId] = useState<string>(contacts[0]?.id ?? "");
  const [outcome, setOutcome] = useState("SPOKE");
  const [summary, setSummary] = useState("");
  const [nextDay, setNextDay] = useState("");
  const people = contacts.map((c) => ({ value: c.id, label: `${c.name}${c.title ? ` — ${c.title}` : ""}` }));
  const submit = () =>
    post.mutate(
      { type: mode, contactId: contactId || null, summary, nextDay: nextDay || null, ...(mode === "call" ? { outcome } : {}) },
      { onSuccess: () => { toast.success(mode === "call" ? "Call logged" : "Reply logged — follow-up emails paused"); onClose(); } },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{mode === "call" ? "Log a call" : "Log the GC's reply"}</DialogTitle>
          <DialogDescription>
            {mode === "call"
              ? "Closes the call that was due. If they named a day to follow up, it becomes the next follow-up."
              : "Their reply is the contact: drafted emails are withdrawn and emails pause until the day they named (or 15 business days). Calls carry on."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {people.length > 0 && (
            <Field label="Who" id="fu-contact" labelClassName="text-xs">
              <Select items={people} value={contactId} onValueChange={(v: string | null) => setContactId(v ?? "")}>
                <SelectTrigger id="fu-contact" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{people.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          {mode === "call" && (
            <Field label="How it went" id="fu-outcome" labelClassName="text-xs">
              <Select items={OUTCOMES} value={outcome} onValueChange={(v: string | null) => v && setOutcome(v)}>
                <SelectTrigger id="fu-outcome" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          <Field label={mode === "call" ? "What they said" : "What they wrote"} id="fu-summary" labelClassName="text-xs">
            <Textarea id="fu-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={mode === "call" ? "e.g. Owner awards in two weeks; they will pick subs right after" : "Paste or sum up their reply"} />
          </Field>
          <Field label="Follow up again on (optional)" id="fu-next" labelClassName="text-xs" help="A day the GC named. Leave blank to keep the schedule.">
            <Input id="fu-next" type="date" value={nextDay} onChange={(e) => setNextDay(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!summary.trim()} loading={post.isPending} onClick={submit}>{mode === "call" ? "Log call" : "Log reply"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SCOPES = [
  { value: "email", label: "Emails only (calls carry on)" },
  { value: "all", label: "Everything" },
];

function PaceDialog({ bidId, f, onClose }: { bidId: string; f: FollowUps; onClose: () => void }) {
  const post = usePost(bidId);
  const [day, setDay] = useState(f.requestedDay ?? "");
  const [until, setUntil] = useState("");
  const [scope, setScope] = useState("all");
  const [reason, setReason] = useState("");
  const [anchor, setAnchor] = useState(f.anchor?.source === "set" ? f.anchor.day : "");
  const done = (msg: string) => ({ onSuccess: () => { toast.success(msg); onClose(); } });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Next date or pause</DialogTitle>
          <DialogDescription>Set the day the GC asked us to follow up, pause the follow-ups, or change the date the schedule counts from.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <section className="space-y-2">
            <Field label="The GC asked us to follow up on" id="pace-day" labelClassName="text-xs" help="Follow-ups before this day are skipped; a call is scheduled that morning.">
              <Input id="pace-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <div className="flex gap-1.5">
              <Button size="sm" disabled={!day} loading={post.isPending} onClick={() => post.mutate({ type: "set_date", day }, done("Next follow-up set"))}>Set date</Button>
              {f.requestedDay && <Button size="sm" variant="ghost" onClick={() => post.mutate({ type: "clear_date" }, done("Back to the regular schedule"))}>Clear it</Button>}
            </div>
          </section>
          <section className="space-y-2 border-t pt-3">
            <Field label="Pause until" id="pace-until" labelClassName="text-xs">
              <Input id="pace-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </Field>
            <Field label="Pause" id="pace-scope" labelClassName="text-xs">
              <Select items={SCOPES} value={scope} onValueChange={(v: string | null) => v && setScope(v)}>
                <SelectTrigger id="pace-scope" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{SCOPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Why" id="pace-reason" labelClassName="text-xs">
              <Input id="pace-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner re-scoping; GC will call us in January" />
            </Field>
            <Button size="sm" variant="outline" disabled={!until || reason.trim().length < 3} loading={post.isPending} onClick={() => post.mutate({ type: "pause", until, scope, reason }, done("Follow-ups paused"))}>Pause</Button>
          </section>
          <section className="space-y-2 border-t pt-3">
            <Field label="Count the schedule from" id="pace-anchor" labelClassName="text-xs" help={`Now: ${f.anchor ? `${dayLabel(f.anchor.day)}, ${f.anchor.label}` : "not set"}.`}>
              <Input id="pace-anchor" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
            </Field>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" disabled={!anchor} loading={post.isPending} onClick={() => post.mutate({ type: "set_anchor", day: anchor }, done("Schedule moved"))}>Use this date</Button>
              {f.anchor?.source === "set" && <Button size="sm" variant="ghost" onClick={() => post.mutate({ type: "set_anchor", day: null }, done("Back to the bid deadline"))}>Use the deadline</Button>}
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
