import { randomBytes } from "node:crypto";
import {
  calculateGenericEstimate,
  type GenericEstimateInput,
} from "@/lib/estimates/generic-calc";
import type { GenericEstimateInputDto } from "@/lib/estimates/generic-schema";

// Estimate number scheme mirrors the roofing route: EST-YYYYMMDD-<hex>.
// (Copied rather than imported so the two engines stay decoupled.)
function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function generateEstimateNumber(now: Date = new Date()): string {
  return `EST-${formatDate(now)}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function dtoToBreakdownInput(
  dto: GenericEstimateInputDto,
): GenericEstimateInput {
  return {
    sections: dto.sections.map((s) => ({
      title: s.title,
      items: s.items.map((i) => ({
        description: i.description,
        unitType: i.unitType,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        isOptional: i.isOptional,
        notes: i.notes ?? null,
      })),
    })),
    marginPercent: dto.marginPercent,
    discountEnabled: dto.discountEnabled,
    discountPercent: dto.discountPercent,
    salesTaxPercent: dto.salesTaxPercent,
  };
}

// Builds the Prisma nested-create payload for an estimate's sections/items,
// stamping the computed lineTotal and a stable sortOrder per the input order.
export function buildSectionsCreate(dto: GenericEstimateInputDto) {
  const breakdown = calculateGenericEstimate(dtoToBreakdownInput(dto));
  const sections = dto.sections.map((section, sIdx) => ({
    title: section.title,
    sortOrder: sIdx,
    items: {
      create: section.items.map((item, iIdx) => ({
        description: item.description,
        unitType: item.unitType,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: breakdown.sections[sIdx].items[iIdx].lineTotal,
        isOptional: item.isOptional,
        notes: item.notes ?? null,
        sortOrder: iIdx,
      })),
    },
  }));
  return { breakdown, sections };
}
