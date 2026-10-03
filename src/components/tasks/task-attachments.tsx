"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Paperclip, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFileSize, uploadProblem } from "@/lib/files/limits";
import { useTaskFileUpload } from "@/components/workflows/use-task-file-upload";
import { FilePreviewDialog } from "@/components/files/file-preview";

type FileRow = { id: string; fileName: string; fileType?: string | null; fileSize: number; uploadedBy: { firstName: string; lastName: string } };

/**
 * The files on an ordinary task, with a way to add another. A workflow step
 * shows its files in the workflow block instead.
 */
export function TaskAttachments({ taskId, files, canEdit }: { taskId: string; files: FileRow[]; canEdit: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useTaskFileUpload(taskId);
  const [preview, setPreview] = useState<number | null>(null);

  if (files.length === 0 && !canEdit) return null;

  return (
    <section>
      <h3 className="text-xs font-medium text-muted-foreground">Attachments</h3>
      {files.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-sm">
          {files.map((f, i) => (
            <li key={f.id} className="flex items-center gap-1.5">
              <Paperclip className="size-3 shrink-0 text-muted-foreground" />
              <button type="button" onClick={() => setPreview(i)} className="truncate text-left hover:underline">
                {f.fileName}
              </button>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatFileSize(f.fileSize)} · {f.uploadedBy.firstName} {f.uploadedBy.lastName}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-1.5">
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            onChange={async (e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              for (const f of picked) {
                const problem = uploadProblem(f);
                if (problem) toast.error(problem);
                // The hook toasts its own failure; carry on with the rest.
                else await upload.mutateAsync(f).catch(() => undefined);
              }
            }}
          />
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={upload.isPending} onClick={() => input.current?.click()}>
            <Upload className="size-3.5" /> {upload.isPending ? "Uploading…" : "Attach file"}
          </Button>
        </div>
      )}
      <FilePreviewDialog files={files} index={preview} onIndexChange={setPreview} />
    </section>
  );
}
