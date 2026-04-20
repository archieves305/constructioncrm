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
import { FileText, Image as ImageIcon, Download, Trash2, Upload } from "lucide-react";

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

export function LeadFiles({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<Category>("OTHER");

  const { data: files = [], isLoading } = useQuery<FileRecord[]>({
    queryKey: ["lead-files", leadId],
    queryFn: () =>
      fetch(`/api/files?leadId=${leadId}`).then((r) => r.json()),
  });

  const upload = useMutation({
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
    onSuccess: () => {
      toast.success("File uploaded");
      queryClient.invalidateQueries({ queryKey: ["lead-files", leadId] });
      if (inputRef.current) inputRef.current.value = "";
    },
    onError: (e: Error) => toast.error(e.message),
  });

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

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) upload.mutate(f);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="flex-1 max-w-xs space-y-1">
          <label className="text-xs text-muted-foreground">Category</label>
          <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
            <SelectTrigger>
              <SelectValue />
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
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={onFileChange}
        />
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
        >
          <Upload className="mr-2 h-4 w-4" />
          {upload.isPending ? "Uploading..." : "Upload"}
        </Button>
      </div>

      {isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">Loading…</p>
      ) : files.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No files yet. Upload estimates, photos, signed docs, permits, etc.
        </p>
      ) : (
        <ul className="divide-y rounded border">
          {files.map((f) => {
            const isImage = f.fileType.startsWith("image/");
            return (
              <li key={f.id} className="flex items-center gap-3 p-3">
                <div className="text-muted-foreground">
                  {isImage ? (
                    <ImageIcon className="h-5 w-5" />
                  ) : (
                    <FileText className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{f.fileName}</div>
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
                  className="text-muted-foreground hover:text-foreground"
                  title="Open"
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
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
