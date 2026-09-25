import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageContractTemplates } from "@/lib/customer-contracts/access";
import { createDraftVersion } from "@/lib/customer-contracts/templates";
import { contractErrorResponse } from "@/lib/customer-contracts/route-helpers";
import { createDraftVersionSchema } from "@/lib/validators/customer-contract";

// POST — a new DRAFT copied from the published version (or `fromVersionId`).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContractTemplates(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, createDraftVersionSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await createDraftVersion(id, session.user, v.data.fromVersionId), { status: 201 });
  } catch (err) {
    return contractErrorResponse(err, "contract-templates.draft");
  }
}
