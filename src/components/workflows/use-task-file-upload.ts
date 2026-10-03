"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { taskKeys } from "@/components/tasks/use-tasks";
import { downscalePhoto } from "@/lib/photo-utils";

/**
 * A photo is downscaled before it is sent (2000 px, JPEG — the same treatment
 * daily-log photos get); anything else goes as it is. A GIF keeps its frames.
 */
export async function preparedUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  const prepared = await downscalePhoto(file);
  return prepared.converted ? new File([prepared.blob], prepared.fileName, { type: "image/jpeg" }) : file;
}

/** The one request that stores a file against a task. Throws with the server's reason. */
export async function uploadTaskFile(taskId: string, picked: File, opts: { photo?: boolean } = {}) {
  // A phone photo is 3–8 MB; the job gallery and jobsite LTE want ~500 KB.
  const file = await preparedUpload(picked);
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
}

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
      return uploadTaskFile(taskId, file, { photo: opts.photo });
    },
    onSuccess: () => {
      if (taskId) qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      qc.invalidateQueries({ queryKey: ["job-workflow"] });
      qc.invalidateQueries({ queryKey: ["case-workflow"] });
      // A photo on a job's task shows in that job's gallery and files.
      qc.invalidateQueries({ queryKey: ["job-photos"] });
      qc.invalidateQueries({ queryKey: ["job-files"] });
      toast.success("File attached");
      opts.onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
