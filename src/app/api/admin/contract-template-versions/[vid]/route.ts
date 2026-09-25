import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageContractTemplates, canViewContractTemplates } from "@/lib/customer-contracts/access";
import { getVersion, updateDraftVersion, validateTemplateContent } from "@/lib/customer-contracts/templates";
import { contractErrorResponse } from "@/lib/customer-contracts/route-helpers";
import { contractTemplateContentSchema } from "@/lib/validators/customer-contract";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewContractTemplates(session.user.role)) return forbidden();
  const { vid } = await params;
  try {
    return NextResponse.json(await getVersion(vid));
  } catch (err) {
    return contractErrorResponse(err, "contract-template-versions.get");
  }
}

// PUT — save a DRAFT's content. Saving never validates hard (a half-written
// draft is fine); the response carries `problems` so the editor can show them.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContractTemplates(session.user.role)) return forbidden();
  const { vid } = await params;
  const v = await validateBody(request, contractTemplateContentSchema);
  if (!v.ok) return v.response;
  try {
    const saved = await updateDraftVersion(vid, v.data, session.user);
    return NextResponse.json({ ...saved, problems: validateTemplateContent(v.data) });
  } catch (err) {
    return contractErrorResponse(err, "contract-template-versions.put");
  }
}
