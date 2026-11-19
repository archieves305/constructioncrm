import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { readSnapshot } from "@/lib/bids/planhub/sync";
import { planhubPayloadSchema } from "@/lib/bids/planhub/validation";

/** A PlanHub page sent from the person's own browser: kept, read, and planned. Writes only the snapshot. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, planhubPayloadSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await readSnapshot(v.data, session.user));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
