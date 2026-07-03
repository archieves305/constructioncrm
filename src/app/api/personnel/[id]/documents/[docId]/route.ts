import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import {
  canViewSensitivePersonnel,
  getFieldGrants,
} from "@/lib/labor/permissions";
import { deleteFile, readFile } from "@/lib/files/storage";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string; docId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const grants = await getFieldGrants(session.user.id);
  if (!canViewSensitivePersonnel(session.user.role, grants)) return forbidden();

  const { id, docId } = await context.params;
  const doc = await prisma.personnelDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.personnelId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(doc.storageKey);
  } catch {
    return NextResponse.json({ error: "File missing from storage" }, { status: 410 });
  }

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "PersonnelDocument",
    entityId: doc.id,
    action: "document_view",
    after: { personnelId: id, type: doc.type, fileName: doc.fileName },
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  });

  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  return new NextResponse(ab, {
    headers: {
      "Content-Type": doc.fileType,
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function DELETE(_request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const grants = await getFieldGrants(session.user.id);
  if (!canViewSensitivePersonnel(session.user.role, grants)) return forbidden();

  const { id, docId } = await context.params;
  const doc = await prisma.personnelDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.personnelId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.personnelDocument.delete({ where: { id: docId } });
  await deleteFile(doc.storageKey);

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "PersonnelDocument",
    entityId: docId,
    action: "delete",
    before: { personnelId: id, type: doc.type, fileName: doc.fileName },
  });

  return NextResponse.json({ ok: true });
}
