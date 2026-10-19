import { calculateGenericEstimate, type GenericLineInput } from "./generic-calc";

/**
 * What a job takes from the estimate its price came from (audit roadmap
 * Stage B, ruled 2026-10-19). Pure.
 *
 * The price the customer pays, the cost behind it (the job's baseline from
 * then on, frozen — editing the estimate later changes nothing on the job),
 * and the budget lines, one per section at cost. A sectioned estimate's
 * optional items count only when the customer chose them (at signing);
 * at Won none are chosen.
 */
export type EstimateRef = { kind: "GENERIC" | "ROOF"; id: string };

export type GenericEstimateForJob = {
  id: string;
  estimateNumber: string;
  marginPercent: number;
  discountEnabled: boolean;
  discountPercent: number;
  salesTaxPercent: number;
  sections: { title: string; items: (GenericLineInput & { id?: string })[] }[];
};

export type RoofEstimateForJob = { id: string; estimateNumber: string; subtotalCost: number; totalPrice: number };

export type EstimatePricing = {
  price: number;
  cost: number;
  budgetLines: { category: string; name: string; amount: number }[];
};

export function pricingFromGeneric(e: GenericEstimateForJob, chosenOptionalIds: ReadonlySet<string> = new Set()): EstimatePricing {
  const sections = e.sections.map((s) => ({
    title: s.title,
    items: s.items
      .filter((i) => !i.isOptional || (i.id !== undefined && chosenOptionalIds.has(i.id)))
      .map((i) => ({ ...i, isOptional: false })),
  }));
  const b = calculateGenericEstimate({
    sections,
    marginPercent: e.marginPercent,
    discountEnabled: e.discountEnabled,
    discountPercent: e.discountPercent,
    salesTaxPercent: e.salesTaxPercent,
  });
  return {
    price: b.totalPrice,
    cost: b.subtotalCost,
    budgetLines: b.sections
      .filter((s) => s.sectionSubtotal > 0)
      .map((s) => ({ category: `Estimate ${e.estimateNumber}`, name: s.title, amount: s.sectionSubtotal })),
  };
}

export function pricingFromRoof(e: RoofEstimateForJob): EstimatePricing {
  return {
    price: e.totalPrice,
    cost: e.subtotalCost,
    budgetLines: e.subtotalCost > 0 ? [{ category: `Estimate ${e.estimateNumber}`, name: "Roofing", amount: e.subtotalCost }] : [],
  };
}

type EstimateChoice = { kind: "GENERIC" | "ROOF"; id: string; status: string | null; updatedAt: Date | string };

/**
 * The estimate the Won dialog preselects: the one marked Accepted, else the
 * latest sent; none otherwise (a roofing estimate has no status, so it is
 * offered but never preselected).
 */
export function preselectWonEstimate(options: readonly EstimateChoice[]): EstimateRef | null {
  const latest = (status: string) =>
    options
      .filter((o) => o.kind === "GENERIC" && o.status === status)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  const pick = latest("ACCEPTED") ?? latest("SENT");
  return pick ? { kind: pick.kind, id: pick.id } : null;
}

/**
 * A Won with no dialog (the board, a bulk move): an estimate is used only when
 * exactly one is marked Accepted — nobody confirmed a pick, so nothing is guessed.
 */
export function autoWonEstimate(options: readonly EstimateChoice[]): EstimateRef | null {
  const accepted = options.filter((o) => o.kind === "GENERIC" && o.status === "ACCEPTED");
  return accepted.length === 1 ? { kind: "GENERIC", id: accepted[0].id } : null;
}
