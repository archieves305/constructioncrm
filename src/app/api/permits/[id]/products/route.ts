import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canWriteProduction } from "@/lib/access/roles";
import { actorOf, errorResponse, permitInScope } from "@/lib/permit-intel/route";
import { addPermitProduct, listPermitProducts } from "@/lib/permit-intel/approvals";
import { permitProductSchema } from "@/lib/permit-intel/approval-validation";
import { ADVISORY } from "@/lib/permit-intel/approvals-plan";

type Context = { params: Promise<{ id: string }> };

/** The products on the permit, each with its advisory flags. */
export async function GET(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "read");
  if (scope.denied) return scope.denied;
  try {
    return NextResponse.json({ products: await listPermitProducts(id), advisory: ADVISORY, permissions: { canEdit: canWriteProduction(session.user.role) } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const v = await validateBody(request, permitProductSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await addPermitProduct(id, v.data, actorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
