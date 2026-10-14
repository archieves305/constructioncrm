import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardBid } from "@/lib/partners/bid-guard";
import { canAdminPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { deleteSubmission } from "@/lib/partners/submissions";
import { partnerErrorResponse } from "@/lib/partners/validation";

/** A submission recorded by mistake, within a day of recording it. ADMIN / MANAGER. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; sid: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canAdminPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id, sid } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  try {
    return NextResponse.json(await deleteSubmission(id, sid, session.user.id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
