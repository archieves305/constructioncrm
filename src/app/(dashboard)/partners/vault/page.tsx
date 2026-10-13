"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, FileText, FolderLock, Lock, MoreHorizontal, Paperclip, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fetchJson } from "@/lib/fetch-json";
import { formatFileSize } from "@/lib/files/limits";
import { CONFIDENTIALITY_LABEL } from "@/lib/partners/vault-access";
import { toneClasses, type Tone } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { VaultPreviewDialog } from "@/components/partners/vault-preview-dialog";
import { VaultUploadDialog } from "@/components/partners/vault-upload-dialog";
import { useInvalidatePartners, useVault, type Confidentiality, type DocumentView, type VaultType } from "@/components/partners/use-partners";

const CATEGORY_LABEL: Record<string, string> = { insurance: "Insurance", licensing: "Licences", safety: "Safety", financial: "Financial", company: "Company" };
const CONF_TONE: Record<Confidentiality, Tone> = { INTERNAL: "neutral", RESTRICTED: "danger", SHAREABLE: "success" };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);

function expiryTone(daysLeft: number | null): { label: string; cls: string } | null {
  if (daysLeft === null) return null;
  if (daysLeft < 0) return { label: `Expired ${-daysLeft} d ago`, cls: toneClasses("danger").pill };
  if (daysLeft <= 30) return { label: `${daysLeft} d left`, cls: toneClasses("warning").pill };
  return { label: `${daysLeft} d left`, cls: toneClasses("success").pill };
}

