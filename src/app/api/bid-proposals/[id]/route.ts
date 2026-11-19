import { after, NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { getProposalVersion, runProposalExtraction, saveReview, versionVisible } from "@/lib/bids/proposals";
import type { ReviewDraft } from "@/lib/bids/proposal-plan";
import { reviewDraftSchema } from "@/lib/bids/validation";

/** The review of an uploaded estimate; a reading cut off mid-way restarts on this load. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  if (!(await versionVisible(session.user, id))) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  try {
    const v = await getProposalVersion(id);
    if (v.restart) after(() => runProposalExtraction(id, null));
    return NextResponse.json({ ...v, canManage: canManagePartners(session.user.role) });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

/** Save a person's corrections to the draft (before confirming). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  if (!(await versionVisible(session.user, id))) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  const v = await validateBody(request, reviewDraftSchema);
  if (!v.ok) return v.response;
  try {
    await saveReview(id, v.data as ReviewDraft, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
