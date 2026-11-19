import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { getProject, setProjectStage } from "@/lib/bids/project";
import { guardProject } from "@/lib/bids/access";
import { projectStageSchema } from "@/lib/bids/validation";

/** Postpone, rebid, cancel or reopen the project (a reason; a review date when it waits). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardProject(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, projectStageSchema);
  if (!v.ok) return v.response;
  try {
    await setProjectStage(id, v.data.stage, v.data.reason, v.data.reviewAt, session.user.id);
    return NextResponse.json(await getProject(id, session.user));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
