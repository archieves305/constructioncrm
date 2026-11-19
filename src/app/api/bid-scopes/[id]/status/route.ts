import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { setScopeStatus } from "@/lib/bids/project";
import { getBid } from "@/lib/partners/bids";
import { guardBid } from "@/lib/partners/bid-guard";
import { bidIdOfScope } from "@/lib/bids/access";
import { scopeStatusSchema } from "@/lib/bids/validation";

/** A scope lost, withdrawn, not bid, cancelled — or back to pending. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const bidId = await bidIdOfScope(id);
  if (!bidId) return NextResponse.json({ error: "Scope not found" }, { status: 404 });
  const hidden = await guardBid(session.user, bidId);
  if (hidden) return hidden;
  const v = await validateBody(request, scopeStatusSchema);
  if (!v.ok) return v.response;
  try {
    await setScopeStatus(id, v.data.status, v.data.lossReason ?? null, v.data.note, session.user.id);
    return NextResponse.json(await getBid(bidId));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
