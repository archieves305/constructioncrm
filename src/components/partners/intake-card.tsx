"use client";

import { useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ExternalLink, Link2, Mail, Plus, X } from "lucide-react";
import { Callout } from "@/components/shared/callout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BidFormDialog, type BidFormPrefill } from "./bid-form-dialog";
import { useBids, useIntakeAction, useIntakeEmail, useOrganizations, type IntakeItem, type ParsedDate } from "./use-partners";

const PLATFORM: Record<string, string> = { BUILDINGCONNECTED: "BuildingConnected", PROCORE: "Procore", PLANHUB: "PlanHub", SMARTBID: "SmartBid", CONSTRUCTCONNECT: "ConstructConnect", TEXTURA: "Textura", EMAIL: "Email", OTHER: "Other" };
const CHANNEL: Record<string, string> = { manual: "pasted", mailersend: "forwarded", outlook: "Outlook" };
const NONE = "__none";

const when = (d: ParsedDate | null) => (d ? `${format(new Date(d.at), d.dateOnly ? "EEE MMM d, yyyy" : "EEE MMM d, yyyy h:mm a")}${d.dateOnly ? " · no time given" : ""}` : null);
const local = (d: ParsedDate | null) => (d ? format(new Date(d.at), "yyyy-MM-dd'T'HH:mm") : "");
const day = (d: ParsedDate | null) => (d ? format(new Date(d.at), "yyyy-MM-dd") : "");

/** The bid form's fields as the email gave them; the person checks each one. */
export function prefillFromIntake(it: IntakeItem): BidFormPrefill {
  const p = it.parsed;
  return {
    organizationId: it.organizationId ?? "",
    contactId: it.contactId,
    projectName: p.projectName ?? "",
    scopeSummary: p.scope ?? "",
    tradeIds: it.suggestedTradeIds,
    address1: p.address?.address1 ?? "",
    city: p.address?.city ?? "",
    state: p.address?.state ?? "FL",
    zipCode: p.address?.zipCode ?? "",
    invitedAt: format(new Date(it.receivedAt), "yyyy-MM-dd"),
    bidDueAt: local(p.bidDue),
    siteWalkAt: local(p.siteWalk),
    preBidMeetingAt: local(p.preBidMeeting),
    rfiDueAt: day(p.rfiDue),
    platform: p.platform,
    platformUrl: p.platformUrl ?? "",
    platformRef: p.platformRef ?? "",
  };
}

function Field({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("break-words text-sm", !value && "text-muted-foreground")}>{value || "—"}{hint && <span className="block text-xs text-amber-700">{hint}</span>}</dd>
    </div>
  );
}

