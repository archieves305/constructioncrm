// How one change order moves a fixed-price contract, for the change-order
// form. Approved change orders are already inside Job.contractAmount (approval
// increments it), so the original sum is the signed base when a contract
// recorded one, else the current sum less every approved change.

export type ContractSumInput = {
  jobType: string;
  contractAmount: number;
  originalContractAmount: number | null;
  /** Every APPROVED change order on the job, this one included if approved. */
  approved: { number: number; customerPrice: number }[];
  thisNumber: number;
  thisPrice: number;
};

export type ContractSum = {
  original: number;
  previousChanges: number;
  beforeThis: number;
  revised: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** Null for cost-plus / owned-rehab jobs and jobs with no contract sum yet. */
export function changeOrderContractSum(input: ContractSumInput): ContractSum | null {
  if (input.jobType !== "FIXED_PRICE") return null;
  const allApproved = input.approved.reduce((s, c) => s + c.customerPrice, 0);
  const original = cents(input.originalContractAmount ?? input.contractAmount - allApproved);
  if (original <= 0) return null;
  const previousChanges = cents(
    input.approved
      .filter((c) => c.number < input.thisNumber)
      .reduce((s, c) => s + c.customerPrice, 0),
  );
  const beforeThis = cents(original + previousChanges);
  return {
    original,
    previousChanges,
    beforeThis,
    revised: cents(beforeThis + input.thisPrice),
  };
}
