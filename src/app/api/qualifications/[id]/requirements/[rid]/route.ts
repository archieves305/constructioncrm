import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { vaultViewerFor } from "@/lib/partners/grants";
import { removeRequirement, setRequirement, type RequirementPatch } from "@/lib/partners/qualifications";
import { partnerErrorResponse, requirementPatchSchema } from "@/lib/partners/validation";

type Ctx = { params: Promise<{ id: string; rid: string }> };

/** Attach the current vault document, record the GC's answer, waive a line, mark it optional. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id, rid } = await params;
  const v = await validateBody(request, requirementPatchSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await setRequirement(rid, v.data as RequirementPatch, session.user.id, await vaultViewerFor(session.user), id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id, rid } = await params;
  try {
    return NextResponse.json(await removeRequirement(rid, session.user.id, await vaultViewerFor(session.user), id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
