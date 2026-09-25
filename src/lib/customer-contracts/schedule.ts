// Payment schedule math. Pure.

import type { PaymentScheduleItem, PaymentScheduleRow } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function validatePaymentSchedule(items: PaymentScheduleItem[]): string[] {
  const errors: string[] = [];
  if (items.length === 0) {
    errors.push("Add at least one payment stage");
    return errors;
  }
  const keys = new Set<string>();
  let sum = 0;
  items.forEach((it, i) => {
    const n = i + 1;
    if (!/^[a-z][a-z0-9_]*$/.test(it.key)) errors.push(`Stage ${n}: key must be lowercase letters, digits and underscores`);
    if (keys.has(it.key)) errors.push(`Stage ${n}: duplicate key "${it.key}"`);
    keys.add(it.key);
    if (!it.label.trim()) errors.push(`Stage ${n}: label required`);
    if (!Number.isFinite(it.percent) || it.percent < 0 || it.percent > 100) errors.push(`Stage ${n}: percent must be between 0 and 100`);
    else sum += it.percent;
  });
  if (Math.abs(sum - 100) > 0.005) errors.push(`Percents add up to ${round2(sum)}%, not 100%`);
  return errors;
}

/**
 * Cents per stage; the LAST stage absorbs the rounding remainder so the rows
 * sum to the total exactly (same trick the estimate PDFs use).
 */
export function computePaymentSchedule(total: number, items: PaymentScheduleItem[]): PaymentScheduleRow[] {
  const t = round2(total);
  if (items.length === 0) return [];
  const rows: PaymentScheduleRow[] = items.map((it) => ({ ...it, amount: round2((t * it.percent) / 100) }));
  const allocated = round2(rows.slice(0, -1).reduce((s, r) => s + r.amount, 0));
  rows[rows.length - 1].amount = round2(t - allocated);
  return rows;
}

/** The first stage is the deposit by convention; 0 when there is none. */
export function depositAmountOf(rows: PaymentScheduleRow[]): number {
  return rows.length > 0 ? rows[0].amount : 0;
}
