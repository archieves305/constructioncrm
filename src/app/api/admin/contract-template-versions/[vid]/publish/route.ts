import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageContractTemplates } from "@/lib/customer-contracts/access";
import { publishVersion } from "@/lib/customer-contracts/templates";
import { contractErrorResponse } from "@/lib/customer-contracts/route-helpers";
import { publishVersionSchema } from "@/lib/validators/customer-contract";

export async function POST(request: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContractTemplates(session.user.role)) return forbidden();
  const { vid } = await params;
  const v = await validateBody(request, publishVersionSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await publishVersion(vid, session.user, v.data.changeNotes));
  } catch (err) {
    return contractErrorResponse(err, "contract-template-versions.publish");
  }
}
