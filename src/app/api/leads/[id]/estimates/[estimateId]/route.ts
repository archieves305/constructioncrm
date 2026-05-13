import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { estimateInputSchema } from "@/lib/estimates/schema";
import { calculateEstimate } from "@/lib/estimates/calc";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; estimateId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, estimateId } = await params;

  const estimate = await prisma.roofEstimate.findFirst({
    where: { id: estimateId, leadId: id },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!estimate) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(estimate);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; estimateId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, estimateId } = await params;

  const existing = await prisma.roofEstimate.findFirst({
    where: { id: estimateId, leadId: id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await validateBody(request, estimateInputSchema);
  if (!result.ok) return result.response;
  const input = result.data;
  const breakdown = calculateEstimate(input);

  const updated = await prisma.roofEstimate.update({
    where: { id: estimateId },
    data: {
      roofTypesJson: input.roofTypes,
      materialCost: input.materialCost,
      materialSelection: input.materialSelection ?? null,
      permitFee: input.permitFee,
      dumpsterFee: input.dumpsterFee,
      tearOffFee: input.tearOffFee,
      deckingFee: input.deckingFee,
      underlaymentFee: input.underlaymentFee,
      flashingVentFee: input.flashingVentFee,
      skylightChimneyFee: input.skylightChimneyFee,
      guttersFee: input.guttersFee,
      miscLabel: input.miscLabel ?? null,
      miscFee: input.miscFee,
      marginPercent: input.marginPercent,
      discountEnabled: input.discountEnabled,
      discountPercent: input.discountPercent,
      salesTaxPercent: input.salesTaxPercent,
      validityDays: input.validityDays,
      specialTerms: input.specialTerms ?? null,
      existingRoofType: input.existingRoofType ?? null,
      proposedRoofTypeOverride: input.proposedRoofTypeOverride ?? null,
      underlaymentType: input.underlaymentType ?? null,
      permitIncluded: input.permitIncluded,
      projectDurationText: input.projectDurationText ?? null,
      plywoodSheetsIncluded: input.plywoodSheetsIncluded ?? null,
      additionalPlywoodPrice: input.additionalPlywoodPrice ?? null,
      workmanshipWarrantyYears: input.workmanshipWarrantyYears ?? null,
      manufacturerWarranty: input.manufacturerWarranty ?? null,
      isEstimateOnly: input.isEstimateOnly,
      subtotalCost: breakdown.subtotalCost,
      totalPrice: breakdown.totalPrice,
    },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; estimateId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, estimateId } = await params;

  const existing = await prisma.roofEstimate.findFirst({
    where: { id: estimateId, leadId: id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.roofEstimate.delete({ where: { id: estimateId } });
  return NextResponse.json({ ok: true });
}
