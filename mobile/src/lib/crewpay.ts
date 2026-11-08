import type { PhoneLaborContractDto } from "@crm/mobile-api";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A crew contract's total (with its change orders), what has been paid, and what is left. */
export function contractTotals(c: Pick<PhoneLaborContractDto, "contractAmount" | "changeOrders" | "payments">) {
  const total = r2(c.contractAmount + c.changeOrders.reduce((s, x) => s + x.amount, 0));
  const paid = r2(c.payments.reduce((s, x) => s + x.amount, 0));
  return { total, paid, remaining: r2(total - paid) };
}

export function contractName(c: Pick<PhoneLaborContractDto, "label" | "crew" | "vendor">): string {
  return c.crew?.name ?? c.vendor?.name ?? c.label ?? "Crew";
}

/** "$4,000.00" for amounts people check to the cent. */
export function dollars(n: number): string {
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** What was typed as an amount, or null: "$4,000.50" → 4000.5. */
export function parseAmount(s: string): number | null {
  const v = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}
