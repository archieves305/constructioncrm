"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileStack, Layers, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/shared/callout";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { fetchJson } from "@/lib/fetch-json";
import { formatFileSize } from "@/lib/files/limits";
import { DOCUMENT_KIND_LABEL } from "@/lib/takeoff/types";
import { DocumentStatusBadge } from "./badges";
import { PlanSetUploader } from "./plan-set-uploader";
import { SheetIndexTable } from "./sheet-index-table";
import { errorText, json, planKeys, useIndexJob, usePlanSets, useSheets, type PlanDocument, type PlanSet } from "./use-plan-sets";

/**
 * The plan-takeoff hub on a lead (and on its job): the plan sets with their
 * documents, the uploader, the index progress and the sheet table with inline
 * corrections. Trades and analysis arrive with M3.
 */
export function PlanTakeoffPanel({ leadId, jobId, canEdit = true, canDelete = false }: { leadId: string; jobId?: string; canEdit?: boolean; canDelete?: boolean }) {
  const qc = useQueryClient();
  const sets = usePlanSets(leadId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current: PlanSet | null = sets.data?.find((s) => s.id === selectedId) ?? sets.data?.[0] ?? null;

  const create = useMutation({
    mutationFn: () => fetchJson<PlanSet>("/api/plan-sets", json({ leadId, jobId: jobId ?? null, name: "Plan set" })),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: planKeys.sets(leadId) }); setSelectedId(s.id); },
    onError: (err) => toast.error(errorText(err)),
  });

  if (sets.isLoading) return <ListSkeleton rows={3} />;
  if (sets.isError) return <Callout tone="danger" title="Couldn't load the plan sets">{errorText(sets.error)}</Callout>;

  if (!current) {
    return (
      <EmptyState
        icon={FileStack}
        title="No plans yet"
        description="Upload the construction set to start a takeoff. Each sheet is read, indexed and made ready to measure."
        action={canEdit ? <Button onClick={() => create.mutate()} disabled={create.isPending}>Start a plan set</Button> : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      {sets.data && sets.data.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {sets.data.map((s) => (
            <Button key={s.id} size="sm" variant={s.id === current.id ? "default" : "outline"} onClick={() => setSelectedId(s.id)}>{s.name}</Button>
          ))}
          {canEdit && <Button size="sm" variant="ghost" onClick={() => create.mutate()}>+ Another set</Button>}
        </div>
      )}
      <PlanSetCard set={current} leadId={leadId} canEdit={canEdit} canDelete={canDelete} onDeleted={() => setSelectedId(null)} />
    </div>
  );
}

function PlanSetCard({ set, leadId, canEdit, canDelete, onDeleted }: { set: PlanSet; leadId: string; canEdit: boolean; canDelete: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(set.documents.find((d) => d.job && (d.job.status === "PENDING" || d.job.status === "RUNNING"))?.job?.id ?? null);
  const job = useIndexJob(jobId, (j) => {
    if (j.status === "DONE") toast.success("Sheets indexed");
    else if (j.status === "FAILED") toast.error(`Reading the sheets failed: ${j.error ?? "see the document"}`);
  });
  const sheets = useSheets(set.id);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const remove = useMutation({
    mutationFn: () => fetchJson(`/api/plan-sets/${set.id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: planKeys.sets(leadId) }); onDeleted(); toast.success("Plan set removed"); },
    onError: (err) => toast.error(errorText(err)),
  });

  const retry = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/takeoff-jobs/${id}/retry`, { method: "POST" }),
    onSuccess: (_r, id) => { setJobId(id); qc.invalidateQueries({ queryKey: planKeys.sets(leadId) }); },
    onError: (err) => toast.error(errorText(err)),
  });

  const live = job.data && (job.data.status === "PENDING" || job.data.status === "RUNNING");
  const totalSheets = set.documents.reduce((n, d) => n + d.sheetCount, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base"><Layers className="h-4 w-4 text-muted-foreground" /> {set.name}<span className="text-sm font-normal text-muted-foreground">· {totalSheets} sheet{totalSheets === 1 ? "" : "s"}</span></CardTitle>
        <div className="flex items-center gap-2">
          {totalSheets > 0 && <Link href={`/plans/${set.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Open viewer</Link>}
          {canDelete && <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete plan set"><Trash2 className="h-4 w-4" /></Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {set.documents.length > 0 && (
          <ul className="divide-y rounded-md border">
            {set.documents.map((d) => <DocumentRow key={d.id} doc={d} live={live && job.data?.id === d.job?.id ? job.data : null} onRetry={() => retry.mutate(d.job!.id)} />)}
          </ul>
        )}
        {canEdit && <PlanSetUploader planSetId={set.id} leadId={leadId} hasDocuments={set.documents.length > 0} onUploaded={setJobId} />}
        {sheets.data && sheets.data.length > 0 && <SheetIndexTable planSetId={set.id} sheets={sheets.data} canEdit={canEdit} />}
        {sheets.data && sheets.data.length > 0 && sheets.data.every((s) => s.isRaster) && (
          <Callout tone="warning" title="These plans have no readable text">Automatic indexing and takeoff are off for scanned sheets. Calibrate each sheet and measure by hand once the drawing tools arrive.</Callout>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this plan set?"
        description="The PDFs, every sheet and everything read from them are removed. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => remove.mutate()}
      />
    </Card>
  );
}

function DocumentRow({ doc, live, onRetry }: { doc: PlanDocument; live: { progress: string; doneSteps: number; totalSteps: number } | null; onRetry: () => void }) {
  const status = live ? "INDEXING" : doc.status;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="font-medium">{doc.label}</span>
      <span className="text-muted-foreground">{DOCUMENT_KIND_LABEL[doc.kind]}{doc.revisionLabel ? ` · ${doc.revisionLabel}` : ""}</span>
      <span className="text-muted-foreground">{doc.file.fileName} · {formatFileSize(doc.file.fileSize)}{doc.pageCount ? ` · ${doc.pageCount} pages` : ""}</span>
      <span className="text-muted-foreground">{format(new Date(doc.createdAt), "MMM d, yyyy")}</span>
      <span className="ml-auto flex items-center gap-2">
        {live ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="analysis-progress">
            <RefreshCw className="h-3 w-3 animate-spin" /> {live.progress}
            {live.totalSteps > 1 && <span>({live.doneSteps}/{live.totalSteps})</span>}
          </span>
        ) : (
          <DocumentStatusBadge status={status} />
        )}
        {!live && doc.status === "FAILED" && doc.job && (
          <Button size="sm" variant="outline" onClick={onRetry} title={doc.error ?? undefined}>Retry</Button>
        )}
      </span>
      {!live && doc.status === "FAILED" && doc.error && <p className="basis-full text-xs text-tone-danger-fg">{doc.error}</p>}
      {doc.file.missing && <p className="basis-full text-xs text-tone-danger-fg">The PDF is missing on disk.</p>}
    </li>
  );
}
