import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { loadAttentionList } from "@/lib/attention/load";
import { canSeeAttentionRow, isAttentionKey } from "@/lib/attention/rows";
import { effectiveListScope, parseListScope } from "@/lib/lists/scope";

// GET /api/attention/[key]?scope=mine|all — the records behind one row, read
// through the same `where` as its count.
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { key } = await params;
  // Overdue tasks open the Tasks page; they have no list here.
  if (!isAttentionKey(key) || key === "overdue-tasks") return NextResponse.json({ error: "Unknown list" }, { status: 404 });
  if (!canSeeAttentionRow(session.user.role, key)) return forbidden();

  const scope = effectiveListScope(parseListScope(request.nextUrl.searchParams.get("scope")), session.user.role);
  const list = await loadAttentionList({ user: session.user, scope, now: new Date() }, key);
  return NextResponse.json(list);
}
