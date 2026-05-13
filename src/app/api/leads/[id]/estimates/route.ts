import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { estimateInputSchema } from "@/lib/estimates/schema";
import { calculateEstimate } from "@/lib/estimates/calc";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;

  const estimates = await prisma.roofEstimate.findMany({
    where: { leadId: id },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return NextResponse.json(estimates);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const result = await validateBody(request, estimateInputSchema);
  if (!result.ok) return result.response;
  const input = result.data;

  const breakdown = calculateEstimate(input);

  const estimateNumber = `EST-${formatDate(new Date())}-${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;

  const created = await prisma.roofEstimate.create({
    data: {
      leadId: id,
      estimateNumber,
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
      createdByUserId: session.user.id,
    },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return NextResponse.json(created, { status: 201 });
}

function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
