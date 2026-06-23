import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { genericEstimateInputSchema } from "@/lib/estimates/generic-schema";
import {
  buildSectionsCreate,
  generateEstimateNumber,
} from "@/lib/estimates/persist";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;

  const estimates = await prisma.estimate.findMany({
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

  const result = await validateBody(request, genericEstimateInputSchema);
  if (!result.ok) return result.response;
  const input = result.data;

  const { breakdown, sections } = buildSectionsCreate(input);

  const created = await prisma.estimate.create({
    data: {
      leadId: id,
      templateId: input.templateId ?? null,
      templateCategory: input.templateCategory,
      estimateNumber: generateEstimateNumber(),
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
      createdByUserId: session.user.id,
      sections: { create: sections },
    },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return NextResponse.json(created, { status: 201 });
}
