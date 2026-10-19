import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canManageApprovals } from "@/lib/permit-intel/access";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";
import { validateBody } from "@/lib/validation/body";
import { setMaterials } from "@/lib/permit-intel/approvals";
import { materialsSchema } from "@/lib/permit-intel/approval-validation";

type Context = { params: Promise<{ id: string }> };

/** The roofing materials the approval covers (replaces the list). */
export async function PUT(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageApprovals(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, materialsSchema);
  if (!v.ok) return v.response;
  try {
    await setMaterials(id, v.data.itemIds, actorOf(session.user));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