/** KNU's own documents, grouped by category: the current version of each kind, its expiry, who may open it, where it is used. */
export default function VaultPage() {
  const { data, isLoading, error, refetch } = useVault();
  const [uploading, setUploading] = useState<{ open: boolean; typeKey?: string; replacing?: DocumentView | null }>({ open: false });
  const [preview, setPreview] = useState<DocumentView | null>(null);

  return (
    <div>
      <PageHeader
        title="Document Vault"
        breadcrumb={[{ label: "Business Development" }, { label: "Document Vault" }]}
        description="KNU's licences, certificates, tax forms and company papers — versioned, with expiry alerts, classified by who may open them."
        actions={data?.canUpload && <Button onClick={() => setUploading({ open: true })}><Upload className="mr-2 size-4" /> File a document</Button>}
      />
      {isLoading ? (
        <ListSkeleton rows={8} />
      ) : error || !data ? (
        <EmptyState icon={FolderLock} title="The vault could not be loaded" description={(error as Error | null)?.message} action={<Button variant="outline" onClick={() => refetch()}>Try again</Button>} />
      ) : (
        <div className="space-y-6">
          {Object.entries(groupBy(data.types)).map(([category, types]) => (
            <section key={category}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY_LABEL[category] ?? category}</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {types.map((t) => (
                  <TypeCard key={t.id} type={t} canUpload={data.canUpload} canClassify={data.canClassify} onUpload={(replacing) => setUploading({ open: true, typeKey: t.key, replacing })} onPreview={setPreview} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {data && <VaultUploadDialog open={uploading.open} onOpenChange={(o) => setUploading({ open: o })} vault={data} initialTypeKey={uploading.typeKey} replacing={uploading.replacing} />}
      <VaultPreviewDialog doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function groupBy(types: VaultType[]): Record<string, VaultType[]> {
  const out: Record<string, VaultType[]> = {};
  for (const t of types) (out[t.category] ??= []).push(t);
  return out;
}

function TypeCard({ type, canUpload, canClassify, onUpload, onPreview }: { type: VaultType; canUpload: boolean; canClassify: boolean; onUpload: (replacing: DocumentView | null) => void; onPreview: (d: DocumentView) => void }) {
  const [history, setHistory] = useState(false);
  const current = type.current;
  const expiry = current ? expiryTone(current.daysLeft) : null;
  return (
    <Card className={cn(current?.daysLeft !== null && current?.daysLeft !== undefined && current.daysLeft < 0 && "border-red-200")}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{type.name}</CardTitle>
          {canUpload && (
            <Button size="sm" variant="outline" onClick={() => onUpload(current)}>
              <Plus className="mr-1 size-3.5" /> {current ? "New version" : "File it"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {current ? (
          <DocumentLine doc={current} canClassify={canClassify} onPreview={onPreview} />
        ) : (
          <p className="text-muted-foreground">Nothing on file{type.defaultValidityMonths ? ` · usually valid ${type.defaultValidityMonths} months` : ""}.</p>
        )}
        {expiry && <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", expiry.cls)}>{expiry.label}</span>}
        {type.versions.length > 1 && (
          <div>
            <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline" onClick={() => setHistory((h) => !h)}>
              <ChevronDown className={cn("size-3.5 transition-transform", history && "rotate-180")} /> {type.versions.length - 1} earlier version{type.versions.length === 2 ? "" : "s"}
            </button>
            {history && (
              <ul className="mt-2 space-y-2 border-l pl-3">
                {type.versions.slice(1).map((d) => (
                  <li key={d.id}>
                    <DocumentLine doc={d} canClassify={canClassify} onPreview={onPreview} muted />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentLine({ doc, canClassify, onPreview, muted }: { doc: DocumentView; canClassify: boolean; onPreview: (d: DocumentView) => void; muted?: boolean }) {
  const invalidate = useInvalidatePartners();
  const [removing, setRemoving] = useState(false);
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => fetchJson(`/api/company-documents/${doc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidate();
      toast.success("Document updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => fetchJson(`/api/company-documents/${doc.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      setRemoving(false);
      toast.success("Version deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className={cn("flex flex-wrap items-start gap-x-3 gap-y-1", muted && "text-muted-foreground")}>
      <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {doc.locked ? (
            <span className="inline-flex items-center gap-1 font-medium"><Lock className="size-3.5" /> {doc.title}</span>
          ) : (
            <button type="button" className="font-medium hover:underline" onClick={() => onPreview(doc)}>{doc.title}</button>
          )}
          <span className="font-mono text-[11px] text-muted-foreground">v{doc.version}</span>
          <Badge variant="outline" className={cn("border-0 text-[11px]", toneClasses(CONF_TONE[doc.confidentiality]).pill)}>{CONFIDENTIALITY_LABEL[doc.confidentiality]}</Badge>
          {doc.approvedForExternal && <span className="inline-flex items-center gap-1 text-[11px] text-tone-success-fg"><ShieldCheck className="size-3" /> approved to send</span>}
          {doc.missing && <Badge variant="destructive" className="text-[10px]">Missing on disk</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          {[doc.effectiveDate && `from ${day(doc.effectiveDate)}`, doc.expiresAt ? `expires ${day(doc.expiresAt)}` : "no expiry", `filed ${day(doc.createdAt)} by ${doc.uploadedBy.firstName} ${doc.uploadedBy.lastName}`, doc.usedByCount ? `used by ${doc.usedByCount} qualification${doc.usedByCount === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
        </div>
        {!doc.locked && (
          <a href={`/api/company-documents/${doc.id}/file?download=1`} className="inline-flex max-w-[16rem] items-center gap-1 text-xs text-blue-700 hover:underline" title={doc.fileName}>
            <Paperclip className="size-3 shrink-0" /><span className="truncate">{doc.fileName}</span><span className="shrink-0 font-normal text-muted-foreground">{formatFileSize(doc.fileSize)}</span>
          </a>
        )}
        {doc.notes && <div className="text-xs text-muted-foreground">{doc.notes}</div>}
      </div>
      {canClassify && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7" aria-label={`Actions for ${doc.title}`} />}>
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => patch.mutate({ approvedForExternal: !doc.approvedForExternal })}>{doc.approvedForExternal ? "Withdraw external approval" : "Approve for external distribution"}</DropdownMenuItem>
            {(["SHAREABLE", "INTERNAL", "RESTRICTED"] as Confidentiality[]).filter((c) => c !== doc.confidentiality).map((c) => (
              <DropdownMenuItem key={c} onClick={() => patch.mutate({ confidentiality: c })}>Make {CONFIDENTIALITY_LABEL[c].toLowerCase()}</DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setRemoving(true)} className="text-tone-danger-fg"><Trash2 className="size-4" /> Delete this version…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={`Delete ${doc.title} v${doc.version}?`} description="The file is removed from disk. A version attached to a qualification cannot be deleted until it is detached there." tone="danger" confirmLabel="Delete" pending={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  );
}
