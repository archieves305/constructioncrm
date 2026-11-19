import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { listOpportunities, OPPORTUNITY_QUEUES, queueCounts, type OpportunityQueue } from "@/lib/bids/project";

/** One work queue of GC opportunities (?queue=), or every queue's count (?counts=1). */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  if (sp.get("counts") === "1") return NextResponse.json({ counts: await queueCounts(session.user) });
  const q = sp.get("queue") ?? "mine";
  if (!(OPPORTUNITY_QUEUES as readonly string[]).includes(q)) return NextResponse.json({ error: "Unknown queue" }, { status: 400 });
  const result = await listOpportunities(
    q as OpportunityQueue,
    { search: sp.get("search")?.trim() || undefined, ownerUserId: sp.get("owner") || undefined, tradeId: sp.get("trade") || undefined, organizationId: sp.get("gc") || undefined, page: Math.max(1, Number(sp.get("page")) || 1), pageSize: Math.min(200, Math.max(1, Number(sp.get("pageSize")) || 50)) },
    session.user,
  );
  return NextResponse.json({ ...result, canManage: canManagePartners(session.user.role) });
}
