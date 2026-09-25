"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Mail, Pause, Play, Repeat, Square, PhoneCall } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/lib/auth/session-client";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { toneClasses, type Tone } from "@/lib/ui/tones";
import { canActOnLeadNurture } from "@/lib/nurture/access";

type State = {
  status: "ACTIVE" | "PAUSED" | "STOPPED";
  stoppedReason: string | null;
  pausedReason: string | null;
  followUpStep: number;
  nurtureSlot: number;
  nextFollowUpAt: string | null;
  nextNurtureAt: string | null;
  lastAutoEmailAt: string | null;
  lastPersonalTouchAt: string | null;
  anchorReason: string;
};
type Send = { id: string; kind: "FOLLOW_UP" | "NURTURE"; status: "SENT" | "FAILED" | "SKIPPED"; subject: string; sentAt: string | null; createdAt: string; error: string | null };
type Payload = { state: State | null; sends: Send[]; nextFollowUpSubject: string | null; nextNurtureSubject: string | null; enabled: boolean; timeZone: string };

const TONE: Record<State["status"], Tone> = { ACTIVE: "success", PAUSED: "warning", STOPPED: "neutral" };
const when = (iso: string | null) => (iso ? format(new Date(iso), "MMM d") : "—");

export function NurtureCard({ leadId }: { leadId: string }) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canAct = session ? canActOnLeadNurture(session.user.role) : false;
  const { data, isLoading } = useQuery<Payload>({ queryKey: ["lead-nurture", leadId], queryFn: () => fetchJson(`/api/leads/${leadId}/nurture`), retry: retryServerErrors });
  const [touchOpen, setTouchOpen] = useState(false);
  const [touchType, setTouchType] = useState<"CALL" | "SMS" | "EMAIL">("CALL");
  const [touchNote, setTouchNote] = useState("");

  const act = useMutation({
    mutationFn: (body: { action: "pause" | "resume" | "stop" | "enrol" | "touch"; communicationType?: string; note?: string }) =>
      fetchJson(`/api/leads/${leadId}/nurture`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: (_r, vars) => {
      toast.success(vars.action === "touch" ? "Personal touch logged — the follow-up clock restarted" : `Nurture ${vars.action === "enrol" ? "enrolled" : vars.action + "d"}`);
      qc.invalidateQueries({ queryKey: ["lead-nurture", leadId] });
      qc.invalidateQueries({ queryKey: ["lead", leadId] });
      setTouchOpen(false);
      setTouchNote("");
    },
    onError: (e: Error) => toast.error(e.message || "Could not update"),
  });

  const st = data?.state ?? null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Repeat className="size-4 text-muted-foreground" /> Automated follow-up
          {st && <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${toneClasses(TONE[st.status]).pill}`}>{st.status === "ACTIVE" ? "Active" : st.status === "PAUSED" ? `Paused${st.pausedReason ? ` · ${st.pausedReason.replace("_", " ")}` : ""}` : `Stopped${st.stoppedReason ? ` · ${st.stoppedReason.replace("_", " ")}` : ""}`}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading || !data ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : !st ? (
          <>
            <p className="text-xs text-muted-foreground">Not enrolled. Open leads with an email are picked up by the morning run{data.enabled ? "" : " once nurture is switched on"}.</p>
            {canAct && (
              <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ action: "enrol" })}>
                Enrol now
              </Button>
            )}
          </>
        ) : (
          <>
            <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Next follow-up</dt>
              <dd className="truncate" title={data.nextFollowUpSubject ?? undefined}>
                {st.status === "ACTIVE" && st.nextFollowUpAt ? `${when(st.nextFollowUpAt)} · ${data.nextFollowUpSubject ?? "—"}` : "—"}
              </dd>
              <dt className="text-muted-foreground">Next nurture</dt>
              <dd className="truncate" title={data.nextNurtureSubject ?? undefined}>
                {st.status === "ACTIVE" && st.nextNurtureAt ? `${when(st.nextNurtureAt)} · ${data.nextNurtureSubject ?? "library exhausted"}` : "—"}
              </dd>
              <dt className="text-muted-foreground">Last automated</dt>
              <dd>{when(st.lastAutoEmailAt)}</dd>
              <dt className="text-muted-foreground">Last personal</dt>
              <dd>{when(st.lastPersonalTouchAt)}</dd>
            </dl>
            {data.sends.length > 0 && (
              <ul className="space-y-1 border-t pt-2 text-xs">
                {data.sends.slice(0, 3).map((s) => (
                  <li key={s.id} className="flex items-center gap-1.5 truncate" title={s.error ?? s.subject}>
                    <Mail className={`size-3 shrink-0 ${s.status === "SENT" ? "text-tone-success-fg" : s.status === "FAILED" ? "text-tone-danger-fg" : "text-muted-foreground"}`} />
                    <span className="text-muted-foreground">{when(s.sentAt ?? s.createdAt)}</span>
                    <span className="truncate">{s.status === "SKIPPED" ? "Skipped (personal touch)" : s.subject}</span>
                  </li>
                ))}
              </ul>
            )}
            {canAct && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Button size="sm" variant="outline" onClick={() => setTouchOpen(true)}>
                  <PhoneCall className="mr-1 size-3.5" /> Log a touch
                </Button>
                {st.status === "ACTIVE" && (
                  <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ action: "pause" })}>
                    <Pause className="mr-1 size-3.5" /> Pause
                  </Button>
                )}
                {st.status === "PAUSED" && (
                  <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ action: "resume" })}>
                    <Play className="mr-1 size-3.5" /> Resume
                  </Button>
                )}
                {st.status !== "STOPPED" ? (
                  <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => confirm("Stop automated emails to this lead? You can enrol again later.") && act.mutate({ action: "stop" })}>
                    <Square className="mr-1 size-3.5" /> Stop
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ action: "enrol" })}>
                    <Play className="mr-1 size-3.5" /> Enrol again
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={touchOpen} onOpenChange={setTouchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log a personal touch</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Records a communication on the lead and restarts the automated follow-up clock from now.</p>
            <Select value={touchType} onValueChange={(v: string | null) => v && setTouchType(v as typeof touchType)}>
              <SelectTrigger>
                <SelectValue>{(v: string) => (v === "CALL" ? "Phone call" : v === "SMS" ? "Text message" : "Email")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CALL">Phone call</SelectItem>
                <SelectItem value="SMS">Text message</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
              </SelectContent>
            </Select>
            <Textarea rows={3} value={touchNote} onChange={(e) => setTouchNote(e.target.value)} placeholder="What was said (optional)" />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setTouchOpen(false)}>
                Cancel
              </Button>
              <Button variant="brand" disabled={act.isPending} onClick={() => act.mutate({ action: "touch", communicationType: touchType, note: touchNote.trim() || undefined })}>
                Log it
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
