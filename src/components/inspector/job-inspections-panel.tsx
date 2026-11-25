"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson, HttpError } from "@/lib/fetch-json";
import { NewInspectionDialog } from "./new-inspection-dialog";

type Row = { id: string; number: string; kindLabel: string; phase: string; phaseLabel: string; contractor: string | null; startedBy: string | null; createdAt: string; photos: number; toReview: number; open: number };

/** A job's AI Field Inspector inspections, and the button that starts one on it. */
export function JobInspectionsPanel({ jobId }: { jobId: string }) {
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["inspections", "job", jobId], queryFn: () => fetchJson<{ inspections: Row[] }>(`/api/quality-inspections?jobId=${jobId}`), retry: false });
  if (q.error instanceof HttpError && q.error.status === 404) return <p className="text-sm text-muted-foreground">The AI Field Inspector is switched off on this server.</p>;
  const rows = q.data?.inspections ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Photograph the work room by room; the AI points out what to fix, a person confirms it, and confirmed findings become punch items.</p>
        <Button size="sm" onClick={() => setCreating(true)}>New inspection</Button>
      </div>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {q.data && !rows.length ? <p className="rounded border p-4 text-sm text-muted-foreground">No inspections on this job yet.</p> : null}
      {rows.length ? (
        <div className="divide-y rounded border">
          {rows.map((r) => (
            <Link key={r.id} href={`/field-inspections/${r.id}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50">
              <span className="font-mono text-xs">{r.number}</span>
              <span>{r.kindLabel}{r.contractor ? ` · ${r.contractor}` : ""}</span>
              <span className="text-xs text-muted-foreground">{r.startedBy} · {new Date(r.createdAt).toLocaleDateString()}</span>
              <span className="ml-auto flex gap-1">
                {r.toReview ? <Badge variant="destructive">{r.toReview} to review</Badge> : null}
                {r.open ? <Badge>{r.open} open</Badge> : null}
                <Badge variant="outline">{r.phaseLabel}</Badge>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
      <NewInspectionDialog open={creating} onOpenChange={setCreating} presetJobId={jobId} />
    </div>
  );
}
