import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { confirmAward } from "@/lib/bids/award";
import { guardBid } from "@/lib/partners/bid-guard";
import { bidIdOfAward } from "@/lib/bids/access";
import { confirmAwardSchema } from "@/lib/bids/validation";

/** Put a verbal selection in writing (or signed): creates the job. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canAdminPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const bidId = await bidIdOfAward(id);
  if (!bidId) return NextResponse.json({ error: "Award not found" }, { status: 404 });
  const hidden = await guardBid(session.user, bidId);
  if (hidden) return hidden;
  const v = await validateBody(request, confirmAwardSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await confirmAward(id, v.data, session.user.id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
