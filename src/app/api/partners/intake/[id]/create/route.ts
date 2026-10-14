import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import type { CreateBidInput } from "@/lib/partners/bids";
import { createBidFromIntake } from "@/lib/partners/itb-intake";
import { createBidSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** Create the bid from an emailed invitation, with the fields as the person confirmed them. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, createBidSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await createBidFromIntake((await params).id, v.data as CreateBidInput, session.user.id), { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
