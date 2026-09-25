import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canManageContractTemplates } from "@/lib/customer-contracts/access";
import { archiveVersion } from "@/lib/customer-contracts/templates";
import { contractErrorResponse } from "@/lib/customer-contracts/route-helpers";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContractTemplates(session.user.role)) return forbidden();
  const { vid } = await params;
  try {
    return NextResponse.json(await archiveVersion(vid, session.user));
  } catch (err) {
    return contractErrorResponse(err, "contract-template-versions.archive");
  }
}
