import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardBid } from "@/lib/partners/bid-guard";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE, partnerPermissions } from "@/lib/partners/access";
import { deleteBid, getBid, updateBid, type BidInput } from "@/lib/partners/bids";
import { partnerErrorResponse, updateBidSchema } from "@/lib/partners/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  try {
    return NextResponse.json({ ...(await getBid(id)), permissions: { ...partnerPermissions(session.user.role), canDecide: canAdminPartners(session.user.role) } });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, updateBidSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateBid(id, v.data as BidInput, session.user.id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canAdminPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  try {
    await deleteBid(id, session.user.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
