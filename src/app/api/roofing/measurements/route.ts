import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { formatAddressLine } from "@/lib/labels/address";
import { LEAD_LABEL_SELECT } from "@/lib/labels/select";
import { canManageRoofPricing, ROOF_PRICING_DENIED } from "@/lib/roofing/access";

/** The most recent measurements, to pick one for a takeoff preview. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageRoofPricing(session.user.role)) return NextResponse.json({ error: ROOF_PRICING_DENIED }, { status: 403 });
  const rows = await prisma.roofMeasurement.findMany({
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, source: true, label: true, totalSquares: true, reportWastePct: true, createdAt: true, lead: { select: LEAD_LABEL_SELECT } },
  });
  return NextResponse.json(rows.map(({ lead, ...r }) => ({ ...r, address: formatAddressLine(lead), customer: lead.fullName })));
}
