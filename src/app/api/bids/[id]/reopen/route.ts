import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardBid } from "@/lib/partners/bid-guard";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { reopenBid } from "@/lib/partners/bids";
import { bidReopenSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** Reopen a closed bid (ADMIN / MANAGER). A job created from an award stays; pass `force` to reopen anyway. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canAdminPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, bidReopenSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await reopenBid(id, session.user.id, v.data.force ?? false));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
