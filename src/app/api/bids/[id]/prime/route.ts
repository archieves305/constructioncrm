import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { setPrimeStatus } from "@/lib/bids/project";
import { getBid } from "@/lib/partners/bids";
import { guardBid } from "@/lib/partners/bid-guard";
import { primeStatusSchema } from "@/lib/bids/validation";

/** The GC's prime contract: won, lost (closes only this GC), rebidding, cancelled. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, primeStatusSchema);
  if (!v.ok) return v.response;
  try {
    await setPrimeStatus(id, v.data.primeStatus, v.data.note, session.user.id);
    return NextResponse.json(await getBid(id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
