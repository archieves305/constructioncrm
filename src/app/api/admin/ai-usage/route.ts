import { NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canViewAiUsage } from "@/lib/ai/access";
import { loadAiUsage } from "@/lib/ai/usage-load";

/**
 * What the shared AI layer has cost: six months by month, this month by
 * purpose, the latest failures, and the caps in force. Read-only. ADMIN and
 * MANAGER.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewAiUsage(session.user.role)) return forbidden();
  return NextResponse.json(await loadAiUsage());
}
