import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

export type StoredFile = {
  storageKey: string;
  bytes: number;
};

export async function saveFile(buffer: Buffer, originalName: string): Promise<StoredFile> {
  const ext = path.extname(originalName).toLowerCase().slice(0, 10);
  const safeExt = /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : "";
  const subdir = new Date().toISOString().slice(0, 7);
  const dir = path.join(UPLOAD_ROOT, subdir);
  await fs.mkdir(dir, { recursive: true });

  const token = randomBytes(16).toString("hex");
  const filename = `${token}${safeExt}`;
  const absPath = path.join(dir, filename);
  await fs.writeFile(absPath, buffer, { mode: 0o600 });

  return {
    storageKey: path.posix.join(subdir, filename),
    bytes: buffer.byteLength,
  };
}

export function resolveStoragePath(storageKey: string): string {
  const absolute = path.resolve(UPLOAD_ROOT, storageKey);
  if (!absolute.startsWith(UPLOAD_ROOT + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return absolute;
}

export async function readFile(storageKey: string): Promise<Buffer> {
  return fs.readFile(resolveStoragePath(storageKey));
}

export async function deleteFile(storageKey: string): Promise<void> {
  await fs.unlink(resolveStoragePath(storageKey)).catch(() => {});
}
