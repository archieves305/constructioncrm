import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { prisma } from "@/lib/db/prisma";
import { canViewPartnerMoney } from "@/lib/partners/access";
import { loadOrgScorecard } from "@/lib/partners/scorecard-load";
import { parseWindow } from "@/lib/partners/windows";
import { todayKey } from "@/lib/time/zone";

/** One account's performance over a window (`preset`, or `custom` with `from` / `to`). Money roles only. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartnerMoney(session.user.role)) return NextResponse.json({ error: "The scorecard shows company financials" }, { status: 403 });
  const { id } = await params;
  const exists = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json(await loadOrgScorecard(id, parseWindow(request.nextUrl.searchParams, todayKey())));
}
