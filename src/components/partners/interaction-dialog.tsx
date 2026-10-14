"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";
import { useInvalidatePartners, usePartnerOptions, type Contact, type Interaction, type InteractionDirection, type InteractionKind, type InteractionOutcome } from "./use-partners";

const NONE = "__none";

type Values = {
  contactId: string | null;
  kind: InteractionKind;
  direction: InteractionDirection;
  outcome: InteractionOutcome | null;
  occurredAt: string; // datetime-local
  summary: string;
  followUp: boolean;
  followUpTitle: string;
  followUpDay: string;
  followUpAssignee: string | null;
};

const localNow = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");

/** Outcomes that make sense for a kind; the first is the default. */
const OUTCOMES_FOR: Record<InteractionKind, InteractionOutcome[]> = {
  CALL: ["SPOKE", "NO_ANSWER", "LEFT_MESSAGE"],
  EMAIL: ["SENT", "REPLIED"],
  LINKEDIN: ["SENT", "REPLIED"],
  MEETING: ["MEETING_HELD"],
  SITE_VISIT: ["MEETING_HELD"],
  LUNCH: ["MEETING_HELD"],
  INTRO: ["SPOKE", "SENT", "REPLIED"],
  PREQUAL_SUBMISSION: ["SENT", "NOT_APPLICABLE"],
  BID_DISCUSSION: ["SPOKE", "MEETING_HELD", "SENT", "REPLIED"],
  DOC_SENT: ["SENT", "NOT_APPLICABLE"],
  NOTE: ["NOT_APPLICABLE"],
  OTHER: ["NOT_APPLICABLE", "SPOKE", "SENT", "REPLIED"],
};

/**
 * The daily input of the module, one screen that works with a thumb: what
 * kind of touch, with whom, how it went, and (optionally) the follow-up task.
 * Logging it moves the account's last-contact date and settles its open
 * follow-ups.
 */
