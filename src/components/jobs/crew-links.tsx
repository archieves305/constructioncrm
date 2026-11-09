"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayPhone } from "@/lib/crews/contact";
import { fetchJson } from "@/lib/fetch-json";
import type { GuestPurpose } from "@/lib/guest/purposes";

type LinkRow = { id: string; purpose: GuestPurpose; laborContractId: string | null; crewAssignmentId: string | null; recipientName: string | null; state: "open" | "expired" | "revoked" | "used"; createdAt: string; firstOpenedAt: string | null; submittedAt: string | null };
type Created = { id: string; url: string; message: string; phone: string | null; recipientName: string | null; language: string; expiresAt: string };

const PURPOSE: Record<GuestPurpose, string> = { CREW_PHOTOS: "Photos of the work", CREW_PAYMENT: "Payment request (with photos)", INSTALL_CONFIRM: "Confirm the install day" };
const short = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function stateText(l: LinkRow): { text: string; tone: "default" | "secondary" | "outline" } {
  if (l.state === "used") return { text: `Sent back ${l.submittedAt ? short(l.submittedAt) : ""}`, tone: "default" };
  if (l.state === "revoked") return { text: "Replaced or stopped", tone: "outline" };
  if (l.state === "expired") return { text: "Expired", tone: "outline" };
  return { text: l.firstOpenedAt ? `Opened ${short(l.firstOpenedAt)}` : "Not opened yet", tone: "secondary" };
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Copy didn't work here. Select the text and copy it.");
  }
}

/**
 * Crew links for one labor contract (photos, payment request) or one crew
 * assignment (confirm the install day): make one, copy the prepared text to
 * send from your phone, and see how far each got. What the crew sends waits
 * under Crew submissions until someone accepts it.
 */
export function CrewLinks({ jobId, laborContractId, crewAssignmentId, purposes, canSend, hasPhone }: { jobId: string; laborContractId?: string; crewAssignmentId?: string; purposes: GuestPurpose[]; canSend: boolean; hasPhone: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState<Created | null>(null);
  const links = useQuery({ queryKey: ["guest-links", jobId], queryFn: () => fetchJson<LinkRow[]>(`/api/guest-links?jobId=${jobId}`), enabled: canSend });
  const mine = (links.data ?? []).filter((l) => (laborContractId ? l.laborContractId === laborContractId : l.crewAssignmentId === crewAssignmentId)).slice(0, 4);
  const create = useMutation({
    mutationFn: (purpose: GuestPurpose) =>
      fetchJson<Created>("/api/guest-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purpose, laborContractId, crewAssignmentId }) }),
    onSuccess: (c) => {
      setMade(c);
      void qc.invalidateQueries({ queryKey: ["guest-links", jobId] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not make the link"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/guest-links/${id}/revoke`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["guest-links", jobId] }),
  });
  if (!canSend) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button size="sm" variant="outline" className="h-7" onClick={() => { setMade(null); setOpen(true); }}>
        <Link2 className="mr-1 h-3 w-3" />
        {crewAssignmentId ? "Ask crew to confirm" : "Crew link…"}
      </Button>
      {mine.map((l) => {
        const s = stateText(l);
        return (
          <span key={l.id} className="inline-flex items-center gap-1">
            <Badge variant={s.tone} className="text-3xs">
              {PURPOSE[l.purpose].split(" (")[0]}: {s.text}
            </Badge>
            {l.state === "open" ? (
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => revoke.mutate(l.id)}>
                stop
              </button>
            ) : null}
          </span>
        );
      })}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{made ? "Send this to the crew" : "What should the crew send?"}</DialogTitle>
          </DialogHeader>
          {!made ? (
            <div className="space-y-2">
              {!hasPhone ? <p className="text-sm text-tone-warning-fg">This crew has no phone on file. You can still copy the link; add the contact on the card so links show their number.</p> : null}
              {purposes.map((p) => (
                <Button key={p} className="w-full justify-start" variant="outline" disabled={create.isPending} onClick={() => create.mutate(p)}>
                  {PURPOSE[p]}
                </Button>
              ))}
              <p className="text-xs text-muted-foreground">The link works once and expires ({purposes.includes("INSTALL_CONFIRM") ? "72 hours" : "7 days"}). A new link replaces the open one.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">
                To <b>{made.recipientName ?? "the crew"}</b>
                {made.phone ? ` · ${displayPhone(made.phone)}` : ""} · {made.language === "es" ? "Español" : "English"}
              </p>
              <textarea readOnly value={made.message} rows={4} className="w-full rounded border bg-muted/40 p-2 text-sm" aria-label="Message to send" />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void copy(made.message, "Message")}>Copy message</Button>
                <Button variant="outline" onClick={() => void copy(made.url, "Link")}>
                  Copy link only
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Send it from your phone by text or WhatsApp. When the crew answers, it waits under Crew submissions for someone to accept.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
