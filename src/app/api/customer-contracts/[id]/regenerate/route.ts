import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageContracts } from "@/lib/customer-contracts/access";
import { regenerateContract } from "@/lib/customer-contracts/service";
import { contractErrorResponse } from "@/lib/customer-contracts/route-helpers";
import { regenerateContractSchema } from "@/lib/validators/customer-contract";

// POST /api/customer-contracts/[id]/regenerate — rebuild a DRAFT from the live estimate as a new document version.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContracts(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, regenerateContractSchema);
  if (!v.ok) return v.response;
  try {
    const result = await regenerateContract(id, session.user.id, {
      includeOptionalItemIds: v.data.includeOptionalItemIds,
      templateKey: v.data.templateKey,
      paymentSchedule: v.data.paymentSchedule,
    });
    return NextResponse.json(result);
  } catch (err) {
    return contractErrorResponse(err, "contracts.regenerate");
  }
}
