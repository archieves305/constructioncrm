import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, fileExists, saveFile } from "@/lib/files/storage";
import { canEditFile, fileReadWhere, permitLockOf } from "@/lib/files/access";
import { contentMatchesType } from "@/lib/files/sniff";
import { FILE_LIST_INCLUDE, presentFiles } from "@/lib/files/list";
import { recordAudit } from "@/lib/audit/record";
import { indexPermitFileText } from "@/lib/permit-intel/library";

/**
 * "Upload again": put a new file onto a record whose data is gone from the
 * store. The record keeps its id, category, job and links; only what is stored
 * changes. Refused while the original is still there — replacing a document
 * that exists would swap evidence silently — and for anything the CRM
 * generated.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const existing = await prisma.file.findFirst({ where: { AND: [{ id }, fileReadWhere(session.user)] }, include: { _count: { select: { generatedDocuments: true, permitSubmissions: true } } } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const verdict = canEditFile(session.user, {
    ...existing,
    generated: existing._count.generatedDocuments > 0,
    permitLock: permitLockOf({ permitDocType: existing.permitDocType, permitSubmissionCount: existing._count.permitSubmissions }),
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 403 });
  if (await fileExists(existing.storageKey)) {
    return NextResponse.json({ error: "This file is not missing. Delete it and upload the new one if it should be replaced." }, { status: 409 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return badRequest("file is required");
  if (file.size === 0) return badRequest("file is empty");
  if (file.size > MAX_UPLOAD_BYTES) return badRequest(`file exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
  if (!ALLOWED_MIME.has(file.type)) return badRequest(`unsupported file type: ${file.type || "unknown"}`);

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!contentMatchesType(file.type, buffer.subarray(0, 8192))) return badRequest(`${file.name} is not a real ${file.type} file`);
  const stored = await saveFile(buffer, file.name);
  const updated = await prisma.file.update({
    where: { id },
    // the text read from the old bytes no longer describes the file
    data: { storageKey: stored.storageKey, fileName: file.name, fileType: file.type, fileSize: stored.bytes, extractedText: null },
    include: FILE_LIST_INCLUDE,
  });
  await recordAudit({
    actorUserId: session.user.id,
    entityType: "File",
    entityId: id,
    action: "file_replace",
    before: { fileName: existing.fileName, fileType: existing.fileType, fileSize: existing.fileSize, storageKey: existing.storageKey },
    after: { fileName: updated.fileName, fileType: updated.fileType, fileSize: updated.fileSize, storageKey: stored.storageKey },
  });
  if (updated.permitId && updated.fileType === "application/pdf") after(() => indexPermitFileText(id));
  return NextResponse.json((await presentFiles([updated]))[0]);
}
