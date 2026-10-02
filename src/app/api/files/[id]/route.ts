import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { readFile, deleteFile } from "@/lib/files/storage";
import { canDeleteFile, fileReadWhere } from "@/lib/files/access";
import { recordAudit } from "@/lib/audit/record";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  // Outside the viewer's scope reads as "not found", so ids cannot be probed.
  const file = await prisma.file.findFirst({ where: { AND: [{ id }, fileReadWhere(session.user)] } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = await readFile(file.storageKey).catch(() => null);
  if (!data) return NextResponse.json({ error: "Missing on disk" }, { status: 410 });

  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  return new NextResponse(ab, {
    status: 200,
    headers: {
      "Content-Type": file.fileType || "application/octet-stream",
      "Content-Length": String(file.fileSize),
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const file = await prisma.file.findFirst({ where: { AND: [{ id }, fileReadWhere(session.user)] } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const verdict = canDeleteFile(session.user, file);
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 403 });

  // Row first: a failed unlink leaves an orphan on disk, never a row that
  // points at nothing.
  await prisma.file.delete({ where: { id } });
  await deleteFile(file.storageKey);
  await recordAudit({ actorUserId: session.user.id, entityType: "File", entityId: id, action: "delete", before: { fileName: file.fileName, category: file.category, leadId: file.leadId, taskId: file.taskId, violationCaseId: file.violationCaseId, uploadedByUserId: file.uploadedByUserId, storageKey: file.storageKey } });

  return NextResponse.json({ ok: true });
}
