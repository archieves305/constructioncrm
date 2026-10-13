import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardBid } from "@/lib/partners/bid-guard";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { setBidStatus } from "@/lib/partners/bids";
import { bidStatusSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** Move a bid along its pipeline (closing is `/outcome`). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, bidStatusSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await setBidStatus(id, v.data.status, v.data.waitingOn, session.user.id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
