"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Download, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PHOTO_CATEGORIES } from "@/components/field/photo-section";

type GalleryPhoto = {
  id: string;
  photoDate: string;
  category: string;
  caption: string | null;
  areaText: string | null;
  fileName: string;
  dailyLogId: string | null;
  jobArea: { id: string; name: string } | null;
  takenBy: { firstName: string; lastName: string };
};

export function JobPhotoGallery({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  params.set("take", "120");

  const { data, isLoading } = useQuery<{ photos: GalleryPhoto[] }>({
    queryKey: ["job-photos", jobId, category, from, to],
    queryFn: () =>
      fetch(`/api/jobs/${jobId}/photos?${params.toString()}`).then((r) => r.json()),
  });

  const photos = data?.photos ?? [];
  const current = lightboxIndex != null ? photos[lightboxIndex] : null;

  const deletePhoto = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/photos/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Delete failed");
    },
    onSuccess: () => {
      setLightboxIndex(null);
      qc.invalidateQueries({ queryKey: ["job-photos", jobId] });
      toast.success("Photo deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const categoryLabel = (value: string) =>
    PHOTO_CATEGORIES.find(([v]) => v === value)?.[1] ?? value;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={category === "" ? "default" : "outline"}
          onClick={() => setCategory("")}
        >
          All
        </Button>
        {PHOTO_CATEGORIES.map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={category === value ? "default" : "outline"}
            onClick={() => setCategory(category === value ? "" : value)}
          >
            {label}
          </Button>
        ))}
        <div className="flex-1" />
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-36"
        />
        <span className="text-muted-foreground text-sm">to</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-36"
        />
      </div>

      {isLoading ? (
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      ) : photos.length === 0 ? (
        <div className="text-muted-foreground rounded-md border py-12 text-center">
          No photos match these filters.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setLightboxIndex(i)}
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
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={current !== null}
        onOpenChange={(o) => !o && setLightboxIndex(null)}
      >
        <DialogContent className="max-w-3xl">
          {current && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">
                  {format(new Date(`${current.photoDate}T12:00:00`), "EEE, MMM d, yyyy")}
                  {" · "}
                  {categoryLabel(current.category)}
                  {current.areaText || current.jobArea
                    ? ` · ${current.jobArea?.name ?? current.areaText}`
                    : ""}
                </DialogTitle>
              </DialogHeader>
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/photos/${current.id}/raw`}
                  alt={current.caption ?? current.fileName}
                  className="max-h-[65vh] w-full rounded-md object-contain"
                />
                {lightboxIndex! > 0 && (
                  <button
                    type="button"
                    onClick={() => setLightboxIndex(lightboxIndex! - 1)}
                    className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white"
                    aria-label="Previous"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                )}
                {lightboxIndex! < photos.length - 1 && (
                  <button
                    type="button"
                    onClick={() => setLightboxIndex(lightboxIndex! + 1)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white"
                    aria-label="Next"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                )}
              </div>
              <div className={cn("flex items-center gap-3 text-sm")}>
                <div className="min-w-0 flex-1">
                  {current.caption && <p className="truncate">{current.caption}</p>}
                  <p className="text-muted-foreground">
                    By {current.takenBy.firstName} {current.takenBy.lastName}
                  </p>
                </div>
                {current.dailyLogId && (
                  <Link href={`/jobs/${jobId}/daily-logs/${current.photoDate}`}>
                    <Button variant="outline" size="sm">
                      Open log
                    </Button>
                  </Link>
                )}
                <a href={`/api/photos/${current.id}/raw`} download={current.fileName}>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4" />
                  </Button>
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (confirm("Delete this photo?")) deletePhoto.mutate(current.id);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
              <Badge variant="secondary" className="w-fit">
                {lightboxIndex! + 1} of {photos.length}
              </Badge>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
