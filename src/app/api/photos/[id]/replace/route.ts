import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { badRequest, forbidden } from "@/lib/auth/helpers";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { MAX_UPLOAD_BYTES, fileExists, saveFile } from "@/lib/files/storage";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string }> };

const OFFICE = ["ADMIN", "MANAGER", "OFFICE_STAFF"];

/**
 * "Upload again" for a daily-log photo whose image is gone from the store.
 * The photo keeps its id, day, category, caption and log; only the stored
 * image changes. Refused while the original is still there. Putting back a
 * lost image is not an edit to the log, so an approved log does not lock it:
 * the person who took it or an office role may restore it.
 */
export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const photo = await prisma.fieldPhoto.findUnique({ where: { id }, select: { id: true, jobId: true, storageKey: true, fileName: true, fileSize: true, takenByUserId: true } });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ctx = await requireJobFieldAccess(photo.jobId, "write");
  if ("response" in ctx) return ctx.response;
  if (photo.takenByUserId !== ctx.session.user.id && !OFFICE.includes(ctx.session.user.role)) return forbidden();
  if (await fileExists(photo.storageKey)) {
    return NextResponse.json({ error: "This photo is not missing." }, { status: 409 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return badRequest("file is required");
  if (file.size === 0) return badRequest("file is empty");
  if (file.size > MAX_UPLOAD_BYTES) return badRequest(`file exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
  if (!file.type.startsWith("image/")) return badRequest("Only an image can replace a photo");

  const stored = await saveFile(Buffer.from(await file.arrayBuffer()), file.name);
  await prisma.fieldPhoto.update({ where: { id }, data: { storageKey: stored.storageKey, fileName: file.name, fileType: file.type, fileSize: stored.bytes } });
  await recordAudit({
    actorUserId: ctx.session.user.id,
    entityType: "FieldPhoto",
    entityId: id,
    action: "file_replace",
    before: { fileName: photo.fileName, fileSize: photo.fileSize, storageKey: photo.storageKey },
    after: { fileName: file.name, fileSize: stored.bytes, storageKey: stored.storageKey },
  });
  return NextResponse.json({ ok: true });
}
