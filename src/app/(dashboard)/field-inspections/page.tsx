"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { QueryState } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson, HttpError } from "@/lib/fetch-json";
import { NewInspectionDialog } from "@/components/inspector/new-inspection-dialog";

type Row = {
  id: string;
  number: string;
  kindLabel: string;
  status: "OPEN" | "ACCEPTED" | "CLOSED";
  phase: string;
  phaseLabel: string;
  title: string | null;
  place: string;
  job: { id: string; code: string | null } | null;
  contractor: string | null;
  startedBy: string | null;
  createdAt: string;
  photos: number;
  toReview: number;
  open: number;
};

const PHASE_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  review: "destructive",
  corrections: "default",
  analysing: "secondary",
  ready: "secondary",
  accepted: "outline",
  closed: "outline",
  empty: "outline",
};
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** AI Field Inspector: every inspection the viewer may see, newest first. */
export default function InspectionsPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading…</p>}>
      <Inspections />
    </Suspense>
  );
}

function Inspections() {
  const params = useSearchParams();
  const [status, setStatus] = useState<"OPEN" | "ACCEPTED" | "">(params.get("status") === "ACCEPTED" ? "ACCEPTED" : params.get("status") === "ALL" ? "" : "OPEN");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const list = useQuery({
    queryKey: ["inspections", status],
    queryFn: () => fetchJson<{ inspections: Row[] }>(`/api/quality-inspections${status ? `?status=${status}` : ""}`),
    refetchInterval: 15_000,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <PageHeader
        title="Inspections"
        description="Photograph the work, let the AI point out what to fix, and confirm what goes on the punch list. A visual workmanship review — not a code, permit or engineering inspection."
        actions={<Button onClick={() => setCreating(true)}>New inspection</Button>}
      />
      <div className="flex gap-2">
        {([["OPEN", "Open"], ["ACCEPTED", "Accepted"], ["", "All"]] as const).map(([k, l]) => (
          <Button key={l} size="sm" variant={status === k ? "default" : "outline"} onClick={() => setStatus(k)}>
            {l}
          </Button>
        ))}
      </div>
      {!list.data ? (
        list.error instanceof HttpError && list.error.status === 404 ? (
          <p className="rounded border p-4 text-sm text-muted-foreground">The AI Field Inspector is switched off on this server.</p>
        ) : (
          <QueryState query={list} noun="inspection list" />
        )
      ) : list.data.inspections.length === 0 ? (
        <p className="rounded border p-4 text-sm text-muted-foreground">No inspections here yet. Start one from a job, or with New inspection.</p>
      ) : (
        <div className="divide-y rounded border">
          {list.data.inspections.map((r) => (
            <Link key={r.id} href={`/field-inspections/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-3 hover:bg-muted/50">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.place}</div>
                <div className="truncate text-xs text-muted-foreground">
                  <span className="font-mono">{r.number}</span> · {r.kindLabel}
                  {r.contractor ? ` · ${r.contractor}` : ""} · {r.startedBy ?? ""} {when(r.createdAt)}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{r.photos} photo{r.photos === 1 ? "" : "s"}</span>
                {r.toReview ? <Badge variant="destructive">{r.toReview} to review</Badge> : null}
                {r.open ? <Badge>{r.open} open</Badge> : null}
                <Badge variant={PHASE_TONE[r.phase] ?? "outline"}>{r.phaseLabel}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
      <NewInspectionDialog open={creating} onOpenChange={setCreating} presetJobId={params.get("jobId")} />
    </div>
  );
}
