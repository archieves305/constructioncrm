"use client";

import { useRef, useState } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, FileText, Lock, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { FilePreviewDialog } from "@/components/files/file-preview";
import { fetchJson } from "@/lib/fetch-json";
import { formatFileSize, uploadProblem } from "@/lib/files/limits";
import { PERMIT_DOC_GROUP_LABEL, PERMIT_DOC_TYPES, permitDocLabel, permitDocType, type PermitDocGroup } from "@/lib/permit-intel/doc-types";
import { cn } from "@/lib/utils";
import type { ChecklistLine, PermitDetail, PermitFile } from "./types";

const DOC_ITEMS = PERMIT_DOC_TYPES.map((t) => ({ value: t.key, label: t.label }));

function DocTypeSelect({ value, onChange, disabled, className }: { value: string | null; onChange: (v: string) => void; disabled?: boolean; className?: string }) {
  return (
    <Select items={DOC_ITEMS} value={value ?? undefined} onValueChange={(v: string | null) => v && onChange(v)} disabled={disabled}>
      <SelectTrigger className={cn("h-8 text-xs", className)} aria-label="Document type">
        <SelectValue placeholder="Unclassified — pick a type" />
      </SelectTrigger>
      <SelectContent>
        {DOC_ITEMS.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

async function uploadOne(permitId: string, file: File, docType: string | null) {
  const form = new FormData();
  form.append("file", file);
  form.append("permitId", permitId);
  if (docType) form.append("permitDocType", docType);
  return fetchJson("/api/files", { method: "POST", body: form });
}

/**
 * The permit's documents against what its jurisdiction and type ask for.
 * A document's type is what meets a requirement; a document sent in a
 * frozen package, or issued by the department, is kept exactly as it is.
 */
export function PermitDocuments({ detail, onChanged }: { detail: PermitDetail; onChanged: () => void }) {
  const { permit, files, checklist, checklistSummary, permissions } = detail;
  const input = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);

  const pick = (type: string | null) => {
    setDocType(type);
    input.current?.click();
  };

  const onFiles = async (list: FileList | null) => {
    // the FileList is live: copy it before the input is cleared
    const chosen = list ? Array.from(list) : [];
    if (input.current) input.current.value = "";
    if (!chosen.length) return;
    const refused = chosen.map(uploadProblem).filter(Boolean);
    if (refused.length) refused.forEach((r) => toast.error(r));
    const ok = chosen.filter((f) => !uploadProblem(f));
    setBusy(true);
    let done = 0;
    for (const f of ok) {
      try {
        await uploadOne(permit.id, f, docType);
        done++;
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    if (done) {
      toast.success(`${done} document${done === 1 ? "" : "s"} added${docType ? ` as ${permitDocLabel(docType)}` : ""}`);
      onChanged();
    }
  };

  const classify = async (f: PermitFile, type: string) => {
    try {
      await fetchJson(`/api/files/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permitDocType: type }) });
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const groups = new Map<PermitDocGroup | "unclassified", PermitFile[]>();
  for (const f of files) {
    const g = permitDocType(f.permitDocType)?.group ?? "unclassified";
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  const order: (PermitDocGroup | "unclassified")[] = ["unclassified", "application", "owner", "contractor", "design", "products", "review", "issued", "other"];

  return (
    <div className="space-y-4">
      <input ref={input} type="file" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />

      <Card className="min-w-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">What this permit needs</CardTitle>
          <p className="text-xs text-muted-foreground">
            {checklist.length === 0
              ? "No requirements are set for this jurisdiction and permit type yet."
              : `${checklistSummary.requiredMet} of ${checklistSummary.required} required document${checklistSummary.required === 1 ? "" : "s"} on file${checklistSummary.optional ? ` · ${checklistSummary.optionalMet} of ${checklistSummary.optional} optional` : ""}.`}{" "}
            {permissions.canManageSettings && <a className="text-primary hover:underline" href="/admin/permits?tab=requirements">Edit the checklist</a>}
          </p>
        </CardHeader>
        {checklist.length > 0 && (
          <CardContent className="pt-0">
            <ul className="divide-y">
              {checklist.map((line) => (
                <ChecklistRow key={line.requirement.id} line={line} canEdit={permissions.canEdit && !busy} onUpload={() => pick(line.requirement.documentType)} />
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      <Card className="min-w-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm">Documents ({files.length})</CardTitle>
          {permissions.canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <Label className="sr-only">Type of the next upload</Label>
              <DocTypeSelect value={docType} onChange={setDocType} className="w-[220px]" />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
                <Upload className="size-3.5" /> {busy ? "Uploading…" : "Upload"}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {files.length === 0 ? (
            <EmptyState icon={FileText} title="No documents yet" description="Upload the application, the notice of commencement, plans and product approvals here. They also appear on the job's Files tab." />
          ) : (
            order
              .filter((g) => groups.has(g))
              .map((g) => (
                <section key={g} className="min-w-0">
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g === "unclassified" ? "Unclassified" : PERMIT_DOC_GROUP_LABEL[g]}</h3>
                  <ul className="divide-y rounded-md border">
                    {groups.get(g)!.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setPreview(files.indexOf(f))}>
                          <span className={cn("block truncate text-sm font-medium", f.missing && "text-tone-danger-fg")}>{f.fileName}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {permitDocLabel(f.permitDocType)} · {formatFileSize(f.fileSize)} · {f.uploadedBy.firstName} {f.uploadedBy.lastName}
                            {f.missing && " · missing from the store"}
                          </span>
                        </button>
                        {f.permitLock ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title={f.permitLock === "submitted" ? "Sent in a submitted package — kept exactly as sent" : "Issued by the building department — kept exactly as issued"}>
                            <Lock className="size-3" /> {f.permitLock === "submitted" ? "Submitted" : "Issued"}
                          </span>
                        ) : (
                          permissions.canEdit && <DocTypeSelect value={f.permitDocType} onChange={(t) => classify(f, t)} className="w-[200px]" />
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))
          )}
        </CardContent>
      </Card>
      <FilePreviewDialog files={files} index={preview} onIndexChange={setPreview} onChanged={onChanged} />
    </div>
  );
}

function ChecklistRow({ line, canEdit, onUpload }: { line: ChecklistLine; canEdit: boolean; onUpload: () => void }) {
  const r = line.requirement;
  const Icon = !r.documentType ? CircleDashed : line.met ? CheckCircle2 : CircleAlert;
  const tone = !r.documentType ? "text-muted-foreground" : line.met ? "text-tone-success-fg" : r.required ? "text-tone-danger-fg" : "text-tone-warning-fg";
  return (
    <li className="flex items-start gap-3 py-2">
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {r.title}
          {!r.required && <span className="text-xs text-muted-foreground"> · optional</span>}
          {r.reliability === "OFFICIAL" && <span className="text-xs text-muted-foreground"> · published rule</span>}
        </p>
        {r.body && <p className="text-xs text-muted-foreground">{r.body}</p>}
        {line.files.length > 0 && <p className="truncate text-xs text-muted-foreground">On file: {line.files.map((f) => f.fileName).join(", ")}</p>}
        {r.sourceUrl && (
          <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
            Source
          </a>
        )}
      </div>
      {r.documentType && !line.met && canEdit && (
        <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs" onClick={onUpload}>
          <Upload className="size-3" /> Upload
        </Button>
      )}
    </li>
  );
}
