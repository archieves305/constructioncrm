"use client";

import { Download, ExternalLink, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatFileSize } from "@/lib/files/limits";
import { CONFIDENTIALITY_LABEL } from "@/lib/partners/vault-access";
import type { DocumentView } from "./use-partners";

export const vaultFileHref = (id: string, download = false) => `/api/company-documents/${id}/file${download ? "?download=1" : ""}`;

/** A vault document in place: an image or a PDF in a same-origin frame, anything else a download. A restricted read is logged server-side. */
export function VaultPreviewDialog({ doc, onClose }: { doc: DocumentView | null; onClose: () => void }) {
  const open = Boolean(doc);
  const isImage = doc?.fileType.startsWith("image/");
  const isPdf = doc?.fileType === "application/pdf";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] sm:max-w-4xl">
        {doc && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {doc.title}
                {doc.confidentiality === "RESTRICTED" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"><Lock className="size-3" /> {CONFIDENTIALITY_LABEL.RESTRICTED}</span>
                )}
              </DialogTitle>
              <DialogDescription>
                {doc.documentType.name} · v{doc.version} · {doc.fileName} · {formatFileSize(doc.fileSize)}
                {doc.confidentiality === "RESTRICTED" ? " · this view is logged" : ""}
              </DialogDescription>
            </DialogHeader>
            {doc.locked ? (
              <p className="text-sm text-muted-foreground">You do not have access to open this document.</p>
            ) : doc.missing ? (
              <p className="text-sm text-muted-foreground">The stored file is missing on disk. File a new version to replace it.</p>
            ) : isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={vaultFileHref(doc.id)} alt={doc.title} className="max-h-[70vh] w-auto max-w-full rounded-md object-contain" />
            ) : isPdf ? (
              <iframe src={vaultFileHref(doc.id)} title={doc.title} className="h-[70vh] w-full rounded-md border" />
            ) : (
              <p className="text-sm text-muted-foreground">This file type cannot be shown here; download it instead.</p>
            )}
            {!doc.locked && !doc.missing && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" nativeButton={false} render={<a href={vaultFileHref(doc.id)} target="_blank" rel="noreferrer" />}>
                  <ExternalLink className="mr-1.5 size-4" /> Open in a new tab
                </Button>
                <Button nativeButton={false} render={<a href={vaultFileHref(doc.id, true)} />}>
                  <Download className="mr-1.5 size-4" /> Download
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
