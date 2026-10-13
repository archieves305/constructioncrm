import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { guardBid } from "@/lib/partners/bid-guard";
import { attachIntake } from "@/lib/partners/itb-intake";
import { intakeAttachSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** File the email on a bid already logged (an addendum, a new due date). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, intakeAttachSchema);
  if (!v.ok) return v.response;
  const hidden = await guardBid(session.user, v.data.bidId);
  if (hidden) return hidden;
  try {
    return NextResponse.json(await attachIntake((await params).id, v.data, session.user.id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
