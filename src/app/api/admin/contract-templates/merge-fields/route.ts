import { NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canViewContractTemplates } from "@/lib/customer-contracts/access";
import { MERGE_FIELD_CATALOG } from "@/lib/customer-contracts/merge";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewContractTemplates(session.user.role)) return forbidden();
  return NextResponse.json(MERGE_FIELD_CATALOG);
}
