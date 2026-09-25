import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { loadViolationSummary } from "@/lib/violations/summary";

/** Sidebar badge + landing tiles, role-scoped like the list. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  return NextResponse.json(await loadViolationSummary(session.user));
}
