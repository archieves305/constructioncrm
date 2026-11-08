import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canViewCompanyFinancials } from "@/lib/money/access";
import { usageSummary } from "@/lib/usage/record";

/** GET /api/usage/summary?days=7 — who used the CRM and the app, and what most; for the owner roles. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewCompanyFinancials(session.user.role)) return forbidden();
  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days")) || 7));
  return NextResponse.json(await usageSummary(days));
}
