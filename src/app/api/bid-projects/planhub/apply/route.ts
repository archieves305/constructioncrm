import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { applyBoard, applyProject } from "@/lib/bids/planhub/sync";
import { planhubApplySchema } from "@/lib/bids/planhub/validation";

/** Apply what a person ticked on the review of a PlanHub page. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, planhubApplySchema);
  if (!v.ok) return v.response;
  try {
    const { kind, ...rest } = v.data;
    if (kind === "BOARD") return NextResponse.json(await applyBoard(rest as Parameters<typeof applyBoard>[0], session.user));
    return NextResponse.json(await applyProject(rest as Parameters<typeof applyProject>[0], session.user));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
