import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Where uploads live. On the droplet `UPLOADS_DIR` points outside the app
 * folder (`/var/lib/knuco/uploads`): the app folder is replaced by every
 * deploy, and a store inside it was being wiped (2026-10-02). Unset, it falls
 * back to `./uploads` for local dev.
 */
const UPLOAD_ROOT = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(process.cwd(), "uploads");

export { MAX_UPLOAD_BYTES, ALLOWED_MIME } from "./limits";

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

/** Is the stored file still there? Never throws: a bad key is simply "no". */
export async function fileExists(storageKey: string): Promise<boolean> {
  try {
    await fs.access(resolveStoragePath(storageKey));
    return true;
  } catch {
    return false;
  }
}

export async function deleteFile(storageKey: string): Promise<void> {
  await fs.unlink(resolveStoragePath(storageKey)).catch(() => {});
}
