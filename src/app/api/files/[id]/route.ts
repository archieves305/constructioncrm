import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { readFile, deleteFile, fileExists } from "@/lib/files/storage";
import { canDeleteFile, canEditFile, fileReadWhere } from "@/lib/files/access";
import { FILE_LIST_INCLUDE, presentFiles } from "@/lib/files/list";
import { cleanFileName, UPLOAD_CATEGORIES } from "@/lib/files/scope";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string }> };

/** The file within the viewer's scope, with whether the CRM generated it. Outside the scope reads as "not found", so ids cannot be probed. */
async function loadFile(viewer: { id: string; role: Parameters<typeof fileReadWhere>[0]["role"] }, id: string) {
  const file = await prisma.file.findFirst({ where: { AND: [{ id }, fileReadWhere(viewer)] }, include: { _count: { select: { generatedDocuments: true } } } });
  return file ? { ...file, generated: file._count.generatedDocuments > 0 } : null;
}

export async function GET(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const file = await loadFile(session.user, id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // What the preview needs to know before it draws anything: is the data
  // still in the store, and may this person put it back or change the record?
  if (request.nextUrl.searchParams.get("meta") === "1") {
    return NextResponse.json({
      id: file.id,
      fileName: file.fileName,
      fileType: file.fileType,
      fileSize: file.fileSize,
      missing: !(await fileExists(file.storageKey)),
      generated: file.generated,
      canEdit: canEditFile(session.user, file).ok,
    });
  }

  const data = await readFile(file.storageKey).catch(() => null);
  if (!data) return NextResponse.json({ error: "Missing on disk" }, { status: 410 });

  const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  return new NextResponse(ab, {
    status: 200,
    headers: {
      "Content-Type": file.fileType || "application/octet-stream",
      "Content-Length": String(data.byteLength),
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(file.fileName)}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

const updateSchema = z.object({
  fileName: z.string().max(200).optional(),
  category: z.enum(UPLOAD_CATEGORIES as [string, ...string[]]).optional(),
  // The job the file belongs to; null makes it a lead document again.
  jobId: z.string().max(60).nullable().optional(),
});

/** Rename, recategorise, or move a file between a job and its lead. */
export async function PATCH(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const file = await loadFile(session.user, id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const verdict = canEditFile(session.user, file);
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 403 });

  const v = await validateBody(request, updateSchema);
  if (!v.ok) return v.response;
  const data: { fileName?: string; category?: (typeof file)["category"]; jobId?: string | null } = {};
  if (v.data.fileName !== undefined) {
    const name = cleanFileName(v.data.fileName, file.fileName);
    if (!name) return badRequest("Give the file a name");
    data.fileName = name;
  }
  if (v.data.category !== undefined) data.category = v.data.category as (typeof file)["category"];
  if (v.data.jobId !== undefined) {
    if (file.violationCaseId) return badRequest("A file on a code-violation case stays with the case");
    if (file.taskId && v.data.jobId !== file.jobId) return badRequest("A file on a task follows the task's job");
    if (v.data.jobId) {
      // Only onto a job of the same customer.
      const job = await prisma.job.findUnique({ where: { id: v.data.jobId }, select: { leadId: true } });
      if (!job || !file.leadId || job.leadId !== file.leadId) return badRequest("That job belongs to a different customer");
    }
    data.jobId = v.data.jobId || null;
  }

  const updated = await prisma.file.update({ where: { id }, data, include: FILE_LIST_INCLUDE });
  await recordAudit({
    actorUserId: session.user.id,
    entityType: "File",
    entityId: id,
    action: "update",
    before: { fileName: file.fileName, category: file.category, jobId: file.jobId },
    after: { fileName: updated.fileName, category: updated.category, jobId: updated.jobId },
  });
  return NextResponse.json((await presentFiles([updated]))[0]);
}

export async function DELETE(_request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const file = await loadFile(session.user, id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const verdict = canDeleteFile(session.user, file);
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 403 });

  // Row first: a failed unlink leaves an orphan on disk, never a row that
  // points at nothing.
  await prisma.file.delete({ where: { id } });
  await deleteFile(file.storageKey);
  await recordAudit({ actorUserId: session.user.id, entityType: "File", entityId: id, action: "delete", before: { fileName: file.fileName, category: file.category, leadId: file.leadId, jobId: file.jobId, taskId: file.taskId, violationCaseId: file.violationCaseId, uploadedByUserId: file.uploadedByUserId, storageKey: file.storageKey } });

  return NextResponse.json({ ok: true });
}
