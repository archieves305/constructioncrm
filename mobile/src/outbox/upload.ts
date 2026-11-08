import { File, UploadType } from "expo-file-system";
import { APP_VERSION, CRM_URL } from "@/config";
import { ApiError } from "@/api/client";
import { readToken } from "@/auth/storage";

export type UploadBody = {
  /** The queued JPEG in the app's own folder. */
  filePath: string;
  /** Form fields for POST /api/files: jobId / taskId, category, takenAt. */
  fields: Record<string, string>;
};

/**
 * Send one queued photo to POST /api/files as multipart, with the same
 * headers as every other request. On iOS the transfer runs in a background
 * session, so it carries on if the phone locks. Errors come back as ApiError,
 * exactly as from api().
 */
export async function sendUpload(body: UploadBody, idempotencyKey: string, path = "/api/files"): Promise<unknown> {
  const token = await readToken();
  if (!token) throw new ApiError("Signed out. Please sign in again.", 401, "signed_out");
  const file = new File(body.filePath);
  if (!file.exists) throw new ApiError("The photo is no longer on this phone", 410, "file_missing");

  let res: { status: number; body: string };
  try {
    res = await file.upload(`${CRM_URL}${path}`, {
      httpMethod: "POST",
      uploadType: UploadType.MULTIPART,
      fieldName: "file",
      mimeType: "image/jpeg",
      parameters: body.fields,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "X-App-Version": APP_VERSION,
        "Idempotency-Key": idempotencyKey,
      },
    });
  } catch {
    throw new ApiError("No connection to the CRM", 0, "offline");
  }

  let data: unknown = null;
  try {
    data = res.body ? JSON.parse(res.body) : null;
  } catch {
    data = null;
  }
  if (res.status === 401 || (res.status >= 300 && res.status < 400)) {
    throw new ApiError("Signed out. Please sign in again.", 401, "signed_out");
  }
  if (res.status < 200 || res.status >= 300) {
    const b = (data ?? {}) as { error?: unknown; code?: unknown };
    throw new ApiError(
      typeof b.error === "string" ? b.error : `The CRM answered ${res.status}`,
      res.status,
      typeof b.code === "string" ? b.code : undefined,
      data,
    );
  }
  return data;
}
