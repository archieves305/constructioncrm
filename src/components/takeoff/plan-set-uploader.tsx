"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatFileSize } from "@/lib/files/limits";
import { MAX_PLAN_UPLOAD_BYTES, planUploadProblem } from "@/lib/takeoff/limits";
import { DOCUMENT_KIND_LABEL, type PlanDocumentKindName } from "@/lib/takeoff/types";
import { cn } from "@/lib/utils";
import { errorText, planKeys, type PlanDocument } from "./use-plan-sets";

/**
 * Drop a PDF (or several) onto a plan set. Each file becomes a document with
 * its own index job; the hub drives the job once the upload returns.
 */
export function PlanSetUploader({ planSetId, leadId, hasDocuments, onUploaded }: { planSetId: string; leadId: string; hasDocuments: boolean; onUploaded: (jobId: string) => void }) {
  const qc = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<PlanDocumentKindName>(hasDocuments ? "ADDENDUM" : "FULL_SET");
  const [label, setLabel] = useState("");
  const [revision, setRevision] = useState("");
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      form.append("label", label.trim() || file.name.replace(/\.pdf$/i, ""));
      if (revision.trim()) form.append("revisionLabel", revision.trim());
      // XMLHttpRequest for the progress bar; a 20–95 MB upload deserves one
      return new Promise<{ document: PlanDocument; jobId: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/plan-sets/${planSetId}/documents`);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress({ name: file.name, pct: Math.round((e.loaded / e.total) * 100) }); };
        xhr.onload = () => {
          setProgress(null);
          let body: unknown = null;
          try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
          if (xhr.status >= 200 && xhr.status < 300) resolve(body as { document: PlanDocument; jobId: string });
          else reject(new Error((body as { error?: string } | null)?.error ?? `Upload failed (${xhr.status})`));
        };
        xhr.onerror = () => { setProgress(null); reject(new Error("Upload failed — check the connection")); };
        xhr.send(form);
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: planKeys.sets(leadId) });
      qc.invalidateQueries({ queryKey: planKeys.set(planSetId) });
      setLabel("");
      setRevision("");
      toast.success(`${r.document.file.fileName} uploaded — reading the sheets`);
      onUploaded(r.jobId);
    },
    onError: (err) => toast.error(errorText(err)),
  });

  async function take(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const problem = planUploadProblem(file);
      if (problem) { toast.error(problem); continue; }
      await upload.mutateAsync(file).catch(() => {});
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="plan-kind">What is it</Label>
          <select id="plan-kind" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as PlanDocumentKindName)}>
            {(Object.keys(DOCUMENT_KIND_LABEL) as PlanDocumentKindName[]).map((k) => <option key={k} value={k}>{DOCUMENT_KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="plan-label">Label</Label>
          <Input id="plan-label" placeholder="Bid set, Addendum 1…" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="plan-rev">Revision</Label>
          <Input id="plan-rev" placeholder="Rev 2" value={revision} onChange={(e) => setRevision(e.target.value)} maxLength={40} />
        </div>
      </div>
      <div
        className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm", over ? "border-primary bg-primary/5" : "border-muted-foreground/30")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files); }}
        data-testid="plan-dropzone"
      >
        <input ref={picker} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => { const f = e.target.files; e.target.value = ""; if (f) void take(f); }} />
        {progress ? (
          <div className="w-full max-w-sm space-y-1">
            <p className="text-muted-foreground">Uploading {progress.name}…</p>
            <div className="h-2 w-full overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress.pct}%` }} /></div>
          </div>
        ) : (
          <>
            <FileUp className="h-6 w-6 text-muted-foreground" />
            <p>Drop the plan set PDF here, or</p>
            <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => picker.current?.click()}><Upload className="mr-1 h-4 w-4" /> Choose a PDF</Button>
            <p className="text-xs text-muted-foreground">Up to {formatFileSize(MAX_PLAN_UPLOAD_BYTES)} per file. Each sheet is read as it comes in.</p>
          </>
        )}
      </div>
    </div>
  );
}
