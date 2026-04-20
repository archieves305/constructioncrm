"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Image as ImageIcon,
  Download,
  Trash2,
  Upload,
  Camera,
} from "lucide-react";

const CATEGORIES = [
  "PHOTOS",
  "ESTIMATE",
  "PERMIT",
  "SIGNED_DOC",
  "INSURANCE",
  "INSPECTION",
  "OTHER",
] as const;
type Category = (typeof CATEGORIES)[number];

type FileRecord = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  category: Category;
  createdAt: string;
  uploadedBy: { firstName: string; lastName: string };
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesPanel({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<Category>("OTHER");
  const [uploadingCount, setUploadingCount] = useState(0);

  const { data: files = [], isLoading } = useQuery<FileRecord[]>({
    queryKey: ["lead-files", leadId],
    queryFn: () =>
      fetch(`/api/files?leadId=${leadId}`).then((r) => r.json()),
  });

  const uploadOne = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("leadId", leadId);
      form.append("category", category);
      const res = await fetch("/api/files", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      return res.json();
    },
  });

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setUploadingCount(files.length);

    let ok = 0;
    let failed = 0;
    for (const f of files) {
      try {
        await uploadOne.mutateAsync(f);
        ok += 1;
      } catch (e) {
        failed += 1;
        toast.error(`${f.name}: ${(e as Error).message}`);
      }
    }
    setUploadingCount(0);
    if (ok > 0) toast.success(`Uploaded ${ok} file${ok === 1 ? "" : "s"}`);
    queryClient.invalidateQueries({ queryKey: ["lead-files", leadId] });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (failed === 0 && ok === 0) {
      // No files were valid
    }
  }

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("File deleted");
      queryClient.invalidateQueries({ queryKey: ["lead-files", leadId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploading = uploadingCount > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 min-w-0 space-y-1 sm:max-w-xs">
          <label className="text-xs text-muted-foreground">Category</label>
          <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string) => (v ? v.replace("_", " ") : "OTHER")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1 sm:hidden"
            onClick={() => cameraInputRef.current?.click()}
            disabled={uploading}
          >
            <Camera className="mr-2 h-4 w-4" />
            Photo
          </Button>
          <Button
            type="button"
            className="flex-1 sm:flex-none"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploading
              ? `Uploading ${uploadingCount}…`
              : "Upload"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">Loading…</p>
      ) : files.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No files yet. Upload photos, estimates, signed docs, permits, etc.
        </p>
      ) : (
        <ul className="divide-y rounded border">
          {files.map((f) => {
            const isImage = f.fileType.startsWith("image/");
            return (
              <li
                key={f.id}
                className="flex items-center gap-3 p-3 text-sm"
              >
                <div className="text-muted-foreground">
                  {isImage ? (
                    <ImageIcon className="h-5 w-5" />
                  ) : (
                    <FileText className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{f.fileName}</div>
                  <div className="text-xs text-muted-foreground">
                    {f.category.replace("_", " ")} · {formatSize(f.fileSize)} ·{" "}
                    {f.uploadedBy.firstName} {f.uploadedBy.lastName} ·{" "}
                    {format(new Date(f.createdAt), "MMM d, yyyy")}
                  </div>
                </div>
                <a
                  href={`/api/files/${f.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded p-2 text-muted-foreground hover:bg-gray-100 hover:text-foreground"
                  title="Open"
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  className="rounded p-2 text-muted-foreground hover:bg-red-50 hover:text-destructive"
                  onClick={() => {
                    if (confirm(`Delete "${f.fileName}"?`)) remove.mutate(f.id);
                  }}
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
