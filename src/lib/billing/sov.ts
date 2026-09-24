/**
 * Pure schedule-of-values helpers, shared by the change-order service and
 * its tests. No Prisma here.
 *
 * On a PROGRESS job an approved change order is not invoiced on its own: it
 * becomes one more line on the schedule of values, and the work gets billed
 * through the next payment applications as it is completed — which is how
 * the G702/G703 form treats change orders ("net change by change orders"
 * lives in the contract sum, and the G703 carries the added items).
 */

export type ExistingSovLine = { itemNo: number; sortOrder: number };

export type ChangeOrderForSov = { number: number; title: string | null; customerPrice: number | string };

export type NewSovLine = {
  itemNo: number;
  sortOrder: number;
  description: string;
  scheduledValue: number;
};

export function changeOrderSovDescription(co: Pick<ChangeOrderForSov, "number" | "title">): string {
  const title = co.title?.trim();
  return title ? `CO-${co.number}: ${title}` : `Change order CO-${co.number}`;
}

/**
 * The SOV line an approved change order adds: next item number and sort
 * position after everything already on the schedule, the change order's
 * price as its scheduled value.
 */
export function changeOrderSovLine(co: ChangeOrderForSov, existing: ExistingSovLine[]): NewSovLine {
  const itemNo = existing.reduce((m, l) => Math.max(m, l.itemNo), 0) + 1;
  const sortOrder = existing.reduce((m, l) => Math.max(m, l.sortOrder), -1) + 1;
  const scheduledValue = Math.round((Number(co.customerPrice) + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(scheduledValue) || scheduledValue <= 0) {
    throw new Error(`Change order CO-${co.number} has no positive price to schedule`);
  }
  return { itemNo, sortOrder, description: changeOrderSovDescription(co), scheduledValue };
}

/**
 * Whether an approved change order's SOV line can be removed with it: only
 * while nothing has been billed against the line. Once an application has
 * billed work on it, the money has to be unwound first (void the
 * application), exactly as an invoice with payments blocks the lump-sum path.
 */
export function canRemoveChangeOrderSovLine(billedOnLine: number): boolean {
  return billedOnLine === 0;
}
