import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardBid } from "@/lib/partners/bid-guard";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { closeBid, type CloseInput } from "@/lib/partners/bids";
import { bidOutcomeSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** Close the bid with its outcome. AWARDED creates the job (ADMIN / MANAGER); the rest any manager-of-partners may record. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, bidOutcomeSchema);
  if (!v.ok) return v.response;
  if (v.data.outcome === "AWARDED" && !canAdminPartners(session.user.role)) return NextResponse.json({ error: "Only a manager records an award — it creates the job" }, { status: 403 });
  try {
    return NextResponse.json(await closeBid(id, v.data as CloseInput, session.user.id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
