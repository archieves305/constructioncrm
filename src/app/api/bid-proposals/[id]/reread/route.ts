import { after, NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { rereadVersion, runProposalExtraction, versionVisible } from "@/lib/bids/proposals";

/** Read the estimate again (drops the unconfirmed edits, which came from the old reading). */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  if (!(await versionVisible(session.user, id))) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  try {
    await rereadVersion(id, session.user.id);
    after(() => runProposalExtraction(id, session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
