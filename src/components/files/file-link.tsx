"use client";

import { useState } from "react";
import { FilePreviewDialog, type PreviewFile } from "./file-preview";

/**
 * A link to one stored file that opens it in place — the preview dialog —
 * instead of a new tab. For records that keep only a file id (a hearing
 * order, an inspection report, a generated contract).
 */
export function FileLink({
  fileId,
  fileName,
  files,
  index = 0,
  className,
  title,
  children,
}: {
  fileId: string;
  /** Shown as the dialog title until the file's own name is loaded. */
  fileName?: string;
  /** The list this file sits in, to step through it; defaults to the one file. */
  files?: readonly PreviewFile[];
  index?: number;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const list = files ?? [{ id: fileId, fileName: fileName ?? "File" }];
  return (
    <>
      <button type="button" className={className} title={title} onClick={() => setOpen(files ? index : 0)}>
        {children}
      </button>
      <FilePreviewDialog files={list} index={open} onIndexChange={setOpen} />
    </>
  );
}
