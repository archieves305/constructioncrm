import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canManageVendors, canViewVendors, VENDOR_DENIED_MESSAGE } from "@/lib/vendors/access";
import { vendorErrorResponse } from "@/lib/vendors/validation";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { readFile } from "@/lib/files/storage";
import { validateBody } from "@/lib/validation/body";
import { deleteDocument, updateDocument, VENDOR_DOC_TYPES } from "@/lib/vendors/documents";

type Context = { params: Promise<{ id: string; docId: string }> };

const updateSchema = z.object({
  type: z.enum(VENDOR_DOC_TYPES).optional(),
  carrier: z.string().max(200).nullable().optional(),
  policyNumber: z.string().max(120).nullable().optional(),
  effectiveDate: z.string().max(10).nullable().optional(),
  expiresAt: z.string().max(10).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/** The stored file, inline. */
export async function GET(_request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewVendors(session.user.role)) return forbidden();

  const { id, docId } = await context.params;
  const doc = await prisma.vendorDocument.findFirst({ where: { id: docId, vendorId: id }, select: { storageKey: true, fileName: true, fileType: true } });
  if (!doc || !doc.storageKey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let buffer: Buffer;
  try {
    buffer = await readFile(doc.storageKey);
  } catch {
    return NextResponse.json({ error: "The file is missing from storage" }, { status: 410 });
  }
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  return new NextResponse(ab, {
    headers: {
      "Content-Type": doc.fileType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${(doc.fileName ?? "document").replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageVendors(session.user.role)) return NextResponse.json({ error: VENDOR_DENIED_MESSAGE }, { status: 403 });

  const { id, docId } = await context.params;
  const v = await validateBody(request, updateSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateDocument(id, docId, v.data, session.user.id));
  } catch (err) {
    return vendorErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageVendors(session.user.role)) return NextResponse.json({ error: VENDOR_DENIED_MESSAGE }, { status: 403 });

  const { id, docId } = await context.params;
  try {
    await deleteDocument(id, docId, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return vendorErrorResponse(err);
  }
}