export function InteractionDialog({
  open,
  onOpenChange,
  organizationId,
  organizationName,
  contacts,
  ownerUserId,
  interaction,
  leadId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationName: string;
  contacts: Pick<Contact, "id" | "firstName" | "lastName" | "title" | "isPrimary" | "isActive">[];
  ownerUserId: string | null;
  /** Editing an existing row. */
  interaction?: Interaction | null;
  /** When the touch is about a bid package. */
  leadId?: string | null;
  onSaved?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {open && (
          <InteractionForm organizationId={organizationId} organizationName={organizationName} contacts={contacts} ownerUserId={ownerUserId} interaction={interaction ?? null} leadId={leadId ?? null} onSaved={onSaved} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InteractionForm({ organizationId, organizationName, contacts, ownerUserId, interaction, leadId, onSaved, onClose }: { organizationId: string; organizationName: string; contacts: Pick<Contact, "id" | "firstName" | "lastName" | "title" | "isPrimary" | "isActive">[]; ownerUserId: string | null; interaction: Interaction | null; leadId: string | null; onSaved?: () => void; onClose: () => void }) {
  const invalidate = useInvalidatePartners();
  const { data: options } = usePartnerOptions();
  const primary = contacts.find((c) => c.isPrimary && c.isActive) ?? null;
  const [form, setForm] = useState<Values>(
    interaction
      ? { contactId: interaction.contactId, kind: interaction.kind, direction: interaction.direction, outcome: interaction.outcome, occurredAt: format(new Date(interaction.occurredAt), "yyyy-MM-dd'T'HH:mm"), summary: interaction.summary, followUp: false, followUpTitle: "", followUpDay: "", followUpAssignee: null }
      : { contactId: primary?.id ?? null, kind: "CALL", direction: "OUTBOUND", outcome: "SPOKE", occurredAt: localNow(), summary: "", followUp: false, followUpTitle: `Follow up with ${organizationName}`, followUpDay: format(addDays(new Date(), 7), "yyyy-MM-dd"), followUpAssignee: ownerUserId },
  );
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setKind = (kind: InteractionKind) => setForm((f) => ({ ...f, kind, outcome: OUTCOMES_FOR[kind].includes(f.outcome as InteractionOutcome) ? f.outcome : OUTCOMES_FOR[kind][0]! }));
  const outcomeLabel = (o: InteractionOutcome) => options?.outcomes.find((x) => x.value === o)?.label ?? o;

  const save = useMutation({
    mutationFn: () => {
      const occurredAt = new Date(form.occurredAt).toISOString();
      if (interaction) {
        return fetchJson(`/api/interactions/${interaction.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId: form.contactId, kind: form.kind, direction: form.direction, outcome: form.outcome, occurredAt, summary: form.summary }) });
      }
      return fetchJson(`/api/partners/${organizationId}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: form.contactId,
          leadId,
          kind: form.kind,
          direction: form.direction,
          outcome: form.outcome,
          occurredAt,
          summary: form.summary,
          followUp: form.followUp ? { title: form.followUpTitle, dueDay: form.followUpDay, assignedUserId: form.followUpAssignee } : null,
        }),
      });
    },
    onSuccess: () => {
      invalidate();
      toast.success(interaction ? "Interaction updated" : form.followUp ? "Logged, follow-up task created" : "Logged");
      onSaved?.();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeContacts = contacts.filter((c) => c.isActive || c.id === form.contactId);
  const contactItems = [{ value: NONE, label: "Nobody in particular" }, ...activeContacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}${c.title ? ` · ${c.title}` : ""}` }))];
  const presets = [
    { label: "Tomorrow", days: 1 },
    { label: "3 days", days: 3 },
    { label: "1 week", days: 7 },
    { label: "2 weeks", days: 14 },
  ];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.outcome) return toast.error("How did it go?");
        if (!form.summary.trim()) return toast.error("Say what happened");
        if (form.followUp && !form.followUpTitle.trim()) return toast.error("Name the follow-up");
        save.mutate();
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>{interaction ? "Edit interaction" : `Log an interaction · ${organizationName}`}</DialogTitle>
        <DialogDescription>{interaction ? "Correct what was logged." : "What happened, with whom, and what comes next."}</DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label>What</Label>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind">
          {(options?.interactionKinds ?? []).map((k) => (
            <Button key={k.value} type="button" size="sm" variant={form.kind === k.value ? "default" : "outline"} className="h-8 rounded-full text-xs" role="radio" aria-checked={form.kind === k.value} onClick={() => setKind(k.value)}>
              {k.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>With</Label>
          <Select items={contactItems} value={form.contactId ?? NONE} onValueChange={(v: string | null) => set("contactId", !v || v === NONE ? null : v)}>
            <SelectTrigger className="w-full" aria-label="Contact"><SelectValue /></SelectTrigger>
            <SelectContent>{contactItems.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Direction</Label>
          <div>
            <SegmentedControl<InteractionDirection> ariaLabel="Direction" value={form.direction} onValueChange={(v) => set("direction", v)} options={[{ value: "OUTBOUND", label: "We reached out" }, { value: "INBOUND", label: "They reached out" }]} />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>How did it go?</Label>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Outcome">
          {OUTCOMES_FOR[form.kind].map((o) => (
            <Button key={o} type="button" size="sm" variant={form.outcome === o ? "default" : "outline"} className="h-8 rounded-full text-xs" role="radio" aria-checked={form.outcome === o} onClick={() => set("outcome", o)}>
              {outcomeLabel(o)}
            </Button>
          ))}
        </div>
        {form.direction === "OUTBOUND" && (form.outcome === "NO_ANSWER" || form.outcome === "LEFT_MESSAGE" || form.outcome === "SENT") && (
          <p className="text-xs text-muted-foreground">No reply in a week raises a follow-up task for the account owner.</p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ix-when">When</Label>
          <Input id="ix-when" type="datetime-local" value={form.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} max={localNow()} />
          <div className="flex gap-1.5">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => set("occurredAt", localNow())}>Now</Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => set("occurredAt", format(addDays(new Date(), -1), "yyyy-MM-dd'T'10:00"))}>Yesterday</Button>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ix-summary">What happened</Label>
        <Textarea id="ix-summary" value={form.summary} onChange={(e) => set("summary", e.target.value)} rows={3} autoFocus placeholder="Talked through their Q1 multifamily pipeline; they want our roofing capability statement before the Boynton project bids." maxLength={4000} />
      </div>

      {!interaction && (
        <div className="space-y-2 rounded-lg border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={form.followUp} onChange={(e) => set("followUp", e.target.checked)} />
            Create a follow-up task
          </label>
          {form.followUp && (
            <div className="space-y-3">
              <Input value={form.followUpTitle} onChange={(e) => set("followUpTitle", e.target.value)} aria-label="Follow-up title" maxLength={200} />
              <div className="flex flex-wrap items-center gap-1.5">
                {presets.map((p) => {
                  const day = format(addDays(new Date(), p.days), "yyyy-MM-dd");
                  return (
                    <Button key={p.label} type="button" size="sm" variant={form.followUpDay === day ? "default" : "outline"} className="h-7 text-xs" onClick={() => set("followUpDay", day)}>
                      {p.label}
                    </Button>
                  );
                })}
                <Input type="date" value={form.followUpDay} onChange={(e) => set("followUpDay", e.target.value)} className="h-7 w-40 text-xs" aria-label="Follow-up date" />
              </div>
              <div className="space-y-1.5">
                <Label>Assign to</Label>
                <Select items={[{ value: NONE, label: "The account owner" }, ...(options?.owners ?? [])]} value={form.followUpAssignee ?? NONE} onValueChange={(v: string | null) => set("followUpAssignee", !v || v === NONE ? null : v)}>
                  <SelectTrigger className="w-full" aria-label="Assign to"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>The account owner</SelectItem>
                    {(options?.owners ?? []).map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : interaction ? "Save" : "Log it"}</Button>
      </DialogFooter>
    </form>
  );
}
