"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { formatFileSize } from "@/lib/files/limits";
import { DOC_TYPE_LABEL, REQUIREMENT_TYPES, type Compliance, type ComplianceStatus, type RequirementState, type VendorDocType } from "@/lib/vendors/compliance";
import { ComplianceBadge } from "./compliance-badge";
import { DocumentDialog } from "./document-dialog";
import type { VendorDocument } from "./use-vendors";

const STATUS_LABEL: Record<ComplianceStatus, string> = {
  ok: "On file",
  expiring: "Expiring soon",
  expired: "Expired",
  missing: "Missing",
  not_recorded: "Not recorded",
};
const STATUS_TONE: Record<ComplianceStatus, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expiring: "bg-amber-50 text-amber-800 border-amber-200",
  expired: "bg-red-50 text-red-700 border-red-200",
  missing: "bg-red-50 text-red-700 border-red-200",
  not_recorded: "bg-gray-50 text-gray-600 border-gray-200",
};

/** A pinned day ("2026-11-04T12:00Z") printed as its own date, whatever the browser's zone. */
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);

function when(r: RequirementState): string {
  if (r.status === "missing") return "Nothing on file";
  if (r.status === "not_recorded") return "Optional";
  if (r.daysLeft === null) return r.docType ? DOC_TYPE_LABEL[r.docType] : "On file";
  const date = day(`${r.expiresDay}T12:00:00.000Z`);
  if (r.daysLeft < 0) return `Expired ${date}`;
  if (r.daysLeft === 0) return "Expires today";
  return `Expires ${date}${r.daysLeft <= 30 ? ` · ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left` : ""}`;
}

/**
 * What a vendor has on file. The requirements at the top are derived from the
 * documents below them; nothing here blocks work — a gap is a warning and, for
 * a dated document, a task for the compliance owner.
 */
export function ComplianceCard({
  vendorId,
  compliance,
  documents,
  canManage,
  isSubcontractor,
}: {
  vendorId: string;
  compliance: Compliance;
  documents: VendorDocument[];
  canManage: boolean;
  isSubcontractor: boolean;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<VendorDocType | null>(null);
  const [editing, setEditing] = useState<VendorDocument | null>(null);
  const [removing, setRemoving] = useState<VendorDocument | null>(null);
  const inForce = new Set(compliance.requirements.map((r) => r.docId).filter(Boolean));

  const remove = useMutation({
    mutationFn: (docId: string) => fetchJson(`/api/vendors/${vendorId}/documents/${docId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      qc.invalidateQueries({ queryKey: ["labor-contracts"] });
      setRemoving(null);
      toast.success("Document removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            Compliance <ComplianceBadge compliance={compliance} />
          </CardTitle>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setAdding("GL_INSURANCE")}>
              <Plus className="mr-1 size-4" />
              Add document
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {isSubcontractor
            ? "A subcontractor needs general liability, workers' comp (or an exemption) and a W-9. A gap warns wherever the vendor is used; it never blocks."
            : "Nothing is required of a supplier. A dated document recorded here is still watched for its expiry."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {compliance.requirements.map((r) => (
            <div key={r.key} className="flex items-start justify-between gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {r.label}
                  {!r.required && isSubcontractor && <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>}
                </div>
                <div className="text-xs text-muted-foreground">{when(r)}</div>
                {canManage && (
                  <button type="button" className="mt-1 text-xs font-medium text-blue-700 hover:underline" onClick={() => setAdding(REQUIREMENT_TYPES[r.key][0])}>
                    {r.docId ? "Add a newer one" : "Add"}
                  </button>
                )}
              </div>
              <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[r.status])}>{STATUS_LABEL[r.status]}</span>
            </div>
          ))}
        </div>

        {documents.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Documents</div>
            <ul className="divide-y rounded-lg border">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {DOC_TYPE_LABEL[d.type]}
                      {!inForce.has(d.id) && d.type !== "OTHER" && <span className="ml-2 text-xs font-normal text-muted-foreground">replaced</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[
                        d.carrier,
                        d.policyNumber && `#${d.policyNumber}`,
                        d.expiresAt && `expires ${day(d.expiresAt)}`,
                        `added ${new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} by ${d.uploadedBy.firstName} ${d.uploadedBy.lastName}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {d.notes && <div className="text-xs text-muted-foreground">{d.notes}</div>}
                  </div>
                  {d.fileName ? (
                    <a
                      href={`/api/vendors/${vendorId}/documents/${d.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-[12rem] items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                      title={d.fileName}
                    >
                      <Paperclip className="size-3 shrink-0" />
                      <span className="truncate">{d.fileName}</span>
                      {d.fileSize ? <span className="shrink-0 font-normal text-muted-foreground">{formatFileSize(d.fileSize)}</span> : null}
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">No file</span>
                  )}
                  {canManage && (
                    <span className="flex gap-1">
                      <Button size="icon" variant="ghost" className="size-7" aria-label={`Edit ${DOC_TYPE_LABEL[d.type]}`} onClick={() => setEditing(d)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="size-7" aria-label={`Remove ${DOC_TYPE_LABEL[d.type]}`} onClick={() => setRemoving(d)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <DocumentDialog vendorId={vendorId} open={Boolean(adding)} onOpenChange={(o) => !o && setAdding(null)} initialType={adding ?? undefined} />
      <DocumentDialog vendorId={vendorId} open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} editing={editing} />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this document?"
        description={removing ? `${DOC_TYPE_LABEL[removing.type]}${removing.fileName ? ` (${removing.fileName})` : ""} will be removed from the vendor, and its file deleted.` : undefined}
        tone="danger"
        confirmLabel="Remove"
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </Card>
  );
}
