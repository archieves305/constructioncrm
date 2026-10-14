import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { deleteDocument, updateDocument, usedBy } from "@/lib/partners/documents";
import { vaultViewerFor } from "@/lib/partners/grants";
import { documentPatchSchema, partnerErrorResponse } from "@/lib/partners/validation";
import { canReadDocument, canUploadVault } from "@/lib/partners/vault-access";

type Ctx = { params: Promise<{ id: string }> };

/** Metadata and where the document is used; never the bytes (see ./file). */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const viewer = await vaultViewerFor(session.user);
  const doc = await prisma.companyDocument.findUnique({ where: { id }, select: { id: true, title: true, version: true, confidentiality: true, approvedForExternal: true, effectiveDate: true, expiresAt: true, fileName: true, fileType: true, fileSize: true, notes: true, createdAt: true, documentType: { select: { key: true, name: true } }, uploadedBy: { select: { id: true, firstName: true, lastName: true } } } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...doc, locked: !canReadDocument(viewer, doc.confidentiality), usedBy: await usedBy(id) });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canUploadVault(session.user.role)) return NextResponse.json({ error: "Only office roles edit vault documents" }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, documentPatchSchema);
  if (!v.ok) return v.response;
  try {
    const viewer = await vaultViewerFor(session.user);
    return NextResponse.json(await updateDocument(id, v.data, { ...viewer, id: session.user.id }));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  try {
    const viewer = await vaultViewerFor(session.user);
    await deleteDocument(id, { ...viewer, id: session.user.id });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
