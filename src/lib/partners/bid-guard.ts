import { NextResponse } from "next/server";
import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { leadAccessWhere } from "@/lib/access/records";

/**
 * A bid is reachable by id only when its lead is: an own-only role (SALES_REP)
 * opens the bids it estimates, raised, or whose lead is assigned to it —
 * the same rule as the lead page, so the list never links to a 404.
 * Role checks (view / manage / decide) stay in each route.
 */
export async function guardBid(viewer: { id: string; role: RoleName }, bidId: string): Promise<NextResponse | null> {
  const hit = await prisma.bidInvitation.findFirst({ where: { id: bidId, lead: leadAccessWhere(viewer) }, select: { id: true } });
  return hit ? null : NextResponse.json({ error: "Bid not found" }, { status: 404 });
}
