import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { vaultViewerFor } from "@/lib/partners/grants";
import { deleteQualification, presentQualification, QUAL_SELECT, updateQualification, type QualificationInput } from "@/lib/partners/qualifications";
import { partnerErrorResponse, updateQualificationSchema } from "@/lib/partners/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const q = await prisma.qualification.findUnique({ where: { id }, select: QUAL_SELECT });
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...presentQualification(q, await vaultViewerFor(session.user)), canManage: canManagePartners(session.user.role) });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, updateQualificationSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateQualification(id, v.data as QualificationInput, session.user.id, await vaultViewerFor(session.user)));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canAdminPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  try {
    await deleteQualification(id, session.user.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
