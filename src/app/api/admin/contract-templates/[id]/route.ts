import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageContractTemplates, canViewContractTemplates } from "@/lib/customer-contracts/access";
import { getTemplate, setDefaultTemplate, updateTemplateMeta } from "@/lib/customer-contracts/templates";
import { contractErrorResponse } from "@/lib/customer-contracts/route-helpers";
import { updateContractTemplateSchema } from "@/lib/validators/customer-contract";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewContractTemplates(session.user.role)) return forbidden();
  const { id } = await params;
  try {
    return NextResponse.json(await getTemplate(id));
  } catch (err) {
    return contractErrorResponse(err, "contract-templates.get");
  }
}

// PATCH — name / description / isActive, or `isDefault: true` to make it the default.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContractTemplates(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, updateContractTemplateSchema);
  if (!v.ok) return v.response;
  try {
    const { isDefault, ...meta } = v.data;
    if (Object.keys(meta).length > 0) await updateTemplateMeta(id, meta, session.user);
    if (isDefault) await setDefaultTemplate(id, session.user);
    return NextResponse.json(await getTemplate(id));
  } catch (err) {
    return contractErrorResponse(err, "contract-templates.patch");
  }
}
