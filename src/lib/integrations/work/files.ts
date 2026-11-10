import { prisma } from "@/lib/db/prisma";
import { fileExists, readFile } from "@/lib/files/storage";
import { SOURCE_KEY_PREFIX, WorkApiError } from "./service";

/**
 * Photos on a task CareyOS Work created (2026-11-10, "Send to KNU"): when KNU
 * finishes, Work copies the crew's photos onto the Buildium item. Read-only,
 * and only for Work's own tasks — any other task answers 404, as if it were
 * not there. Photos and PDFs only; a file missing on disk is left out.
 */

export const WORK_FILE_LIMITS = { files: 20, bytes: 10 * 1024 * 1024 };
const COPYABLE = /^(image\/(jpeg|png|gif|webp|heic|heif)|application\/pdf)$/;

export type WorkTaskFile = {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  takenAt: string | null;
  createdAt: string;
};

async function workTask(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, sourceKey: true } });
  if (!task || !task.sourceKey?.startsWith(SOURCE_KEY_PREFIX)) throw new WorkApiError(404, "Task not found.");
  return task;
}

/** The task's photos and PDFs, oldest first. */
export async function taskFilesForWork(taskId: string): Promise<WorkTaskFile[]> {
  await workTask(taskId);
  const rows = await prisma.file.findMany({
    where: { taskId },
    select: { id: true, fileName: true, fileType: true, fileSize: true, storageKey: true, takenAt: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const out: WorkTaskFile[] = [];
  for (const f of rows) {
    if (!COPYABLE.test(f.fileType) || f.fileSize > WORK_FILE_LIMITS.bytes) continue;
    if (!(await fileExists(f.storageKey))) continue;
    out.push({
      fileId: f.id,
      fileName: f.fileName,
      fileType: f.fileType,
      fileSize: f.fileSize,
      takenAt: f.takenAt?.toISOString() ?? null,
      createdAt: f.createdAt.toISOString(),
    });
    if (out.length >= WORK_FILE_LIMITS.files) break;
  }
  return out;
}

/** One of those files' bytes. */
export async function taskFileForWork(taskId: string, fileId: string): Promise<{ bytes: Buffer; fileType: string; fileName: string }> {
  await workTask(taskId);
  const f = await prisma.file.findFirst({ where: { id: fileId, taskId }, select: { fileName: true, fileType: true, fileSize: true, storageKey: true } });
  if (!f || !COPYABLE.test(f.fileType) || f.fileSize > WORK_FILE_LIMITS.bytes) throw new WorkApiError(404, "File not found.");
  if (!(await fileExists(f.storageKey))) throw new WorkApiError(404, "File not found.");
  return { bytes: await readFile(f.storageKey), fileType: f.fileType, fileName: f.fileName };
}
