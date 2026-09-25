import { NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canManageContracts } from "@/lib/customer-contracts/access";
import { listPublishedTemplates } from "@/lib/customer-contracts/templates";

// GET /api/contract-templates — the published templates a contract can be generated from.
// (Non-admin: the Generate dialog needs it for OFFICE_STAFF and SALES_REP.)
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContracts(session.user.role)) return forbidden();
  return NextResponse.json(await listPublishedTemplates());
}
