"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/fetch-json";
import { QueryState } from "@/components/shared/query-state";

type Submission = {
  id: string;
  purpose: "CREW_PHOTOS" | "CREW_PAYMENT" | "INSTALL_CONFIRM";
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  createdAt: string;
  jobId: string;
  jobNumber: string;
  street: string;
  from: string | null;
  language: string;
  answer: { amount?: number; note?: string; answer?: "yes" | "no" | "change" };
  photoCount: number;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

const WHAT = { CREW_PHOTOS: "Photos of the work", CREW_PAYMENT: "Payment request", INSTALL_CONFIRM: "Install day answer" } as const;
const DAY_ANSWER = { yes: "Will be there", no: "Can't make it", change: "Needs a different day" } as const;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * What crews sent through their links, waiting for a person. Accepting makes it
 * count (photos join the job's files, a payment request goes to accounting, a
 * day answer is recorded); rejecting needs a reason and deletes the photos.
 */
export default function CrewSubmissionsPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading…</p>}>
      <CrewSubmissions />
    </Suspense>
  );
}

function CrewSubmissions() {
  const qc = useQueryClient();
  const focus = useSearchParams().get("id");
  const list = useQuery({ queryKey: ["guest-submissions"], queryFn: () => fetchJson<Submission[]>("/api/guest-submissions?status=ALL") });
  const pending = (list.data ?? []).filter((s) => s.status === "PENDING");
  const done = (list.data ?? []).filter((s) => s.status !== "PENDING").slice(0, 20);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">From crews</h1>
        <p className="text-sm text-muted-foreground">Sent through crew links. Nothing counts until someone here accepts it.</p>
      </div>
      {!list.data ? <QueryState query={list} noun="crew submission list" /> : null}
      {list.data && pending.length === 0 ? (
        <p className="rounded border p-4 text-sm text-muted-foreground">Nothing waiting. Send a crew a link from a job&apos;s Field → Labor or Crews tab.</p>
      ) : null}
      <div className="space-y-3">
        {pending.map((s) => (
          <SubmissionCard key={s.id} s={s} highlight={s.id === focus} onDone={() => void qc.invalidateQueries({ queryKey: ["guest-submissions"] })} />
        ))}
      </div>
      {done.length ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Decided</h2>
          {done.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-sm">
              <Badge variant={s.status === "ACCEPTED" ? "default" : "outline"}>{s.status === "ACCEPTED" ? "Accepted" : "Rejected"}</Badge>
              <span className="font-medium">{s.street}</span>
              <span className="text-muted-foreground">
                {WHAT[s.purpose]} from {s.from ?? "a crew"} · {s.reviewedBy ?? ""} {s.reviewedAt ? when(s.reviewedAt) : ""}
                {s.reviewNote ? ` · “${s.reviewNote}”` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SubmissionCard({ s, highlight, onDone }: { s: Submission; highlight: boolean; onDone: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const decide = useMutation({
    mutationFn: (body: { decision: "accept" | "reject"; note?: string }) =>
      fetchJson(`/api/guest-submissions/${s.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: (_d, v) => {
      toast.success(v.decision === "accept" ? (s.purpose === "CREW_PAYMENT" ? "Accepted: payment request sent to accounting" : "Accepted") : "Rejected");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message || "Could not save"),
  });
  return (
    <Card className={highlight ? "ring-2 ring-primary" : undefined}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <Link href={`/jobs/${s.jobId}`} className="font-medium hover:underline">
              {s.street}
            </Link>
            <span className="ml-2 text-xs text-muted-foreground">{s.jobNumber}</span>
            <p className="text-sm text-muted-foreground">
              {WHAT[s.purpose]} from <b>{s.from ?? "a crew"}</b> · {when(s.createdAt)}
              {s.language === "es" ? " · in Spanish" : ""}
            </p>
          </div>
          {s.purpose === "CREW_PAYMENT" && typeof s.answer.amount === "number" ? <span className="text-xl font-semibold tabular-nums">{money(s.answer.amount)}</span> : null}
          {s.purpose === "INSTALL_CONFIRM" && s.answer.answer ? <Badge variant={s.answer.answer === "yes" ? "default" : "outline"}>{DAY_ANSWER[s.answer.answer]}</Badge> : null}
        </div>
        {s.answer.note ? <p className="rounded bg-muted/50 p-2 text-sm">“{s.answer.note}”</p> : null}
        {s.photoCount ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {Array.from({ length: s.photoCount }).map((_, n) => (
              <a key={n} href={`/api/guest-submissions/${s.id}/photos/${n}`} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded border">
                {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated, uncached API response */}
                <img src={`/api/guest-submissions/${s.id}/photos/${n}`} alt={`Photo ${n + 1}`} className="h-full w-full object-cover" />
              </a>
            ))}
          </div>
        ) : null}
        {rejecting ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (the crew can be told)" className="max-w-sm" aria-label="Reason for rejecting" />
            <Button variant="destructive" disabled={!reason.trim() || decide.isPending} onClick={() => decide.mutate({ decision: "reject", note: reason.trim() })}>
              Reject
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button disabled={decide.isPending} onClick={() => decide.mutate({ decision: "accept" })}>
              {s.purpose === "CREW_PAYMENT" ? "Accept and send to accounting" : s.purpose === "CREW_PHOTOS" ? "Accept photos" : "Record the answer"}
            </Button>
            <Button variant="outline" disabled={decide.isPending} onClick={() => setRejecting(true)}>
              Reject…
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
