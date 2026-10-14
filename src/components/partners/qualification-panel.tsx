"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, ClipboardCheck, Download, ExternalLink, FileText, Lock, MoreHorizontal, Paperclip, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";
import { QUAL_STATUS_LABEL, REQUIREMENT_STATE_LABEL } from "@/lib/partners/qualification-state";
import { toneClasses } from "@/lib/ui/tones";
import type { Tone } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { PackageDialog } from "./package-dialog";
import { QualificationDialog } from "./qualification-dialog";
import { useInvalidatePartners, usePartnerOptions, useQualifications, useVault, personName, type DerivedQualStatus, type Qualification, type Requirement, type RequirementState } from "./use-partners";
import { VaultPreviewDialog } from "./vault-preview-dialog";
import { VaultUploadDialog } from "./vault-upload-dialog";
import type { DocumentView } from "./use-partners";

const STATUS_TONE: Record<DerivedQualStatus, Tone> = { NOT_STARTED: "neutral", IN_PROGRESS: "info", SUBMITTED: "info", INFO_REQUESTED: "warning", APPROVED: "success", REJECTED: "danger", EXPIRED: "danger", RENEWAL_DUE: "warning" };
const STATE_TONE: Record<RequirementState, Tone> = { missing: "danger", provided: "info", expired: "warning", accepted: "success", rejected: "danger", waived: "neutral" };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);

export function QualStatusBadge({ status }: { status: DerivedQualStatus }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", toneClasses(STATUS_TONE[status]).pill)}>{QUAL_STATUS_LABEL[status]}</span>;
}

/** The account's prequalifications: each with its checklist of what the GC asks for, satisfied by the vault. */
export function QualificationPanel({ organizationId, organizationName, canManage }: { organizationId: string; organizationName: string; canManage: boolean }) {
  const { data, isLoading } = useQualifications(organizationId);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Qualification | null>(null);
  const [deleting, setDeleting] = useState<Qualification | null>(null);
  const invalidate = useInvalidatePartners();
  const remove = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/qualifications/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      setDeleting(null);
      toast.success("Qualification removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ListSkeleton rows={4} />;
  const quals = data?.qualifications ?? [];
  return (
    <div className="space-y-4">
      {quals.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No qualification yet" description={`Start one when ${organizationName} asks KNU to prequalify. The checklist of documents they want is filled from the vault.`} action={canManage ? <Button onClick={() => setCreating(true)}><Plus className="mr-1 size-4" /> Start a qualification</Button> : undefined} />
      ) : (
        <>
          {canManage && (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}><Plus className="mr-1 size-4" /> Another qualification</Button>
            </div>
          )}
          {quals.map((q) => (
            <QualificationCard key={q.id} q={q} canManage={canManage} onEdit={() => setEditing(q)} onDelete={() => setDeleting(q)} />
          ))}
        </>
      )}
      <QualificationDialog open={creating} onOpenChange={setCreating} organizationId={organizationId} />
      <QualificationDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} organizationId={organizationId} editing={editing} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove this qualification?"
        description="Its checklist goes with it. An approved qualification cannot be removed — mark it rejected or let it expire."
        tone="danger"
        confirmLabel="Remove"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </div>
  );
}

