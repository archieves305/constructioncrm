import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { getPartnerSettings, updatePartnerSettings } from "@/lib/partners/settings";
import { partnerErrorResponse, settingsSchema } from "@/lib/partners/validation";

/** Follow-up thresholds, the fallback owner and the markets list. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const settings = await getPartnerSettings();
  return NextResponse.json({ ...settings, canEdit: canAdminPartners(session.user.role) });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canAdminPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, settingsSchema);
  if (!v.ok) return v.response;
  try {
    const settings = await updatePartnerSettings(v.data, session.user.id);
    return NextResponse.json({ ...settings, canEdit: true });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
