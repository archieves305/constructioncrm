import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardLead } from "@/lib/access/records";
import { validateBody } from "@/lib/validation/body";
import { previewTakeoff } from "@/lib/roofing/price-book";
import { takeoffPreviewSchema } from "@/lib/roofing/price-book-validation";
import { roofSectionFromTakeoff } from "@/lib/estimates/roof-section";
import type { RoofType } from "@/lib/roofing/types";

/**
 * POST /api/leads/[id]/roof-section — "Add roofing section from measurement"
 * in the estimate builder (audit roadmap MVP 5): runs the takeoff on one of
 * this lead's measurements with today's rules and price book and answers with
 * a section of priced lines (labor per square + materials). Writes nothing;
 * the section is saved with the estimate. Anyone who may write the lead's
 * estimates may ask.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardLead(session.user, id, "write");
  if (denied) return denied;

  const body = await validateBody(request, takeoffPreviewSchema);
  if (!body.ok) return body.response;
  const measurement = await prisma.roofMeasurement.findFirst({ where: { id: body.data.measurementId, leadId: id }, select: { id: true, label: true, totalSquares: true } });
  if (!measurement) return NextResponse.json({ error: "That measurement is not on this lead" }, { status: 404 });

  const takeoff = await previewTakeoff(measurement.id, body.data.roofType as RoofType, { wasteFactorPct: body.data.wastePct, battenInstall: body.data.battenInstall });
  if (!takeoff) return NextResponse.json({ error: "Measurement not found" }, { status: 404 });
  const section = roofSectionFromTakeoff(takeoff, measurement);
  const unpriced = takeoff.items.filter((i) => i.unitCost === 0).length;
  return NextResponse.json({
    section,
    wastePct: takeoff.wasteFactorPct,
    reportWastePct: takeoff.reportWastePct,
    confidence: takeoff.confidence,
    unpriced,
    warnings: takeoff.warnings,
  });
}
