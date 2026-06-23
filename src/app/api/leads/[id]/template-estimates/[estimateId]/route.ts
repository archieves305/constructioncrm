import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { genericEstimateInputSchema } from "@/lib/estimates/generic-schema";
import { buildSectionsCreate } from "@/lib/estimates/persist";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; estimateId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, estimateId } = await params;

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, leadId: id },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      sections: {
        orderBy: { sortOrder: "asc" },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!estimate) {
    return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
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

  const existing = await prisma.estimate.findFirst({
    where: { id: estimateId, leadId: id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  }

  const result = await validateBody(request, genericEstimateInputSchema);
  if (!result.ok) return result.response;
  const input = result.data;

  const { breakdown, sections } = buildSectionsCreate(input);

  // Replace sections/items wholesale (cascade removes old rows), then recreate.
  const updated = await prisma.$transaction(async (tx) => {
    await tx.estimateSection.deleteMany({ where: { estimateId } });
    return tx.estimate.update({
      where: { id: estimateId },
      data: {
        templateId: input.templateId ?? null,
        templateCategory: input.templateCategory,
        name: input.name,
        status: input.status,
        marginPercent: input.marginPercent,
        discountEnabled: input.discountEnabled,
        discountPercent: input.discountPercent,
        salesTaxPercent: input.salesTaxPercent,
        validityDays: input.validityDays,
        notes: input.notes ?? null,
        exclusions: input.exclusions ?? null,
        subtotalCost: breakdown.subtotalCost,
        totalPrice: breakdown.totalPrice,
        sections: { create: sections },
      },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
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

  const existing = await prisma.estimate.findFirst({
    where: { id: estimateId, leadId: id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  }

  await prisma.estimate.delete({ where: { id: estimateId } });
  return NextResponse.json({ ok: true });
}
