import { Directory, File, Paths } from "expo-file-system";
import type { FileItemDto } from "@crm/mobile-api";
import { APP_VERSION, CRM_URL } from "@/config";
import { ApiError } from "@/api/client";
import { readToken } from "@/auth/storage";

/**
 * Open a CRM file on the phone: download it once with the session token into
 * the app's cache, then hand it to the phone's own viewer (Quick Look on an
 * iPhone, the PDF / image app on Android) with pinch-zoom, search and share.
 * A document opened before opens again without signal. Sign-out deletes the
 * folder.
 */

const DOCS = () => new Directory(Paths.cache, "docs");

function safeName(name: string): string {
  return name.replace(/[/\\:*?"<>|]+/g, "-").slice(0, 120) || "file";
}

function localCopy(file: Pick<FileItemDto, "id" | "fileName">): File {
  const dir = new Directory(DOCS(), file.id);
  if (!dir.exists) dir.create({ intermediates: true });
  return new File(dir, safeName(file.fileName));
}

export function isOnPhone(file: Pick<FileItemDto, "id" | "fileName">): boolean {
  try {
    return localCopy(file).exists;
  } catch {
    return false;
  }
}

export async function openDocument(file: Pick<FileItemDto, "id" | "fileName" | "fileType">): Promise<void> {
  const dest = localCopy(file);
  if (!dest.exists) {
    const token = await readToken();
    if (!token) throw new ApiError("Signed out. Please sign in again.", 401, "signed_out");
    const tmp = new File(dest.parentDirectory, `${dest.name}.part`);
    try {
      const task = File.createDownloadTask(`${CRM_URL}/api/files/${encodeURIComponent(file.id)}`, tmp, {
        headers: { Authorization: `Bearer ${token}`, "X-App-Version": APP_VERSION },
      });
      await task.downloadAsync();
    } catch {
      if (tmp.exists) tmp.delete();
      throw new ApiError("Couldn't download it. Check your signal and try again.", 0, "offline");
    }
    // A refusal comes back as a small JSON or HTML page, not the document.
    // (The download task reports no HTTP status. A CRM error is a few hundred
    // bytes, so only small files are read to tell the two apart.)
    const textual = /json|html|xml|svg|text\//.test(file.fileType);
    const looksLikeError = !textual && tmp.exists && tmp.size < 8192 && /^\s*[{<]/.test(tmp.textSync());
    if (!tmp.exists || tmp.size === 0 || looksLikeError) {
      if (tmp.exists) tmp.delete();
      throw new ApiError("The CRM didn't send this file. It may have been removed, or you may not have access.", 404, "not_found");
    }
    tmp.move(dest);
  }
  await dest.preview({ mimeType: file.fileType, title: file.fileName });
}

/** Sign-out: remove every document kept on the phone. */
export function deleteAllDocuments(): void {
  try {
    const d = DOCS();
    if (d.exists) d.delete();
  } catch {
    // Nothing kept.
  }
}
