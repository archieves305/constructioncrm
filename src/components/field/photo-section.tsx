"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Camera, CloudUpload, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { newEntryId } from "@/lib/labor/ids";
import { downscalePhoto } from "@/lib/photo-utils";
import {
  dequeuePhoto,
  enqueuePhoto,
  listQueuedPhotos,
  type QueuedPhoto,
} from "@/lib/field-store";

export const PHOTO_CATEGORIES: [string, string][] = [
  ["PROGRESS", "Progress"],
  ["BEFORE", "Before"],
  ["AFTER", "After"],
  ["ISSUE", "Issue"],
  ["DAMAGE", "Damage"],
  ["SAFETY", "Safety"],
  ["MATERIAL_DELIVERY", "Material delivery"],
  ["INSPECTION", "Inspection"],
  ["CHANGE_ORDER", "Change order"],
  ["OTHER", "Other"],
];

type UploadedPhoto = {
  id: string;
  photoDate: string;
  category: string;
  caption: string | null;
  areaText: string | null;
  fileName: string;
};

type PendingState = QueuedPhoto & {
  status: "queued" | "uploading" | "failed";
  previewUrl: string;
};

export function PhotoSection({
  jobId,
  date,
  dailyLogId,
  editable,
  defaultCategory = "PROGRESS",
}: {
  jobId: string;
  date: string;
  dailyLogId: string | null;
  editable: boolean;
  defaultCategory?: string;
}) {
  const qc = useQueryClient();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const draining = useRef(false);

  const [pending, setPending] = useState<PendingState[]>([]);
  const [tagOpen, setTagOpen] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [tagCategory, setTagCategory] = useState(defaultCategory);
  const [tagCaption, setTagCaption] = useState("");
  const [tagArea, setTagArea] = useState("");

  const { data: uploaded } = useQuery<{ photos: UploadedPhoto[] }>({
    queryKey: ["day-photos", jobId, date],
    queryFn: () =>
      fetch(`/api/jobs/${jobId}/photos?from=${date}&to=${date}`).then((r) =>
        r.json(),
      ),
  });

  // Restore any queue survivors from a previous session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const survivors = await listQueuedPhotos(jobId, date);
      if (cancelled || survivors.length === 0) return;
      setPending((prev) => {
        const known = new Set(prev.map((p) => p.id));
        const fresh = survivors
          .filter((s) => !known.has(s.id))
          .map((s) => ({
            ...s,
            status: "queued" as const,
            previewUrl: URL.createObjectURL(s.blob),
          }));
        return [...prev, ...fresh];
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, date]);

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      // Sequential: one in-flight upload bounds memory and battery.
      for (;;) {
        const next = await new Promise<PendingState | null>((resolve) => {
          setPending((prev) => {
            resolve(prev.find((p) => p.status !== "uploading") ?? null);
            return prev;
          });
        });
        if (!next || !navigator.onLine) break;

        setPending((prev) =>
          prev.map((p) => (p.id === next.id ? { ...p, status: "uploading" } : p)),
        );
        try {
          const fd = new FormData();
          fd.append("file", next.blob, next.fileName);
          fd.append("id_0", next.id);
          fd.append("photoDate", next.date);
          fd.append("category", next.category);
          if (next.caption) fd.append("caption", next.caption);
          if (next.areaText) fd.append("areaText", next.areaText);
          if (next.dailyLogId) fd.append("dailyLogId", next.dailyLogId);

          const res = await fetch(`/api/jobs/${jobId}/photos`, {
            method: "POST",
            body: fd,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `upload failed (${res.status})`);
          }
          await dequeuePhoto(next.id);
          setPending((prev) => {
            const gone = prev.find((p) => p.id === next.id);
            if (gone) URL.revokeObjectURL(gone.previewUrl);
            return prev.filter((p) => p.id !== next.id);
          });
          qc.invalidateQueries({ queryKey: ["day-photos", jobId, date] });
          qc.invalidateQueries({ queryKey: ["job-photos", jobId] });
        } catch (err) {
          setPending((prev) =>
            prev.map((p) => (p.id === next.id ? { ...p, status: "failed" } : p)),
          );
          if (err instanceof Error && !err.message.includes("fetch")) {
            toast.error(`${next.fileName}: ${err.message}`);
          }
          break; // stop draining; retry on reconnect/tap
        }
      }
    } finally {
      draining.current = false;
    }
  }, [jobId, date, qc]);

  useEffect(() => {
    if (pending.some((p) => p.status === "queued")) void drain();
    const retry = () => void drain();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [pending, drain]);

  const onFilesPicked = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setStagedFiles(Array.from(files));
    setTagCategory(defaultCategory);
    setTagCaption("");
    setTagArea("");
    setTagOpen(true);
  };

  const confirmStaged = async () => {
    setTagOpen(false);
    const files = stagedFiles;
    setStagedFiles([]);
    for (const file of files) {
      // Sequential downscale keeps decode memory bounded on iPad.
      const prepared = await downscalePhoto(file);
      const item: QueuedPhoto = {
        id: newEntryId(),
        jobId,
        date,
        dailyLogId,
        blob: prepared.blob,
        fileName: prepared.fileName,
        category: tagCategory,
        caption: tagCaption.trim() || null,
        areaText: tagArea.trim() || null,
        createdAt: Date.now(),
        attempts: 0,
      };
      await enqueuePhoto(item);
      setPending((prev) => [
        ...prev,
        { ...item, status: "queued", previewUrl: URL.createObjectURL(item.blob) },
      ]);
    }
  };

  const removePending = async (id: string) => {
    await dequeuePhoto(id);
    setPending((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const photos = uploaded?.photos ?? [];
  const categoryLabel = (value: string) =>
    PHOTO_CATEGORIES.find(([v]) => v === value)?.[1] ?? value;

  return (
    <div className="space-y-3">
      {editable && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-14 flex-1 text-base"
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="mr-2 h-5 w-5" /> Camera
          </Button>
          <Button
            variant="outline"
            className="h-14 flex-1 text-base"
            onClick={() => libraryRef.current?.click()}
          >
            <ImagePlus className="mr-2 h-5 w-5" /> Library
          </Button>
          {/* iOS: capture forces the camera and blocks the library, so two inputs */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              onFilesPicked(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={libraryRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onFilesPicked(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {pending.length > 0 && (
        <Card>
          <CardContent className="space-y-2 py-3">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <CloudUpload className="h-4 w-4" />
              {pending.length} photo{pending.length === 1 ? "" : "s"} uploading…
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {pending.map((p) => (
                <div key={p.id} className="relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.previewUrl}
                    alt=""
                    className={cn(
                      "h-full w-full rounded-md object-cover",
                      p.status !== "uploading" && "opacity-70",
                    )}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    {p.status === "uploading" ? (
                      <Loader2 className="h-5 w-5 animate-spin text-white drop-shadow" />
                    ) : p.status === "failed" ? (
                      <button
                        type="button"
                        className="rounded bg-red-600/90 px-1.5 py-0.5 text-xs text-white"
                        onClick={() => drain()}
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                  {p.status !== "uploading" && (
                    <button
                      type="button"
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-gray-800 p-1 text-white"
                      onClick={() => removePending(p.id)}
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {photos.length === 0 && pending.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            No photos for this day yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <a
              key={photo.id}
              href={`/api/photos/${photo.id}/raw`}
              target="_blank"
              rel="noreferrer"
              className="group relative aspect-square"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/photos/${photo.id}/raw`}
                alt={photo.caption ?? photo.fileName}
                loading="lazy"
                className="h-full w-full rounded-md object-cover"
              />
              <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
                {categoryLabel(photo.category)}
              </span>
            </a>
          ))}
        </div>
      )}

      {/* Batch tag dialog */}
      <Dialog open={tagOpen} onOpenChange={(o) => !o && setTagOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Tag {stagedFiles.length} photo{stagedFiles.length === 1 ? "" : "s"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <span className="mb-1 block text-sm font-medium">Category</span>
              <Select value={tagCategory} onValueChange={(v) => v && setTagCategory(v)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PHOTO_CATEGORIES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium">
                Area / room (optional)
              </span>
              <Input
                value={tagArea}
                onChange={(e) => setTagArea(e.target.value)}
                placeholder="e.g. Room 214"
                style={{ fontSize: 16 }}
              />
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium">
                Caption (optional)
              </span>
              <Input
                value={tagCaption}
                onChange={(e) => setTagCaption(e.target.value)}
                placeholder="Applied to all selected photos"
                style={{ fontSize: 16 }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setTagOpen(false);
                  setStagedFiles([]);
                }}
              >
                Cancel
              </Button>
              <Button onClick={() => void confirmStaged()}>Add photos</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
