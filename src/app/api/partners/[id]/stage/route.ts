import { NextRequest, NextResponse } from "next/server";
import type { PartnerStage } from "@/generated/prisma/enums";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { changeStage } from "@/lib/partners/service";
import { partnerErrorResponse, stageChangeSchema } from "@/lib/partners/validation";

/** Move an account along the pipeline. Writing one off (Do not pursue) is a manager's call. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, stageChangeSchema);
  if (!v.ok) return v.response;
  if (v.data.stage === "DO_NOT_PURSUE" && !canAdminPartners(session.user.role)) {
    return NextResponse.json({ error: "Only a manager can mark an account Do not pursue" }, { status: 403 });
  }
  try {
    return NextResponse.json(await changeStage(id, v.data.stage as PartnerStage, v.data.reason ?? null, session.user.id, session.user));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
