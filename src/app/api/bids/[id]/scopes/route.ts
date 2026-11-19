import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { getBid } from "@/lib/partners/bids";
import { guardBid } from "@/lib/partners/bid-guard";
import { setOpportunityScopes } from "@/lib/bids/project";
import { opportunityScopesSchema } from "@/lib/bids/validation";

/** The project scopes this GC is bidding (a decided scope stays). */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, opportunityScopesSchema);
  if (!v.ok) return v.response;
  try {
    await setOpportunityScopes(id, v.data.scopeIds, session.user.id);
    return NextResponse.json(await getBid(id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
