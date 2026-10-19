// Generic (template-driven) estimate math. Pure functions, no I/O — shared by
// the API routes, the builder UI live preview, and the PDF renderers so the
// totals on screen, in the DB snapshot, and on the printed PDFs cannot drift.
//
// Roofing has its own specialized engine in ./calc.ts; this one powers Drywall,
// Interior Renovation, Windows & Doors, and any future trade. It deliberately
// mirrors the roofing margin → discount → tax pipeline for consistency.

import type { EstimateCostType, EstimateUnitType } from "@/generated/prisma/enums";

export type GenericLineInput = {
  description: string;
  unitType: EstimateUnitType;
  quantity: number;
  /** The unit COST (what KNU pays); the margin turns the total into a price. */
  unitPrice: number;
  /** What the cost buys; untyped lines count as OTHER. */
  costType?: EstimateCostType;
  // Optional/informational lines (e.g. exclusions, notes) render but never sum.
  isOptional?: boolean;
  notes?: string | null;
};

export type GenericSectionInput = {
  title: string;
  items: GenericLineInput[];
};

export type GenericEstimateInput = {
  sections: GenericSectionInput[];
  marginPercent: number;
  /** Company overhead on top of the cost, before the margin. Defaults to 0. */
  overheadPercent?: number;
  discountEnabled: boolean;
  discountPercent: number;
  salesTaxPercent: number;
};

export const COST_TYPES: readonly EstimateCostType[] = ["LABOR", "MATERIAL", "SUB", "EQUIPMENT", "OTHER"];

export type GenericLineBreakdown = GenericLineInput & { lineTotal: number };

export type GenericSectionBreakdown = {
  title: string;
  items: GenericLineBreakdown[];
  sectionSubtotal: number;
};

export type GenericEstimateBreakdown = {
  sections: GenericSectionBreakdown[];
  subtotalCost: number;
  /** subtotalCost split by what it buys. */
  costByType: Record<EstimateCostType, number>;
  overheadPercent: number;
  overheadAmount: number;
  /** subtotalCost + overhead: what the margin is taken on. */
  costWithOverhead: number;
  marginPercent: number;
  marginAmount: number;
  priceWithMargin: number;
  discountEnabled: boolean;
  discountPercent: number;
  discountAmount: number;
  priceAfterDiscount: number;
  salesTaxPercent: number;
  salesTaxAmount: number;
  totalPrice: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function lineTotalOf(line: GenericLineInput): number {
  if (line.isOptional) return 0;
  return round2((line.quantity || 0) * (line.unitPrice || 0));
}

export function calculateGenericEstimate(
  input: GenericEstimateInput,
): GenericEstimateBreakdown {
  const sections: GenericSectionBreakdown[] = input.sections.map((section) => {
    const items: GenericLineBreakdown[] = section.items.map((line) => ({
      ...line,
      lineTotal: lineTotalOf(line),
    }));
    const sectionSubtotal = round2(
      items.reduce((sum, l) => sum + l.lineTotal, 0),
    );
    return { title: section.title, items, sectionSubtotal };
  });

  const subtotalCost = round2(
    sections.reduce((sum, s) => sum + s.sectionSubtotal, 0),
  );

  const costByType = Object.fromEntries(COST_TYPES.map((t) => [t, 0])) as Record<EstimateCostType, number>;
  for (const s of sections) for (const l of s.items) costByType[l.costType ?? "OTHER"] = round2(costByType[l.costType ?? "OTHER"] + l.lineTotal);

  // Overhead is added to the cost first; it is the company's, not the job's.
  const overheadPct = Math.min(Math.max(input.overheadPercent ?? 0, 0), 100);
  const overheadAmount = round2(subtotalCost * (overheadPct / 100));
  const costWithOverhead = round2(subtotalCost + overheadAmount);

  // True margin: price = cost / (1 - m%). 0% margin -> price equals cost.
  // Clamp margin so we never divide by zero (>= 100% would imply infinite price).
  const marginPct = Math.min(Math.max(input.marginPercent, 0), 99.999);
  const priceWithMargin =
    costWithOverhead > 0 ? round2(costWithOverhead / (1 - marginPct / 100)) : 0;
  const marginAmount = round2(priceWithMargin - costWithOverhead);

  // Discount applied AFTER margin, then sales tax on top.
  const discountPct = input.discountEnabled
    ? Math.min(Math.max(input.discountPercent, 0), 100)
    : 0;
  const discountAmount = round2(priceWithMargin * (discountPct / 100));
  const priceAfterDiscount = round2(priceWithMargin - discountAmount);

  const salesTaxPct = Math.min(Math.max(input.salesTaxPercent, 0), 100);
  const salesTaxAmount = round2(priceAfterDiscount * (salesTaxPct / 100));
  const totalPrice = round2(priceAfterDiscount + salesTaxAmount);

  return {
    sections,
    subtotalCost,
    costByType,
    overheadPercent: overheadPct,
    overheadAmount,
    costWithOverhead,
    marginPercent: marginPct,
    marginAmount,
    priceWithMargin,
    discountEnabled: input.discountEnabled,
    discountPercent: discountPct,
    discountAmount,
    priceAfterDiscount,
    salesTaxPercent: salesTaxPct,
    salesTaxAmount,
    totalPrice,
  };
}

export const UNIT_LABELS: Record<EstimateUnitType, string> = {
  EACH: "ea",
  OPENING: "opening",
  SHEET: "sheet",
  SQ_FT: "sq ft",
  LINEAR_FT: "ln ft",
  ROOM: "room",
  LUMP_SUM: "lump sum",
  LABOR_HOUR: "hr",
  SQUARE: "sq",
};

export const COST_TYPE_LABELS: Record<EstimateCostType, string> = {
  LABOR: "Labor",
  MATERIAL: "Material",
  SUB: "Subcontract",
  EQUIPMENT: "Equipment",
  OTHER: "Other",
};

// Human label for each template category — used by the picker, cards, and PDFs.
export const CATEGORY_LABELS: Record<string, string> = {
  ROOFING: "Roofing",
  DRYWALL: "Drywall",
  INTERIOR_RENOVATION: "Interior Renovation",
  WINDOWS_DOORS: "Windows & Doors",
};
