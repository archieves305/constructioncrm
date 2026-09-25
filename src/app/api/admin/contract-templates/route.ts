import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageContractTemplates, canViewContractTemplates } from "@/lib/customer-contracts/access";
import { createTemplate, listTemplates } from "@/lib/customer-contracts/templates";
import { contractErrorResponse } from "@/lib/customer-contracts/route-helpers";
import { createContractTemplateSchema } from "@/lib/validators/customer-contract";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewContractTemplates(session.user.role)) return forbidden();
  return NextResponse.json(await listTemplates());
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContractTemplates(session.user.role)) return forbidden();
  const v = await validateBody(request, createContractTemplateSchema);
  if (!v.ok) return v.response;
  try {
    const t = await createTemplate(v.data, session.user);
    return NextResponse.json(t, { status: 201 });
  } catch (err) {
    return contractErrorResponse(err, "contract-templates.create");
  }
}
