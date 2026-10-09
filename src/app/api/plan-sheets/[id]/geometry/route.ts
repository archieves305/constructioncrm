import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardSheet } from "@/lib/takeoff/route-guards";
import { readSheetGeometry } from "@/lib/takeoff/sheet-cache";

/** The drawn segments of a sheet (raw, in sheet points). Large; the viewer loads it only when a drawing tool needs snapping. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardSheet(session.user, id, "read");
  if (denied) return denied;
  const sheet = await prisma.planSheet.findUnique({ where: { id }, select: { geometryKey: true } });
  if (!sheet) return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
  const geometry = await readSheetGeometry(sheet);
  if (!geometry) return NextResponse.json({ error: "This sheet has no geometry yet" }, { status: 404 });
  return NextResponse.json(geometry, { headers: { "Cache-Control": "private, max-age=3600" } });
}
