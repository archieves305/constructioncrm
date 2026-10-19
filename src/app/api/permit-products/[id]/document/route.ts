import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canWriteProduction } from "@/lib/access/roles";
import { attachApprovalDocument } from "@/lib/permit-intel/approvals";
import { productInScope } from "@/lib/permit-intel/product-scope";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Copy the approval document among the permit's documents, so a submission can include it. */
export async function POST(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await productInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  try {
    return NextResponse.json(await attachApprovalDocument(id, actorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
