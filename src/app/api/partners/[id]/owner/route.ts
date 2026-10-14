import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { changeOwner } from "@/lib/partners/service";
import { ownerChangeSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** Who owns the relationship. The account's open follow-ups move with it. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canAdminPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, ownerChangeSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await changeOwner(id, v.data.ownerUserId, session.user.id, session.user));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
