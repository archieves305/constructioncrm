"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilePreviewDialog, type PreviewFile } from "@/components/files/file-preview";
import { uploadForm } from "@/components/workflows/use-task-file-upload";
import { fetchJson } from "@/lib/fetch-json";
import { uploadProblem } from "@/lib/files/limits";

/** A completion photo as the labor routes list it. */
export type CompletionPhoto = PreviewFile & { missing?: boolean };

/** What a completion photo hangs off: a payment request, or a recorded payment. */
export type PhotoTarget = { laborPaymentRequestId: string } | { laborPaymentId: string };

/** A photo the picker may take: an image the upload route would accept. */
function photoProblem(f: File): string | null {
  if (!f.type.startsWith("image/")) return `${f.name}: completion photos must be pictures`;
  return uploadProblem(f);
}

/**
 * Store completion photos one by one. A photo that fails is named in a toast
 * and never undoes the request or payment it was meant for. Returns how many
 * were stored.
 */
export async function attachCompletionPhotos(target: PhotoTarget, picked: File[]): Promise<number> {
  let ok = 0;
  for (const f of picked) {
    const problem = photoProblem(f);
    if (problem) {
      toast.error(problem);
      continue;
    }
    try {
      const form = await uploadForm(f, target as Record<string, string>);
      await fetchJson("/api/files", { method: "POST", body: form });
      ok += 1;
    } catch (e) {
      toast.error(`${f.name}: ${(e as Error).message || "upload failed"}`);
    }
  }
  return ok;
}

/**
 * Optional completion photos inside a dialog: choose from the library or take
 * one with the phone's camera; chips with a remove button. Nothing is sent
 * until the request or payment is saved.
 */
export function CompletionPhotoPicker({
  files,
  onChange,
  existing = [],
}: {
  files: File[];
  onChange: (files: File[]) => void;
  /** Photos already on the request this payment settles, shown for reference. */
  existing?: CompletionPhoto[];
}) {
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<number | null>(null);

  function take(list: FileList | null) {
    // Snapshot before the input is cleared: in Chrome the FileList is live.
    const picked = Array.from(list ?? []);
    if (pickRef.current) pickRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
    const good = picked.filter((f) => {
      const problem = photoProblem(f);
      if (problem) toast.error(problem);
      return !problem;
    });
    if (good.length) onChange([...files, ...good]);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">Completion photos (optional)</span>
        <span className="flex gap-1">
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => pickRef.current?.click()}>
            <ImagePlus className="size-3.5" /> Add photos
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs sm:hidden" onClick={() => cameraRef.current?.click()}>
            <Camera className="size-3.5" /> Take photo
          </Button>
        </span>
      </div>
      {existing.length > 0 && (
        <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => setPreview(0)}>
          {existing.length} photo{existing.length === 1 ? "" : "s"} sent with the request — view
        </button>
      )}
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex max-w-full items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2 pr-1 text-[11px]">
              <Camera className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:bg-gray-200 hover:text-foreground"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground">Pictures of the finished work. They go on the job&apos;s Project photos too.</p>
      )}
      <input ref={pickRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => take(e.target.files)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => take(e.target.files)} />
      <FilePreviewDialog files={existing} index={preview} onIndexChange={setPreview} />
    </div>
  );
}

/**
 * The photo count on a request or payment row: opens the photos, and — for
 * someone allowed to — adds more.
 */
export function CompletionPhotosButton({
  photos,
  target,
  canAdd,
  onChanged,
}: {
  photos: CompletionPhoto[];
  target: PhotoTarget;
  canAdd: boolean;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const missing = photos.some((p) => p.missing);

  if (photos.length === 0 && !canAdd) return null;
  return (
    <>
      {photos.length > 0 ? (
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-gray-100 ${missing ? "text-amber-700" : "text-muted-foreground"}`}
          title={missing ? "A photo's file is missing — open it to upload it again" : "Open the completion photos"}
          aria-label={`${photos.length} completion photo${photos.length === 1 ? "" : "s"}`}
          onClick={() => setPreview(0)}
        >
          <Camera className="size-3.5" />
          {photos.length}
        </button>
      ) : null}
      {canAdd && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-gray-100 hover:text-foreground"
          title="Add completion photos"
          aria-label="Add completion photos"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus className="size-3.5" />
          {busy ? "Adding…" : photos.length === 0 ? "Photos" : null}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (picked.length === 0) return;
          setBusy(true);
          const n = await attachCompletionPhotos(target, picked);
          setBusy(false);
          if (n > 0) {
            toast.success(`${n} photo${n === 1 ? "" : "s"} added`);
            onChanged();
          }
        }}
      />
      <FilePreviewDialog files={photos} index={preview} onIndexChange={setPreview} onChanged={onChanged} />
    </>
  );
}
