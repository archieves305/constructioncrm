import { NextRequest, NextResponse, after } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canManageApprovals } from "@/lib/permit-intel/access";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";
import { requestReread, runApprovalRead } from "@/lib/permit-intel/approvals";

type Context = { params: Promise<{ id: string }> };

/** Read the document again (not once it is checked). */
export async function POST(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageApprovals(session.user.role)) return forbidden();
  const { id } = await params;
  try {
    const out = await requestReread(id, actorOf(session.user));
    after(() => runApprovalRead(id, session.user.id));
    return NextResponse.json(out ?? { ok: true }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
