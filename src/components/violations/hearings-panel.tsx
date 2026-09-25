"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Gavel, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { useAssignableUsers } from "@/components/tasks/use-tasks";
import { HEARING_OUTCOME_LABEL, HEARING_TYPE_LABEL } from "./status";
import { money, useCaseAction, type CaseData } from "./use-violations";

type Hearing = CaseData["hearings"][number];

export function HearingsPanel({ data }: { data: CaseData }) {
  const [scheduling, setScheduling] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState<Hearing | null>(null);
  const can = data.permissions.canRecordHearing && data.status !== "CLOSED" && data.status !== "CANCELLED";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{data.nextHearingAt ? `Next hearing ${format(new Date(data.nextHearingAt), "EEE MMM d, yyyy · h:mm a")}` : "No hearing scheduled"}</p>
        {can && (
          <Button size="sm" variant="brand" onClick={() => setScheduling(true)}>
            <Plus className="size-3.5" /> Schedule hearing
          </Button>
        )}
      </div>
      {data.hearings.length === 0 ? (
        <EmptyState icon={Gavel} title="No hearings" description="Schedule one when the agency sets a hearing; the workflow calendars the prep steps from its date." />
      ) : (
        <ul className="space-y-2">
          {data.hearings.map((h) => (
            <li key={h.id} id={`hearing-${h.id}`} className="rounded-lg border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {HEARING_TYPE_LABEL[h.type] ?? h.type}
                </Badge>
                <span className="font-medium">{format(new Date(h.scheduledAt), "EEE MMM d, yyyy · h:mm a")}</span>
                {h.location && <span className="text-xs text-muted-foreground">{h.location}</span>}
                {h.outcome ? (
                  <Badge className="border-0 bg-tone-info-soft text-[10px] text-tone-info-fg">{HEARING_OUTCOME_LABEL[h.outcome] ?? h.outcome}</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {h.status.toLowerCase()}
                  </Badge>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <UserAvatar user={h.attendee} size="xs" title={h.attendee ? `Attendee: ${h.attendee.firstName} ${h.attendee.lastName}` : "No attendee"} />
                  {can && !h.outcome && h.status !== "CANCELLED" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOutcomeFor(h)}>
                      Record outcome
                    </Button>
                  )}
                </span>
              </div>
              {(h.orderedFineAmount || h.orderedDailyFine || h.orderDeadline) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {h.orderedFineAmount ? `Fine ${money(h.orderedFineAmount)} · ` : ""}
                  {h.orderedDailyFine ? `${money(h.orderedDailyFine)}/day · ` : ""}
                  {h.orderDeadline ? `Order deadline ${format(new Date(h.orderDeadline), "MMM d, yyyy")}` : ""}
                </p>
              )}
              {h.outcomeNotes && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{h.outcomeNotes}</p>}
              {h.notes && !h.outcomeNotes && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{h.notes}</p>}
              {h.orderFileId && (
                <a className="mt-1 inline-block text-xs underline" href={`/api/files/${h.orderFileId}`} target="_blank" rel="noreferrer">
                  Hearing order
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <ScheduleHearingDialog open={scheduling} onOpenChange={setScheduling} data={data} />
      <HearingOutcomeDialog hearing={outcomeFor} data={data} onClose={() => setOutcomeFor(null)} />
    </div>
  );
}

function ScheduleHearingDialog({ open, onOpenChange, data }: { open: boolean; onOpenChange: (o: boolean) => void; data: CaseData }) {
  const { data: users = [] } = useAssignableUsers();
  const [type, setType] = useState("SPECIAL_MAGISTRATE");
  const [scheduledAt, setScheduledAt] = useState("");
  const [location, setLocation] = useState("");
  const [attendee, setAttendee] = useState<string | null>(data.caseManagerId);
  const [notes, setNotes] = useState("");
  const schedule = useCaseAction<Record<string, unknown>, unknown>(data.id, "/hearings", { success: "Hearing scheduled" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule a hearing</DialogTitle>
          <DialogDescription>The workflow&apos;s hearing-prep steps get their dates from this.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={(v: string | null) => v && setType(v)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => HEARING_TYPE_LABEL[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(HEARING_TYPE_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Date and time</Label>
            <Input type="datetime-local" className="mt-1" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Location</Label>
            <Input className="mt-1" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room, address or virtual link" />
          </div>
          <div>
            <Label className="text-xs">Attendee</Label>
            <AssigneePicker className="mt-1 w-full" value={attendee} users={users} onChange={setAttendee} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea className="mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={!scheduledAt || schedule.isPending} onClick={() => schedule.mutate({ type, scheduledAt: new Date(scheduledAt).toISOString(), location: location.trim() || null, attendeeUserId: attendee, notes: notes.trim() || null }, { onSuccess: () => onOpenChange(false) })}>
            {schedule.isPending ? "Saving…" : "Schedule"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HearingOutcomeDialog({ hearing, data, onClose }: { hearing: Hearing | null; data: CaseData; onClose: () => void }) {
  const [outcome, setOutcome] = useState("COMPLIANCE_ORDERED");
  const [notes, setNotes] = useState("");
  const [fine, setFine] = useState("");
  const [daily, setDaily] = useState("");
  const [orderDeadline, setOrderDeadline] = useState("");
  const [applyDeadline, setApplyDeadline] = useState(true);
  const [continueTo, setContinueTo] = useState("");
  const record = useCaseAction<Record<string, unknown>, unknown>(data.id, `/hearings/${hearing?.id ?? ""}`, { method: "PATCH", success: "Hearing outcome recorded" });
  const continued = outcome === "CONTINUED";
  return (
    <Dialog open={Boolean(hearing)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record the hearing outcome</DialogTitle>
          <DialogDescription>Ordered fines go to the ledger; an order deadline can move the case&apos;s compliance deadline.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Outcome</Label>
            <Select value={outcome} onValueChange={(v: string | null) => v && setOutcome(v)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => HEARING_OUTCOME_LABEL[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(HEARING_OUTCOME_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {continued ? (
            <div className="sm:col-span-2">
              <Label className="text-xs">Continued to</Label>
              <Input type="datetime-local" className="mt-1" value={continueTo} onChange={(e) => setContinueTo(e.target.value)} />
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs">Fine imposed</Label>
                <Input className="mt-1" inputMode="decimal" value={fine} onChange={(e) => setFine(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label className="text-xs">Daily fine ordered</Label>
                <Input className="mt-1" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="0.00 per day" />
              </div>
              <div>
                <Label className="text-xs">Order deadline</Label>
                <Input type="date" className="mt-1" value={orderDeadline} onChange={(e) => setOrderDeadline(e.target.value)} />
              </div>
              {orderDeadline && (
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <Checkbox checked={applyDeadline} onCheckedChange={(v) => setApplyDeadline(Boolean(v))} /> Make it the case&apos;s compliance deadline
                </label>
              )}
            </>
          )}
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes from the order</Label>
            <Textarea className="mt-1" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={record.isPending || (continued && !continueTo)}
            onClick={() =>
              record.mutate(
                continued
                  ? { outcome, outcomeNotes: notes.trim() || null, continueTo: { scheduledAt: new Date(continueTo).toISOString() } }
                  : { outcome, outcomeNotes: notes.trim() || null, orderedFineAmount: fine.trim() || null, orderedDailyFine: daily.trim() || null, orderDeadline: orderDeadline || null, applyOrderDeadline: Boolean(orderDeadline) && applyDeadline },
                { onSuccess: onClose },
              )
            }
          >
            {record.isPending ? "Saving…" : "Record outcome"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
