import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canManageApprovals } from "@/lib/permit-intel/access";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";
import { verifyApproval } from "@/lib/permit-intel/approvals";

type Context = { params: Promise<{ id: string }> };

/** A person has checked every field against the document. */
export async function POST(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageApprovals(session.user.role)) return forbidden();
  const { id } = await params;
  try {
    const out = await verifyApproval(id, actorOf(session.user));
    
    return NextResponse.json(out ?? { ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
