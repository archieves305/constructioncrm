import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { deleteInteraction, updateInteraction } from "@/lib/partners/interactions";
import { partnerErrorResponse, updateInteractionSchema } from "@/lib/partners/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, updateInteractionSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateInteraction(id, v.data, { id: session.user.id, canAdmin: canAdminPartners(session.user.role) }));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  try {
    await deleteInteraction(id, { id: session.user.id, canAdmin: canAdminPartners(session.user.role) });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