export function IntakeCard({ item, highlight }: { item: IntakeItem; highlight?: boolean }) {
  const p = item.parsed;
  const [creating, setCreating] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const email = useIntakeEmail(showEmail ? item.id : null);
  const open = item.status === "NEW";
  const setAccount = useIntakeAction((id) => `/api/partners/intake/${id}`, "Account set", "PATCH");
  const accounts = useOrganizations(new URLSearchParams({ pageSize: "500" }), open);
  const accountItems = [{ value: NONE, label: "No account yet" }, ...(accounts.data?.rows ?? []).map((o) => ({ value: o.id, label: o.name }))];
  const addr = p.address ? [p.address.address1, p.address.city, [p.address.state, p.address.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ") || p.address.text : null;

  return (
    <Card id={`intake-${item.id}`} className={cn(highlight && "ring-2 ring-brand")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="break-words font-medium">{p.originalSubject || item.subject}</p>
            <p className="text-xs text-muted-foreground">
              {p.originalFrom.name ?? p.originalFrom.email ?? item.forwardedBy}
              {p.originalFrom.email && p.originalFrom.email !== item.forwardedBy ? ` · ${CHANNEL[item.channel]} by ${item.forwardedBy}` : ` · ${CHANNEL[item.channel]}`} · {formatDistanceToNowStrict(new Date(item.receivedAt))} ago
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{PLATFORM[p.platform]}</Badge>
            {p.kind !== "INVITATION" && <Badge variant="secondary">{p.kind === "ADDENDUM" ? "Addendum" : "Update"}</Badge>}
          </div>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Project" value={p.projectName} hint={p.projectName && !p.found.includes("project") ? "taken from the subject line" : null} />
          <Field label="GC (as written)" value={p.gcName} />
          <Field label="Bid due" value={when(p.bidDue)} hint={p.bidDue?.dateOnly ? "5:00 PM is entered — check it" : null} />
          <Field label="Site" value={addr} />
          <Field label="Site walk" value={when(p.siteWalk)} />
          <Field label="Pre-bid meeting" value={when(p.preBidMeeting)} />
          <Field label="RFI deadline" value={p.rfiDue ? format(new Date(p.rfiDue.at), "EEE MMM d, yyyy") : null} />
          <Field label="Contact" value={[p.contactName, p.contactEmail, p.contactPhone].filter(Boolean).join(" · ")} />
          <div className="sm:col-span-2 lg:col-span-3"><Field label="Scope" value={p.scope} /></div>
          <Field label="Invitation link" value={p.platformUrl ? <a href={p.platformUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">Open <ExternalLink className="size-3" /></a> : null} />
        </dl>
        <p className="text-xs text-muted-foreground">Read from the email: {p.found.length ? p.found.join(", ") : "nothing reliable — fill the bid in by hand"}. Nothing here is a guess; a field the email does not state is left empty.</p>

        <div className="flex flex-wrap items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm">
          <span className="text-xs text-muted-foreground">Account</span>
          {open ? (
            <Select items={accountItems} value={item.organizationId ?? NONE} onValueChange={(v: string | null) => setAccount.mutate({ id: item.id, body: { organizationId: !v || v === NONE ? null : v } })}>
              <SelectTrigger className="h-8 w-64 max-w-full bg-white" aria-label="Account"><SelectValue /></SelectTrigger>
              <SelectContent>{accountItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <span className="font-medium">{item.organization?.name ?? "—"}</span>
          )}
          {item.matchedBy && <span className="text-xs text-muted-foreground">{item.matchedBy === "person" ? "picked by a person" : `matched by ${item.matchedBy}`}</span>}
          {!item.organizationId && open && <span className="text-xs text-amber-700">No account matched — pick one, or create the account first under GC Partnerships.</span>}
        </div>

        {item.existingBid && open && (
          <Callout tone="info">
            Looks like <Link href={`/leads/${item.existingBid.leadId}?tab=bid`} className="font-medium text-brand hover:underline">{item.existingBid.number}</Link> — {item.existingBid.projectName}
            {item.existingBid.bidDueAt ? `, due ${format(new Date(item.existingBid.bidDueAt), "MMM d, h:mm a")}` : ""}, {item.existingBid.addendaCount} addend{item.existingBid.addendaCount === 1 ? "um" : "a"} so far.
          </Callout>
        )}

        {!open && (
          <p className="text-sm">
            {item.status === "DISMISSED" ? `Dismissed${item.dismissReason ? `: ${item.dismissReason}` : ""}` : item.status === "CREATED" ? "Became " : "Filed on "}
            {item.bidInvitation && <Link href={`/leads/${item.bidInvitation.leadId}?tab=bid`} className="font-medium text-brand hover:underline">{item.bidInvitation.number}</Link>}
            {item.resolvedBy && <span className="text-muted-foreground"> · {item.resolvedBy.firstName} {item.resolvedBy.lastName}{item.resolvedAt ? `, ${format(new Date(item.resolvedAt), "MMM d")}` : ""}</span>}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {open && item.existingBid && <Button size="sm" variant="brand" onClick={() => setAttaching(true)}><Link2 className="mr-1.5 size-4" />File on {item.existingBid.number}</Button>}
          {open && <Button size="sm" variant={item.existingBid ? "outline" : "brand"} onClick={() => setCreating(true)}><Plus className="mr-1.5 size-4" />{item.existingBid ? "Create a new bid" : "Create bid"}</Button>}
          {open && !item.existingBid && item.organizationId && <Button size="sm" variant="outline" onClick={() => setAttaching(true)}><Link2 className="mr-1.5 size-4" />File on a bid…</Button>}
          {open && <Button size="sm" variant="ghost" onClick={() => setDismissing(true)}><X className="mr-1.5 size-4" />Dismiss</Button>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setShowEmail((s) => !s)}><Mail className="mr-1.5 size-4" />{showEmail ? "Hide the email" : "Show the email"}</Button>
        </div>
        {showEmail && (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-white p-3 text-xs">{email.isLoading ? "Loading…" : email.isError ? (email.error as Error).message : email.data?.body || "(empty)"}</pre>
        )}
      </CardContent>
      <BidFormDialog open={creating} onOpenChange={setCreating} organizationId={item.organizationId} prefill={prefillFromIntake(item)} intakeId={item.id} />
      {attaching && <AttachDialog item={item} onClose={() => setAttaching(false)} />}
      {dismissing && <DismissDialog item={item} onClose={() => setDismissing(false)} />}
    </Card>
  );
}

function AttachDialog({ item, onClose }: { item: IntakeItem; onClose: () => void }) {
  const p = item.parsed;
  const orgId = item.organizationId ?? undefined;
  const bids = useBids(new URLSearchParams({ pageSize: "200", ...(orgId ? { organizationId: orgId } : {}) }), Boolean(orgId));
  const [bidId, setBidId] = useState<string | null>(item.existingBid?.id ?? null);
  const [countAddendum, setCountAddendum] = useState(p.kind === "ADDENDUM");
  const chosen = (bids.data?.rows ?? []).find((b) => b.id === bidId) ?? null;
  const dueDiffers = Boolean(p.bidDue && (!chosen?.bidDueAt ? true : new Date(chosen.bidDueAt).getTime() !== new Date(p.bidDue.at).getTime()));
  const [updateBidDue, setUpdateBidDue] = useState(p.kind === "UPDATE" && Boolean(p.bidDue));
  const attach = useIntakeAction<{ number: string }>((id) => `/api/partners/intake/${id}/attach`, (r) => `Filed on ${r.number}`);
  const items = (bids.data?.rows ?? []).map((b) => ({ value: b.id, label: `${b.number} · ${b.projectName}` }));
  if (item.existingBid && !items.some((i) => i.value === item.existingBid!.id)) items.unshift({ value: item.existingBid.id, label: `${item.existingBid.number} · ${item.existingBid.projectName}` });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File the email on a bid</DialogTitle>
          <DialogDescription>The email goes on the bid&apos;s history and counts as a touch from the GC. Tick what it changes; nothing else moves.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Bid</Label>
            <Select items={items} value={bidId} onValueChange={(v: string | null) => setBidId(v)}>
              <SelectTrigger className="w-full" aria-label="Bid"><SelectValue placeholder={bids.isLoading ? "Loading…" : "Pick the bid"} /></SelectTrigger>
              <SelectContent>{items.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={countAddendum} onCheckedChange={(c) => setCountAddendum(Boolean(c))} />
            Count it as an addendum{chosen ? ` (makes ${chosen.addendaCount + 1})` : ""}
          </label>
          {p.bidDue && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={updateBidDue} onCheckedChange={(c) => setUpdateBidDue(Boolean(c))} />
              Set the due date to {when(p.bidDue)}{chosen && !dueDiffers ? " (already that)" : ""}
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!bidId || attach.isPending} onClick={() => attach.mutate({ id: item.id, body: { bidId, countAddendum, updateBidDue } }, { onSuccess: onClose })}>{attach.isPending ? "Filing…" : "File it"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DismissDialog({ item, onClose }: { item: IntakeItem; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const dismiss = useIntakeAction((id) => `/api/partners/intake/${id}/dismiss`, "Dismissed");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dismiss this email</DialogTitle>
          <DialogDescription>It leaves the queue and stays on record under Dismissed. No bid is created.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="dismiss-reason">Why (optional)</Label>
          <Input id="dismiss-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Not our trade, a newsletter, already logged…" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={dismiss.isPending} onClick={() => dismiss.mutate({ id: item.id, body: { reason } }, { onSuccess: onClose })}>Dismiss</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