function QualificationCard({ q, canManage, onEdit, onDelete }: { q: Qualification; canManage: boolean; onEdit: () => void; onDelete: () => void }) {
  const invalidate = useInvalidatePartners();
  const { data: options } = usePartnerOptions();
  const { data: vault } = useVault();
  const [packaging, setPackaging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState("");
  const [preview, setPreview] = useState<DocumentView | null>(null);
  const [uploadFor, setUploadFor] = useState<Requirement | null>(null);

  const patchReq = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => fetchJson(`/api/qualifications/${q.id}/requirements/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const removeReq = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/qualifications/${q.id}/requirements/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const addReq = useMutation({
    mutationFn: (documentTypeKey: string) => fetchJson(`/api/qualifications/${q.id}/requirements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentTypeKey }) }),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      setAddKey("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => fetchJson(`/api/qualifications/${q.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }),
    onSuccess: () => {
      invalidate();
      toast.success("Status updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const currentOfType = (typeId: string) => vault?.types.find((t) => t.id === typeId)?.current ?? null;
  const missingKeys = new Set(q.requirements.map((r) => r.documentType.key));
  const addable = (options?.documentTypes ?? []).filter((t) => !missingKeys.has(t.value));
  const pct = q.coverage.required ? Math.round((q.coverage.satisfied / q.coverage.required) * 100) : 0;
  const statusItems = options?.qualificationStatuses ?? [];

  return (
    <Card>
      {packaging && <PackageDialog qualificationId={q.id} open={packaging} onOpenChange={setPackaging} />}
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {q.platform || "Prequalification"}
              <QualStatusBadge status={q.derivedStatus} />
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {[
                q.owner ? `run by ${personName(q.owner)}` : null,
                q.submittedAt ? `submitted ${day(q.submittedAt)}` : null,
                q.approvedAt ? `approved ${day(q.approvedAt)}` : null,
                q.expiresAt ? `expires ${day(q.expiresAt)}` : null,
                q.renewalDueAt ? `renewal ${day(q.renewalDueAt)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {q.portalUrl && (
              <Button size="sm" variant="outline" nativeButton={false} render={<a href={q.portalUrl} target="_blank" rel="noreferrer" />}>
                <ExternalLink className="mr-1 size-3.5" /> Portal
              </Button>
            )}
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setPackaging(true)}>
                <Download className="mr-1 size-3.5" /> Package
              </Button>
            )}
            {canManage && (
              <Select items={statusItems} value={q.status} onValueChange={(v: string | null) => v && v !== q.status && setStatus.mutate(v)} disabled={setStatus.isPending}>
                <SelectTrigger className="h-8 w-48" aria-label="Qualification status"><SelectValue /></SelectTrigger>
                <SelectContent>{statusItems.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Qualification actions" />}>
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onEdit}><Pencil className="size-4" /> Edit details and dates</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAdding(true)}><Plus className="size-4" /> Add a requirement</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onDelete} className="text-tone-danger-fg"><Trash2 className="size-4" /> Remove…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={pct} className="h-2 flex-1" />
          <span className="shrink-0 text-xs text-muted-foreground">
            {q.coverage.satisfied} of {q.coverage.required} required{q.coverage.optionalTotal ? ` · ${q.coverage.optionalSatisfied}/${q.coverage.optionalTotal} optional` : ""}
          </span>
        </div>
        {q.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{q.notes}</p>}
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y border-t">
          {q.requirements.map((r) => {
            const current = currentOfType(r.documentTypeId);
            const attachedIsCurrent = r.companyDocument && current && r.companyDocument.id === current.id;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.documentType.name}</span>
                    {!r.required && <span className="text-xs text-muted-foreground">(optional)</span>}
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses(STATE_TONE[r.state]).pill)}>{REQUIREMENT_STATE_LABEL[r.state]}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.companyDocument ? (
                      <>
                        {r.companyDocument.locked ? (
                          <span className="inline-flex items-center gap-1"><Lock className="size-3" /> {r.companyDocument.title} v{r.companyDocument.version}</span>
                        ) : (
                          <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => setPreview(toView(r.companyDocument!, r.documentType))}>
                            <Paperclip className="size-3" /> {r.companyDocument.title} v{r.companyDocument.version}
                          </button>
                        )}
                        {r.providedAt && ` · sent ${day(r.providedAt)}`}
                        {r.companyDocument.expiresAt && ` · expires ${day(r.companyDocument.expiresAt)}`}
                        {!attachedIsCurrent && current && <span className="ml-1 font-medium text-tone-warning-fg">· a newer version (v{current.version}) is in the vault</span>}
                      </>
                    ) : current ? (
                      <span>Current in the vault: {current.title} v{current.version}</span>
                    ) : (
                      <span>Nothing of this kind in the vault yet</span>
                    )}
                    {r.notes && ` · ${r.notes}`}
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    {current && !attachedIsCurrent && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => patchReq.mutate({ id: r.id, body: { companyDocumentId: current.id } })} disabled={patchReq.isPending}>
                        {r.companyDocument ? "Mark new version sent" : "Mark sent"}
                      </Button>
                    )}
                    {!current && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setUploadFor(r)}>
                        File it
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7" aria-label={`Actions for ${r.documentType.name}`} />}>
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => patchReq.mutate({ id: r.id, body: { status: "ACCEPTED" } })}><Check className="size-4" /> GC accepted it</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => patchReq.mutate({ id: r.id, body: { status: "REJECTED" } })}><X className="size-4" /> GC rejected it</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => patchReq.mutate({ id: r.id, body: { status: r.status === "WAIVED" ? "PENDING" : "WAIVED" } })}>{r.status === "WAIVED" ? "Un-waive" : "Waived by the GC"}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => patchReq.mutate({ id: r.id, body: { required: !r.required } })}>{r.required ? "Mark optional" : "Mark required"}</DropdownMenuItem>
                        {r.companyDocument && <DropdownMenuItem onClick={() => patchReq.mutate({ id: r.id, body: { companyDocumentId: null, status: "PENDING" } })}>Detach the document</DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => removeReq.mutate(r.id)} className="text-tone-danger-fg"><Trash2 className="size-4" /> Remove from the list</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </li>
            );
          })}
          {adding && (
            <li className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
              <Select items={addable} value={addKey} onValueChange={(v: string | null) => setAddKey(v ?? "")}>
                <SelectTrigger className="h-8 w-64" aria-label="Document kind"><SelectValue placeholder="What else do they ask for?" /></SelectTrigger>
                <SelectContent>{addable.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" disabled={!addKey || addReq.isPending} onClick={() => addReq.mutate(addKey)}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </li>
          )}
        </ul>
      </CardContent>
      <VaultPreviewDialog doc={preview} onClose={() => setPreview(null)} />
      {vault && (
        <VaultUploadDialog open={Boolean(uploadFor)} onOpenChange={(o) => !o && setUploadFor(null)} vault={vault} initialTypeKey={uploadFor?.documentType.key} onSaved={(doc) => uploadFor && patchReq.mutate({ id: uploadFor.id, body: { companyDocumentId: doc.id } })} />
      )}
    </Card>
  );
}

function toView(d: NonNullable<Requirement["companyDocument"]>, type: Requirement["documentType"]): DocumentView {
  return { id: d.id, documentTypeId: type.id, title: d.title, version: d.version, effectiveDate: null, expiresAt: d.expiresAt, confidentiality: d.confidentiality, approvedForExternal: false, supersedesId: null, notes: null, fileName: d.fileName, fileType: d.fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : /\.(png|jpe?g|gif|webp)$/i.test(d.fileName) ? "image/*" : "application/octet-stream", fileSize: 0, createdAt: "", updatedAt: "", uploadedBy: { id: "", firstName: "", lastName: "" }, documentType: type, encrypted: false, locked: d.locked, missing: false, current: false, daysLeft: null, usedByCount: 0 };
}

