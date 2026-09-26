/**
 * Which Money sub-panel a job should open on, and the one-line nudge above
 * it. Payments stays a click away (and in the header menu); the panel that
 * opens is the one with work left in it.
 */
export type MoneyPanel = "estimates" | "contract" | "invoices";

export type MoneyStep = { panel: MoneyPanel; title: string | null; body: string | null };

export function moneyStep(
  job: { jobType: string; contractAmount: number | string | null | undefined },
  contracts: { status: string }[],
): MoneyStep {
  if (job.jobType === "OWNED_REHAB") return { panel: "invoices", title: null, body: null };
  const amount = Number(job.contractAmount ?? 0);
  const signed = contracts.some((c) => c.status === "SIGNED");
  if (signed) return { panel: "invoices", title: null, body: null };
  const live = contracts.filter((c) => c.status === "DRAFT" || c.status === "SENT");
  if (live.length > 0) {
    const sent = live.some((c) => c.status === "SENT");
    return {
      panel: "contract",
      title: sent ? "Next: waiting on the customer's signature" : "Next: send the agreement for signature",
      body: sent
        ? "The agreement is with the customer. Resend it from the Contract panel if they have not seen it."
        : "The contract is generated but not sent. Open it, check the terms, and send it for e-signature.",
    };
  }
  if (amount === 0) {
    return {
      panel: "estimates",
      title: "Next: create an estimate, then generate the contract",
      body: "This job has no contract amount yet. Build the estimate, mark it accepted, and generate the customer contract from it.",
    };
  }
  return { panel: "invoices", title: null, body: null };
}
