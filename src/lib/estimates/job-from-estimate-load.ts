import { prisma } from "@/lib/db/prisma";
import { onEstimateTransition } from "@/lib/tasks/auto-tasks";
import {
  autoWonEstimate,
  pricingFromGeneric,
  pricingFromRoof,
  type EstimatePricing,
  type EstimateRef,
} from "./job-from-estimate";

/**
 * The database side of `job-from-estimate.ts`: the estimates a lead offers at
 * Won, an estimate's pricing, and what the job takes from it.
 */
export type WonEstimateOption = {
  kind: "GENERIC" | "ROOF";
  id: string;
  estimateNumber: string;
  name: string;
  status: string | null;
  totalPrice: number;
  updatedAt: Date;
};

export async function wonEstimateOptions(leadId: string): Promise<WonEstimateOption[]> {
  const [generic, roof] = await Promise.all([
    prisma.estimate.findMany({
      where: { leadId, status: { not: "DECLINED" } },
      select: { id: true, estimateNumber: true, name: true, status: true, totalPrice: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.roofEstimate.findMany({
      where: { leadId },
      select: { id: true, estimateNumber: true, totalPrice: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  return [
    ...generic.map((e) => ({ kind: "GENERIC" as const, id: e.id, estimateNumber: e.estimateNumber, name: e.name, status: e.status, totalPrice: Number(e.totalPrice), updatedAt: e.updatedAt })),
    ...roof.map((e) => ({ kind: "ROOF" as const, id: e.id, estimateNumber: e.estimateNumber, name: "Roofing estimate", status: null, totalPrice: Number(e.totalPrice), updatedAt: e.updatedAt })),
  ];
}

/** The estimate a Won without the dialog uses (exactly one accepted), or null. */
export async function autoWonEstimateFor(leadId: string): Promise<EstimateRef | null> {
  return autoWonEstimate(await wonEstimateOptions(leadId));
}

/** An estimate's pricing; null when it is not on this lead (or does not exist). */
export async function loadEstimatePricing(leadId: string, ref: EstimateRef, chosenOptionalIds?: ReadonlySet<string>): Promise<{ pricing: EstimatePricing; estimateNumber: string; status: string | null } | null> {
  if (ref.kind === "ROOF") {
    const e = await prisma.roofEstimate.findFirst({ where: { id: ref.id, leadId }, select: { id: true, estimateNumber: true, subtotalCost: true, totalPrice: true } });
    if (!e) return null;
    return { pricing: pricingFromRoof({ id: e.id, estimateNumber: e.estimateNumber, subtotalCost: Number(e.subtotalCost), totalPrice: Number(e.totalPrice) }), estimateNumber: e.estimateNumber, status: null };
  }
  const e = await prisma.estimate.findFirst({
    where: { id: ref.id, leadId },
    select: {
      id: true,
      estimateNumber: true,
      status: true,
      marginPercent: true,
      discountEnabled: true,
      discountPercent: true,
      salesTaxPercent: true,
      sections: {
        orderBy: { sortOrder: "asc" },
        select: { title: true, items: { orderBy: { sortOrder: "asc" }, select: { id: true, description: true, unitType: true, quantity: true, unitPrice: true, isOptional: true } } },
      },
    },
  });
  if (!e) return null;
  const pricing = pricingFromGeneric(
    {
      id: e.id,
      estimateNumber: e.estimateNumber,
      marginPercent: Number(e.marginPercent),
      discountEnabled: e.discountEnabled,
      discountPercent: Number(e.discountPercent),
      salesTaxPercent: Number(e.salesTaxPercent),
      sections: e.sections.map((s) => ({
        title: s.title,
        items: s.items.map((i) => ({ id: i.id, description: i.description, unitType: i.unitType, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), isOptional: i.isOptional })),
      })),
    },
    chosenOptionalIds,
  );
  return { pricing, estimateNumber: e.estimateNumber, status: e.status };
}

/**
 * After the job is created from an estimate: its budget lines (only when the
 * job has none — a budget someone typed is never replaced), and the estimate
 * marked Accepted, which keeps it as it was (an accepted estimate is revised,
 * never edited).
 */
export async function applyEstimateToNewJob(jobId: string, ref: EstimateRef, pricing: EstimatePricing, status: string | null, actorUserId: string): Promise<void> {
  const existing = await prisma.budgetLine.count({ where: { jobId } });
  if (existing === 0 && pricing.budgetLines.length > 0) {
    await prisma.budgetLine.createMany({
      data: pricing.budgetLines.map((l, i) => ({ jobId, category: l.category, name: l.name, amount: l.amount, sortOrder: i, source: "estimate" })),
    });
  }
  if (ref.kind === "GENERIC" && status !== "ACCEPTED") {
    await prisma.estimate.update({ where: { id: ref.id }, data: { status: "ACCEPTED" } });
    await onEstimateTransition(ref.id, status ?? "DRAFT", "ACCEPTED", actorUserId);
  }
}
