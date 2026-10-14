import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { vaultViewerFor } from "@/lib/partners/grants";
import { addRequirement } from "@/lib/partners/qualifications";
import { addRequirementSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** Add a document the GC asks for to the checklist. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, addRequirementSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await addRequirement(id, v.data.documentTypeKey, session.user.id, await vaultViewerFor(session.user)), { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
