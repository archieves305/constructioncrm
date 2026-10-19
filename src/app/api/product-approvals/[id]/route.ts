import { NextRequest, NextResponse, after } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canManageApprovals } from "@/lib/permit-intel/access";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";
import { validateBody } from "@/lib/validation/body";
import { prisma } from "@/lib/db/prisma";
import { loadApproval, readIsStale, runApprovalRead, updateApproval } from "@/lib/permit-intel/approvals";
import { approvalPatchSchema } from "@/lib/permit-intel/approval-validation";

type Context = { params: Promise<{ id: string }> };

/** One approval with its evidence, materials and the permits that use it. A reading a restart cut off starts again. */
export async function GET(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role === "CREW_LEAD") return forbidden();
  const { id } = await params;
  const a = await loadApproval(id);
  if (!a) return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  if (readIsStale(a)) after(() => runApprovalRead(id, null));
  const canManage = canManageApprovals(session.user.role);
  // names only — the price book's costs stay with the roles that see them
  const catalog = canManage ? await prisma.roofMaterialItem.findMany({ where: { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }], select: { id: true, name: true, category: true } }) : [];
  return NextResponse.json({ ...a, catalog, permissions: { canManage } });
}

/** A person's corrections to the fields. */
export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageApprovals(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, approvalPatchSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateApproval(id, v.data, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}
