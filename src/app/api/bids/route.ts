import { NextRequest, NextResponse } from "next/server";
import type { BidOutcome, BidStatus } from "@/generated/prisma/enums";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { createBid, listBids, type CreateBidInput } from "@/lib/partners/bids";
import { BID_OUTCOMES, BID_STATUSES_LIST, createBidSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** Bid packages across accounts. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const status = sp.get("status");
  const outcome = sp.get("outcome");
  const day = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(sp.get(k) ?? "") ? sp.get(k)! : undefined);
  const result = await listBids(
    {
      status: status && (BID_STATUSES_LIST as readonly string[]).includes(status) ? (status as BidStatus) : undefined,
      outcome: outcome && (BID_OUTCOMES as readonly string[]).includes(outcome) ? (outcome as BidOutcome) : undefined,
      organizationId: sp.get("organizationId") || undefined,
      estimatorUserId: sp.get("estimator") || undefined,
      dueFrom: day("dueFrom"),
      dueTo: day("dueTo"),
      search: sp.get("search")?.trim() || undefined,
      includeClosed: sp.get("closed") === "1",
      scope: sp.get("scope") === "mine" ? "mine" : "all",
      page: Math.max(1, Number(sp.get("page")) || 1),
      pageSize: Math.min(500, Math.max(1, Number(sp.get("pageSize")) || 100)),
    },
    session.user,
  );
  return NextResponse.json({ ...result, canManage: canManagePartners(session.user.role), canDecide: canAdminPartners(session.user.role) });
}

/** A new bid package: creates the GC_BID lead and the invitation together. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, createBidSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await createBid(v.data as CreateBidInput, session.user.id), { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
