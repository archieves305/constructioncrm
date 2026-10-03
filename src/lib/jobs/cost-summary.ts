/**
 * A job's cost position, in one place.
 *
 * Before this the job page and Collections each computed "profit" their own
 * way and neither showed budget, commitments or a projection. This is the one
 * formula both read. Pure: the loader gathers the inputs.
 *
 * Crew labor counts when the labor contract is signed (Richard, 2026-10-02):
 * the whole contract is cost from day one, and the part not yet paid is shown
 * as "committed, not yet paid" so the projection includes what has been
 * promised. Hourly field labor counts as it is worked; expenses once approved.
 *
 * Other promises — a material order, a subcontract with no labor contract —
 * are commitments (lib/vendors/commitments.ts). Their unspent part joins
 * "committed" here and nowhere else. It never passes through `Job.laborCost`:
 * on a cost-plus job that figure sets what the customer owes.
 */
export type CostSummaryInput = {
  jobType: "FIXED_PRICE" | "COST_PLUS" | "OWNED_REHAB";
  /** Job.contractAmount as it stands. */
  revisedContract: number;
  /** Job.originalContractAmount, when a signed contract recorded it. */
  storedOriginalContract: number | null;
  /** Σ approved customer change orders. */
  approvedChangeOrders: number;
  /** Σ approved billable expenses (each already raised the contract on a fixed-price job). */
  approvedBillableAddOns: number;
  /** Σ budget lines; null when the job has none. */
  budgetTotal: number | null;
  /** Cost behind the signed estimate, as a fallback when there is no budget; null when unknown. */
  estimateCost: number | null;
  /** Job.laborCost: crew labor contracts plus their change orders (or the single manual figure). */
  laborContracts: number;
  /** Σ payments made against those labor contracts. */
  laborPaid: number;
  /** Hourly field labor worked and not yet posted through payroll. */
  fieldLaborUnposted: number;
  /** Σ approved expenses (payroll-posted labor included; credits negative). */
  expenses: number;
  /** Σ open commitments' unspent part: promised to vendors, no expense against it yet. */
  commitmentsOpen: number;
  /** Σ invoices issued (sent or paid), any kind. */
  billedToDate: number;
  /** Σ payments received. */
  collected: number;
};

export type CostSummary = {
  /** False for an owned rehab: it is never billed, so there is no contract or profit. */
  billable: boolean;
  originalContract: number | null;
  approvedChangeOrders: number;
  billableAddOns: number;
  revisedContract: number;
  /** The cost the job was expected to take: its budget, else the signed estimate's cost. */
  estimatedCost: number | null;
  estimatedCostSource: "budget" | "estimate" | null;
  /** Money out or work done: labor paid + field labor + approved expenses. */
  spent: number;
  /** Crew labor contracted and not yet paid. */
  laborCommittedOpen: number;
  /** Open commitments to vendors, less what approved expenses have drawn. */
  commitmentsOpen: number;
  /** Everything promised and not yet paid: laborCommittedOpen + commitmentsOpen. */
  committedOpen: number;
  /** spent + committedOpen — the "cost" Collections has always shown. */
  committed: number;
  /** What the job will cost: the estimate, or the commitments once they pass it. */
  projectedCost: number;
  /** projectedCost − spent. */
  remainingCost: number;
  projectedProfit: number | null;
  /** Fraction of the revised contract, e.g. 0.37. */
  projectedMargin: number | null;
  /** True when commitments already exceed the estimated cost. */
  overBudget: boolean;
  /** committed ÷ projectedCost; null with no estimate to measure against. */
  percentCostComplete: number | null;
  billedToDate: number;
  collected: number;
  /** billed − (revised contract × percent cost complete): positive = billed ahead of the work. Null with no estimate. */
  overUnderBilled: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The cost behind a signed contract's source estimate — the fallback
 * "estimated cost" for a job with no budget. A contract has one source: a
 * sectioned estimate or a roofing estimate. Null when neither is attached
 * (the estimate was deleted) or it carries no cost.
 */
export function signedEstimateCost(contract: {
  estimate?: { subtotalCost: unknown } | null;
  roofEstimate?: { subtotalCost: unknown } | null;
}): number | null {
  const source = contract.estimate ?? contract.roofEstimate ?? null;
  if (!source || source.subtotalCost === null || source.subtotalCost === undefined) return null;
  const cost = Number(source.subtotalCost);
  return Number.isFinite(cost) ? cost : null;
}

export function computeCostSummary(i: CostSummaryInput): CostSummary {
  const billable = i.jobType !== "OWNED_REHAB";

  // A fixed-price contract is base + change orders + billable add-ons, so the
  // base can be recovered when no signed contract stored it. Rollup job types
  // compute their contract from cost and have no "original".
  const originalContract =
    i.storedOriginalContract ??
    (i.jobType === "FIXED_PRICE" ? round2(i.revisedContract - i.approvedChangeOrders - i.approvedBillableAddOns) : null);

  const estimatedCost = i.budgetTotal ?? i.estimateCost;
  const estimatedCostSource = i.budgetTotal !== null ? "budget" : i.estimateCost !== null ? "estimate" : null;

  const spent = round2(i.laborPaid + i.fieldLaborUnposted + i.expenses);
  const laborCommittedOpen = round2(Math.max(0, i.laborContracts - i.laborPaid));
  const commitmentsOpen = round2(Math.max(0, i.commitmentsOpen));
  const committedOpen = round2(laborCommittedOpen + commitmentsOpen);
  const committed = round2(spent + committedOpen);

  const projectedCost = estimatedCost !== null ? Math.max(estimatedCost, committed) : committed;
  const remainingCost = round2(Math.max(0, projectedCost - spent));
  // With no estimate and no cost on file, "profit" would be the contract
  // restated at a 100% margin. Say nothing until there is something to measure.
  const measurable = billable && (estimatedCost !== null || committed !== 0);
  const projectedProfit = measurable ? round2(i.revisedContract - projectedCost) : null;
  const projectedMargin = measurable && i.revisedContract > 0 ? (i.revisedContract - projectedCost) / i.revisedContract : null;

  const percentCostComplete = estimatedCost !== null && projectedCost > 0 ? Math.min(1, committed / projectedCost) : null;
  const overUnderBilled = billable && percentCostComplete !== null ? round2(i.billedToDate - i.revisedContract * percentCostComplete) : null;

  return {
    billable,
    originalContract: billable ? originalContract : null,
    approvedChangeOrders: i.approvedChangeOrders,
    billableAddOns: i.approvedBillableAddOns,
    revisedContract: i.revisedContract,
    estimatedCost,
    estimatedCostSource,
    spent,
    laborCommittedOpen,
    commitmentsOpen,
    committedOpen,
    committed,
    projectedCost: round2(projectedCost),
    remainingCost,
    projectedProfit,
    projectedMargin,
    overBudget: estimatedCost !== null && committed > estimatedCost,
    percentCostComplete,
    billedToDate: i.billedToDate,
    collected: i.collected,
    overUnderBilled,
  };
}
