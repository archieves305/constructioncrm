import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { loadOwnerSummary } from "@/lib/attention/load";
import { effectiveListScope, parseListScope } from "@/lib/lists/scope";
import { canViewCompanyFinancials } from "@/lib/money/access";

// GET /api/attention/owner?scope=mine|all — the owner's strip: new and
// uncontacted leads, pipeline value, estimates out, active jobs and expected
// gross profit. Company money, so the financial-report roles only.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewCompanyFinancials(session.user.role)) return forbidden();
  const scope = effectiveListScope(parseListScope(request.nextUrl.searchParams.get("scope")), session.user.role);
  return NextResponse.json({ scope, ...(await loadOwnerSummary({ user: session.user, scope, now: new Date() })) });
}
