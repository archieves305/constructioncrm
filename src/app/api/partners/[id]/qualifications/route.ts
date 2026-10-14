import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { vaultViewerFor } from "@/lib/partners/grants";
import { createQualification, qualificationsForOrganization, type QualificationInput } from "@/lib/partners/qualifications";
import { createQualificationSchema, partnerErrorResponse } from "@/lib/partners/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const viewer = await vaultViewerFor(session.user);
  return NextResponse.json({ qualifications: await qualificationsForOrganization(id, viewer), canManage: canManagePartners(session.user.role) });
}

/** Start a qualification with this account; the checklist comes from the settings' default set unless `requirementTypeKeys` is given. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, createQualificationSchema);
  if (!v.ok) return v.response;
  try {
    const viewer = await vaultViewerFor(session.user);
    return NextResponse.json(await createQualification(id, v.data as QualificationInput, session.user.id, viewer), { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
