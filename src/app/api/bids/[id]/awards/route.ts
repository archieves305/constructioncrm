import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { recordAward } from "@/lib/bids/award";
import { guardBid } from "@/lib/partners/bid-guard";
import { awardSchema } from "@/lib/bids/validation";

/** Record an award for some of this GC's scopes: verbal (no job) or confirmed (creates the job). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, awardSchema);
  if (!v.ok) return v.response;
  try {
    if (v.data.kind !== "VERBAL" && !canAdminPartners(session.user.role)) return NextResponse.json({ error: "Only a manager records a confirmed award — it creates the job" }, { status: 403 });
    return NextResponse.json(await recordAward(id, v.data, session.user.id), { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
