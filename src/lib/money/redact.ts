import type { JobMoneyView } from "./access";

/**
 * A job record trimmed to what its viewer may see of its money
 * (`jobMoneyView`). Pure. The record keeps its shape: a hidden field is null
 * (or an empty list), and `moneyView` tells the page what to leave out.
 */
const COST_FIELDS = ["laborCost", "marginType", "marginValue"] as const;
const PRICE_FIELDS = [
  "contractAmount",
  "originalContractAmount",
  "depositRequired",
  "depositReceived",
  "depositReceivedDate",
  "balanceDue",
  "retainagePercent",
  "finalPaymentDate",
] as const;

export function redactJobMoney<T extends Record<string, unknown>>(job: T, view: JobMoneyView): T & { moneyView: JobMoneyView } {
  if (view === "full") return { ...job, moneyView: view };
  const out: Record<string, unknown> = { ...job, moneyView: view };
  for (const f of COST_FIELDS) if (f in out) out[f] = null;
  if (view === "none") {
    for (const f of PRICE_FIELDS) if (f in out) out[f] = null;
    if ("payments" in out) out.payments = [];
  }
  return out as T & { moneyView: JobMoneyView };
}
