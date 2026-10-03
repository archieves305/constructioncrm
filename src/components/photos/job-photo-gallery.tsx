"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, ImageOff, Trash2, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { downscalePhoto } from "@/lib/photo-utils";
import { filterGallery, type GalleryItem, type GallerySource } from "@/lib/photos/gallery";
import { PHOTO_CATEGORIES } from "@/components/field/photo-section";

const SOURCES: { value: GallerySource | ""; label: string }[] = [
  { value: "", label: "All photos" },
  { value: "log", label: "Daily logs" },
  { value: "file", label: "Tasks and uploads" },
];

const categoryLabel = (value: string) => PHOTO_CATEGORIES.find(([v]) => v === value)?.[1] ?? value;
const longDay = (day: string) => format(new Date(`${day}T12:00:00`), "EEE, MMM d, yyyy");

/**
 * Every photo of a job in one place: daily-log photos and the images attached
 * to its tasks or uploaded to its files, newest first. Nothing is moved —
 * each photo stays where it was taken and says where that is.
 *
 * `readOnly` hides delete and upload-again — for the gallery shown on a
 * code-violation case, where the photos belong to the job.
 */
export function JobPhotoGallery({ jobId, readOnly = false }: { jobId: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const [source, setSource] = useState<GallerySource | "">("");
  const [category, setCategory] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [removing, setRemoving] = useState<GalleryItem | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const { data, isLoading, error, refetch } = useQuery<{ items: GalleryItem[]; canWrite: boolean }>({
    queryKey: ["job-photos", jobId, from, to],
    queryFn: () => fetchJson(`/api/jobs/${jobId}/gallery?${params.toString()}`),
    retry: retryServerErrors,
  });

  const all = data?.items ?? [];
  const photos = filterGallery(all, { source: source || null, category: category || null, missingOnly });
  const index = openKey ? photos.findIndex((p) => p.key === openKey) : -1;
  const current = index >= 0 ? photos[index] : null;
  const missingCount = all.filter((p) => p.missing).length;
  const canWrite = !readOnly && (data?.canWrite ?? false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["job-photos", jobId] });
    qc.invalidateQueries({ queryKey: ["job-files", jobId] });
  };

  const remove = useMutation({
    // A daily-log photo is deleted through its own route (an approved log locks it there).
    mutationFn: (p: GalleryItem) => fetchJson(p.source === "log" ? `/api/photos/${p.id}` : `/api/files/${p.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setRemoving(null);
      setOpenKey(null);
      refresh();
      toast.success("Photo deleted");
    },
    onError: (e: Error) => {
      setRemoving(null);
      toast.error(e.message);
    },
  });

  const replace = useMutation({
    mutationFn: async ({ p, picked }: { p: GalleryItem; picked: File }) => {
      const prepared = await downscalePhoto(picked);
      const form = new FormData();
      form.set("file", new File([prepared.blob], prepared.fileName, { type: prepared.converted ? "image/jpeg" : picked.type }));
      return fetchJson(p.source === "log" ? `/api/photos/${p.id}/replace` : `/api/files/${p.id}/replace`, { method: "POST", body: form });
    },
    onSuccess: () => {
      refresh();
      toast.success("Photo uploaded again");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {SOURCES.map((s) => (
          <Button key={s.value || "all"} size="sm" variant={source === s.value ? "default" : "outline"} onClick={() => setSource(s.value)}>
            {s.label}
            {s.value === "" && all.length > 0 ? ` · ${all.length}` : ""}
          </Button>
        ))}
        {missingCount > 0 && (
          <Button size="sm" variant={missingOnly ? "default" : "outline"} className={cn(!missingOnly && "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100")} onClick={() => setMissingOnly(!missingOnly)}>
            Missing · {missingCount}
          </Button>
        )}
        <div className="flex-1" />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" aria-label="From date" />
        <span className="text-sm text-muted-foreground">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" aria-label="To date" />
      </div>

      {source !== "file" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Daily-log category:</span>
          {PHOTO_CATEGORIES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={category === value}
              onClick={() => setCategory(category === value ? "" : value)}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs", category === value ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50")}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="aspect-square w-full" />)}
        </div>
      ) : error ? (
        <EmptyState icon={ImageOff} title="The photos could not be loaded" description={(error as Error).message} action={<Button variant="outline" onClick={() => refetch()}>Try again</Button>} />
      ) : all.length === 0 ? (
        <EmptyState icon={ImageOff} title="No photos yet" description="Photos taken on a daily log, attached to one of this job's tasks, or uploaded to its files all appear here." />
      ) : photos.length === 0 ? (
        <EmptyState icon={ImageOff} title="No photos match these filters" action={<Button variant="outline" onClick={() => { setSource(""); setCategory(""); setMissingOnly(false); }}>Clear filters</Button>} />
      ) : (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
          {photos.map((photo) => (
            <button key={photo.key} type="button" onClick={() => setOpenKey(photo.key)} className="group relative aspect-square overflow-hidden rounded-md" aria-label={`${photo.origin} — ${photo.fileName}`}>
              {photo.missing ? (
                <span className="flex size-full flex-col items-center justify-center gap-1 border border-dashed border-amber-300 bg-amber-50 text-amber-800">
                  <ImageOff className="size-5" />
                  <span className="text-[10px] font-medium">Photo missing</span>
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- an authenticated API response
                <img src={photo.url} alt={photo.caption ?? photo.fileName} loading="lazy" className="size-full object-cover" />
              )}
              <span className="absolute right-1 bottom-1 max-w-[90%] truncate rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
                {photo.source === "log" ? categoryLabel(photo.category ?? "") : photo.taskId ? "Task" : "Uploaded"}
              </span>
            </button>
          ))}
        </div>
      )}

      <Dialog open={current !== null} onOpenChange={(o) => !o && setOpenKey(null)}>
        <DialogContent className="max-w-3xl">
          {current && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8 text-base">
                  {longDay(current.day)}
                  {current.category ? ` · ${categoryLabel(current.category)}` : ""}
                  {current.area ? ` · ${current.area}` : ""}
                </DialogTitle>
              </DialogHeader>
              <div className="relative">
                {current.missing ? (
                  <div className="flex min-h-[16rem] flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-gray-50 px-6 py-10 text-center">
                    <ImageOff className="size-8 text-amber-600" />
                    <p className="text-sm font-medium">This photo is missing</p>
                    <p className="max-w-md text-sm text-muted-foreground">
                      The record is kept, but the stored image is gone. If you still have the photo, upload it again and it will sit on this same record.
                    </p>
                    {canWrite && (
                      <>
                        <input
                          ref={input}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const picked = e.target.files?.[0];
                            e.target.value = "";
                            if (picked) replace.mutate({ p: current, picked });
                          }}
                        />
                        <Button className="mt-1" onClick={() => input.current?.click()} disabled={replace.isPending}>
                          <Upload className="mr-2 size-4" />
                          {replace.isPending ? "Uploading…" : "Upload again"}
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- an authenticated API response
                  <img src={current.url} alt={current.caption ?? current.fileName} className="max-h-[65vh] w-full rounded-md object-contain" />
                )}
                {index > 0 && (
                  <button type="button" onClick={() => setOpenKey(photos[index - 1].key)} className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white" aria-label="Previous">
                    <ChevronLeft className="size-5" />
                  </button>
                )}
                {index < photos.length - 1 && (
                  <button type="button" onClick={() => setOpenKey(photos[index + 1].key)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white" aria-label="Next">
                    <ChevronRight className="size-5" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  {current.caption && <p className="truncate">{current.caption}</p>}
                  <p className="text-muted-foreground">
                    {current.origin} · by {current.by.firstName} {current.by.lastName}
                  </p>
                </div>
                {current.href && (
                  <Link href={current.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    {current.source === "log" ? "Open log" : current.taskId ? "Open task" : "Open files"}
                  </Link>
                )}
                {!current.missing && (
                  <a href={current.source === "file" ? `${current.url}?download=1` : current.url} download={current.fileName} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label="Download">
                    <Download className="size-4" />
                  </a>
                )}
                {canWrite && (
                  <Button variant="outline" size="sm" aria-label="Delete photo" onClick={() => setRemoving(current)}>
                    <Trash2 className="size-4 text-red-500" />
                  </Button>
                )}
              </div>
              <Badge variant="secondary" className="w-fit">
                {index + 1} of {photos.length}
              </Badge>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this photo?"
        description={removing ? `${removing.origin} — it will be removed for everyone. This cannot be undone.` : undefined}
        tone="danger"
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing);
        }}
      />
    </div>
  );
}
