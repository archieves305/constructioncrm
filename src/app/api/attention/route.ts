import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { loadAttention } from "@/lib/attention/load";
import { effectiveListScope, parseListScope } from "@/lib/lists/scope";

// GET /api/attention?scope=mine|all — the dashboard's "Needs attention" counts.
// Which rows come back is decided by the role (lib/attention/rows.ts).
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const scope = effectiveListScope(parseListScope(request.nextUrl.searchParams.get("scope")), session.user.role);
  const rows = await loadAttention({ user: session.user, scope, now: new Date() });
  return NextResponse.json({ scope, rows });
}
