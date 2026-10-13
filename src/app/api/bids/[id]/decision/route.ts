import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardBid } from "@/lib/partners/bid-guard";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import type { Slider } from "@/lib/partners/bid-score";
import { decideBid, previewBidScore } from "@/lib/partners/bids";
import { bidDecisionSchema, partnerErrorResponse } from "@/lib/partners/validation";

type Ctx = { params: Promise<{ id: string }> };
const slider = (v: string | null): Slider => {
  const n = Number(v);
  return v && Number.isInteger(n) && n >= 1 && n <= 5 ? (n as Slider) : null;
};

/** The score as it stands, with the sliders from the query string; writes nothing. */
export async function GET(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  const sp = request.nextUrl.searchParams;
  try {
    return NextResponse.json(await previewBidScore(id, { margin: slider(sp.get("margin")), capacity: slider(sp.get("capacity")), competition: slider(sp.get("competition")), complexity: slider(sp.get("complexity")), plansAndTerms: slider(sp.get("plansAndTerms")) }));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

/** Bid or pass. The score and its inputs are stored with the decision; NO_BID closes the bid. ADMIN / MANAGER. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canAdminPartners(session.user.role)) return NextResponse.json({ error: "Only a manager decides whether KNU bids" }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, bidDecisionSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await decideBid(id, { decision: v.data.decision, manual: v.data.manual as { margin: Slider; capacity: Slider; competition: Slider; complexity: Slider; plansAndTerms: Slider }, reason: v.data.reason }, session.user.id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
