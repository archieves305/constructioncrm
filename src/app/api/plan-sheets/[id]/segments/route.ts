import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { buildChains, snapCandidates } from "@/lib/takeoff/geometry/segments";
import { guardSheet } from "@/lib/takeoff/route-guards";
import { readSheetGeometry } from "@/lib/takeoff/sheet-cache";

/** The drawn lines of a sheet as merged chains, for snapping while drawing. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardSheet(session.user, id, "read");
  if (denied) return denied;
  const sheet = await prisma.planSheet.findUnique({ where: { id }, select: { geometryKey: true } });
  if (!sheet) return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
  const geometry = await readSheetGeometry(sheet);
  if (!geometry) return NextResponse.json({ chains: [] }, { headers: { "Cache-Control": "private, max-age=3600" } });
  const { chains } = buildChains(geometry.segments);
  const kept = snapCandidates(chains).map((c) => [c.x1, c.y1, c.x2, c.y2, c.len, c.lw]);
  return NextResponse.json({ chains: kept, total: chains.length }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
