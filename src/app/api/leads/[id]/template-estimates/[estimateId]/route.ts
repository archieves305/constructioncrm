import { NextRequest, NextResponse, after } from "next/server";
import { onEstimateTransition } from "@/lib/tasks/auto-tasks";
import { onEstimateSent } from "@/lib/nurture/hooks";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { z } from "zod";
import { ESTIMATE_STATUSES, genericEstimateInputSchema } from "@/lib/estimates/generic-schema";
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
    select: { id: true, status: true },
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
        status: input.status ?? existing.status,
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

  // SENT raises a follow-up; ACCEPTED / DECLINED retire it. Post-commit.
  if (updated.status !== existing.status) {
    const from = existing.status;
    const to = updated.status;
    const actorUserId = session.user.id;
    after(async () => {
      await onEstimateTransition(estimateId, from, to, actorUserId);
      if (to === "SENT") await onEstimateSent(id);
    });
  }

  return NextResponse.json(updated);
}

const statusOnlySchema = z.object({ status: z.enum(ESTIMATE_STATUSES) });

/**
 * PATCH — change only the status (Mark sent / accepted / declined) without
 * round-tripping the whole estimate. Same follow-up hooks as PUT.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; estimateId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, estimateId } = await params;

  const existing = await prisma.estimate.findFirst({
    where: { id: estimateId, leadId: id },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  }

  const result = await validateBody(request, statusOnlySchema);
  if (!result.ok) return result.response;
  const to = result.data.status;

  const updated = await prisma.estimate.update({
    where: { id: estimateId },
    data: { status: to },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (to !== existing.status) {
    const from = existing.status;
    const actorUserId = session.user.id;
    after(async () => {
      await onEstimateTransition(estimateId, from, to, actorUserId);
      if (to === "SENT") await onEstimateSent(id);
    });
  }

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
