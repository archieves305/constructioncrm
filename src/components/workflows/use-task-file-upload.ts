"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { taskKeys } from "@/components/tasks/use-tasks";

/**
 * Attach a file to a task. One hook for every place a step can take a file —
 * the task sheet, the Complete dialog and the field task page — so they all
 * store it the same way and refresh the same views.
 */
export function useTaskFileUpload(taskId: string | null | undefined, opts: { photo?: boolean; onDone?: () => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      if (!taskId) throw new Error("No task to attach to");
      const form = new FormData();
      form.append("file", file);
      form.append("taskId", taskId);
      form.append("category", opts.photo || file.type.startsWith("image/") ? "PHOTOS" : "OTHER");
      const r = await fetch("/api/files", { method: "POST", body: form });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      return r.json();
    },
    onSuccess: () => {
      if (taskId) qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      qc.invalidateQueries({ queryKey: ["job-workflow"] });
      qc.invalidateQueries({ queryKey: ["case-workflow"] });
      toast.success("File attached");
      opts.onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
