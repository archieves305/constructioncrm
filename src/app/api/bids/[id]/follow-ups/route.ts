import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { guardBid } from "@/lib/partners/bid-guard";
import { getBidFollowUps, logBidCall, logBidReply, setBidNextAction } from "@/lib/bids/follow-ups";
import { followUpActionSchema } from "@/lib/bids/follow-up-validation";

/** The bid's follow-up card: the anchor, what is coming, what was raised, the drafts. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  try {
    return NextResponse.json({ ...(await getBidFollowUps(id, session.user)), canManage: canManagePartners(session.user.role) });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

/** Log a call or a reply, or set the pace (a date the GC asked for, a pause, the anchor). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, followUpActionSchema);
  if (!v.ok) return v.response;
  const b = v.data;
  try {
    if (b.type === "call") await logBidCall(id, { contactId: b.contactId, outcome: b.outcome, summary: b.summary, nextDay: b.nextDay }, session.user.id);
    else if (b.type === "reply") await logBidReply(id, { contactId: b.contactId, summary: b.summary, nextDay: b.nextDay }, session.user.id);
    else if (b.type === "set_date") await setBidNextAction(id, { action: "set_date", day: b.day }, session.user.id);
    else if (b.type === "pause") await setBidNextAction(id, { action: "pause", until: b.until, scope: b.scope, reason: b.reason }, session.user.id);
    else if (b.type === "set_anchor") await setBidNextAction(id, { action: "set_anchor", day: b.day }, session.user.id);
    else await setBidNextAction(id, { action: b.type }, session.user.id);
    return NextResponse.json(await getBidFollowUps(id, session.user));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
