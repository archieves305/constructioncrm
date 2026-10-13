import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { getIntake, setIntakeAccount } from "@/lib/partners/itb-intake";
import { intakeAccountSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** One emailed invitation, with the email itself. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  try {
    return NextResponse.json(await getIntake((await params).id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

/** Pick the account it came from. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, intakeAccountSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await setIntakeAccount((await params).id, v.data.organizationId, session.user.id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
