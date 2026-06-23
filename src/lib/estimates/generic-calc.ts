// Generic (template-driven) estimate math. Pure functions, no I/O — shared by
// the API routes, the builder UI live preview, and the PDF renderers so the
// totals on screen, in the DB snapshot, and on the printed PDFs cannot drift.
//
// Roofing has its own specialized engine in ./calc.ts; this one powers Drywall,
// Interior Renovation, Windows & Doors, and any future trade. It deliberately
// mirrors the roofing margin → discount → tax pipeline for consistency.

import type { EstimateUnitType } from "@/generated/prisma/enums";

export type GenericLineInput = {
  description: string;
  unitType: EstimateUnitType;
  quantity: number;
  unitPrice: number;
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
  discountEnabled: boolean;
  discountPercent: number;
  salesTaxPercent: number;
};

export type GenericLineBreakdown = GenericLineInput & { lineTotal: number };

export type GenericSectionBreakdown = {
  title: string;
  items: GenericLineBreakdown[];
  sectionSubtotal: number;
};

export type GenericEstimateBreakdown = {
  sections: GenericSectionBreakdown[];
  subtotalCost: number;
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

  // True margin: price = cost / (1 - m%). 0% margin -> price equals cost.
  // Clamp margin so we never divide by zero (>= 100% would imply infinite price).
  const marginPct = Math.min(Math.max(input.marginPercent, 0), 99.999);
  const priceWithMargin =
    subtotalCost > 0 ? round2(subtotalCost / (1 - marginPct / 100)) : 0;
  const marginAmount = round2(priceWithMargin - subtotalCost);

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
};

// Human label for each template category — used by the picker, cards, and PDFs.
export const CATEGORY_LABELS: Record<string, string> = {
  ROOFING: "Roofing",
  DRYWALL: "Drywall",
  INTERIOR_RENOVATION: "Interior Renovation",
  WINDOWS_DOORS: "Windows & Doors",
};
