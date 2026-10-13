import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { deleteOrganization, getOrganizationDetail, updateOrganization, type OrganizationInput } from "@/lib/partners/service";
import { partnerErrorResponse, updateOrganizationSchema } from "@/lib/partners/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  try {
    return NextResponse.json(await getOrganizationDetail(id, session.user));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, updateOrganizationSchema);
  if (!v.ok) return v.response;
  // Who owns an account, and whether it is still worked, are management calls.
  if ((v.data.ownerUserId !== undefined || v.data.isActive !== undefined) && !canAdminPartners(session.user.role)) {
    return NextResponse.json({ error: "Only a manager can change an account's owner or retire it" }, { status: 403 });
  }
  try {
    return NextResponse.json(await updateOrganization(id, v.data as Partial<OrganizationInput>, session.user.id, session.user));
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
    await deleteOrganization(id, session.user.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
