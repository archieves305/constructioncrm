// Roof estimate math. Pure functions, no I/O — shared by API routes and PDF
// renderers so the totals on screen, in the DB snapshot, and on the printed
// PDFs cannot drift apart.

export type RoofMaterialKey = "SHINGLE" | "TILE" | "METAL" | "FLAT";

export type RoofTypeLine = {
  material: RoofMaterialKey;
  squares: number;
  laborRatePerSquare: number;
};

export type EstimateInput = {
  roofTypes: RoofTypeLine[];
  materialCost: number;
  materialSelection?: string | null;
  permitFee: number;
  dumpsterFee: number;
  tearOffFee: number;
  deckingFee: number;
  underlaymentFee: number;
  flashingVentFee: number;
  skylightChimneyFee: number;
  guttersFee: number;
  miscLabel?: string | null;
  miscFee: number;
  marginPercent: number;
  discountEnabled: boolean;
  discountPercent: number;
  salesTaxPercent: number;
};

export type RoofTypeBreakdown = RoofTypeLine & { laborTotal: number };

export type EstimateBreakdown = {
  roofTypes: RoofTypeBreakdown[];
  totalSquares: number;
  laborTotal: number;
  materialCost: number;
  materialSelection: string | null;
  permitFee: number;
  dumpsterFee: number;
  tearOffFee: number;
  deckingFee: number;
  underlaymentFee: number;
  flashingVentFee: number;
  skylightChimneyFee: number;
  guttersFee: number;
  miscLabel: string | null;
  miscFee: number;
  otherFeesTotal: number;
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

export function calculateEstimate(input: EstimateInput): EstimateBreakdown {
  const roofTypes: RoofTypeBreakdown[] = input.roofTypes.map((line) => ({
    ...line,
    laborTotal: round2(line.squares * line.laborRatePerSquare),
  }));

  const totalSquares = round2(
    roofTypes.reduce((sum, l) => sum + l.squares, 0),
  );
  const laborTotal = round2(
    roofTypes.reduce((sum, l) => sum + l.laborTotal, 0),
  );

  const otherFeesTotal = round2(
    input.permitFee +
      input.dumpsterFee +
      input.tearOffFee +
      input.deckingFee +
      input.underlaymentFee +
      input.flashingVentFee +
      input.skylightChimneyFee +
      input.guttersFee +
      input.miscFee,
  );

  const materialCost = round2(input.materialCost);
  const subtotalCost = round2(laborTotal + materialCost + otherFeesTotal);

  // True margin: price = cost / (1 - m%). 0% margin -> price equals cost.
  // Clamp margin so we never divide by zero (>= 100% would imply infinite price).
  const marginPct = Math.min(Math.max(input.marginPercent, 0), 99.999);
  const priceWithMargin = round2(subtotalCost / (1 - marginPct / 100));
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
    roofTypes,
    totalSquares,
    laborTotal,
    materialCost,
    materialSelection: input.materialSelection?.trim() || null,
    permitFee: round2(input.permitFee),
    dumpsterFee: round2(input.dumpsterFee),
    tearOffFee: round2(input.tearOffFee),
    deckingFee: round2(input.deckingFee),
    underlaymentFee: round2(input.underlaymentFee),
    flashingVentFee: round2(input.flashingVentFee),
    skylightChimneyFee: round2(input.skylightChimneyFee),
    guttersFee: round2(input.guttersFee),
    miscLabel: input.miscLabel?.trim() || null,
    miscFee: round2(input.miscFee),
    otherFeesTotal,
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

export const MATERIAL_LABELS: Record<RoofMaterialKey, string> = {
  SHINGLE: "Shingle",
  TILE: "Tile",
  METAL: "Metal",
  FLAT: "Flat",
};
