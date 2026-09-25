// Contract state machine and the money effects of signing. Pure.

import type { CustomerContractStatusValue } from "./types";

export type ContractFailure =
  | "not_found"
  | "expired"
  | "already_signed"
  | "already_decided"
  | "not_sent"
  | "not_draft"
  | "already_void"
  | "signed_exists"
  | "sent_exists"
  | "no_email"
  | "applications_issued"
  | "validation";

type Sibling = { id: string; status: CustomerContractStatusValue };

/** A DRAFT can be sent when no other contract on the job is out or signed. */
export function canSend(
  c: { id: string; status: CustomerContractStatusValue },
  siblings: Sibling[],
): { ok: true } | { ok: false; reason: "not_draft" | "signed_exists" | "sent_exists" } {
  if (c.status !== "DRAFT") return { ok: false, reason: "not_draft" };
  const others = siblings.filter((s) => s.id !== c.id);
  if (others.some((s) => s.status === "SIGNED")) return { ok: false, reason: "signed_exists" };
  if (others.some((s) => s.status === "SENT")) return { ok: false, reason: "sent_exists" };
  return { ok: true };
}

export function canResend(c: { status: CustomerContractStatusValue }): boolean {
  return c.status === "SENT";
}

export function canRegenerate(c: { status: CustomerContractStatusValue }): boolean {
  return c.status === "DRAFT";
}

export function canDelete(c: { status: CustomerContractStatusValue }): boolean {
  return c.status === "DRAFT";
}

export function canVoid(c: { status: CustomerContractStatusValue }): boolean {
  return c.status === "DRAFT" || c.status === "SENT" || c.status === "SIGNED";
}

/**
 * Same ordering as change orders: an expired link says "expired" even if the
 * contract was later decided some other way; a decided one says so before
 * "not sent".
 */
export function evaluateSignAttempt(
  c: { status: CustomerContractStatusValue; tokenExpiresAt: Date | null },
  now: Date,
): { ok: true } | { ok: false; reason: "expired" | "already_signed" | "already_decided" | "not_sent" } {
  if (c.status === "SIGNED") return { ok: false, reason: "already_signed" };
  if (c.status === "DECLINED" || c.status === "VOID") return { ok: false, reason: "already_decided" };
  if (c.status !== "SENT") return { ok: false, reason: "not_sent" };
  if (c.tokenExpiresAt && c.tokenExpiresAt.getTime() < now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

export type MoneyEffectInput = {
  jobType: "FIXED_PRICE" | "COST_PLUS" | "OWNED_REHAB";
  billingMethod: "LUMP_SUM" | "PROGRESS";
  jobTitle: string;
  contractTotal: number;
  depositAmount: number;
  /** Σ ChangeOrder.customerPrice where status = APPROVED. */
  approvedChangeOrderTotal: number;
  sovLines: { id: string; itemNo: number; changeOrderId: string | null; scheduledValue: number }[];
  /** Invoices with an applicationNumber that were issued (SENT / PAID / PARTIAL). */
  issuedApplicationCount: number;
};

export type SovEffect =
  | { action: "none" }
  | { action: "create"; itemNo: number; description: string; scheduledValue: number }
  | { action: "update"; lineId: string; scheduledValue: number }
  | { action: "skip"; reason: "applications_issued" | "multiple_base_lines" };

export type MoneyEffect = {
  /** null = leave Job.contractAmount alone (rollup job types recompute it). */
  contractAmount: number | null;
  depositRequired: number;
  sov: SovEffect;
  notes: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The signed contract is the BASE of the job's contract sum; approved change
 * orders sit on top (their approval already increments the job). Rollup job
 * types compute their contract from costs, so writing it would be clobbered.
 */
export function computeMoneyEffects(i: MoneyEffectInput): MoneyEffect {
  const notes: string[] = [];
  let contractAmount: number | null;
  if (i.jobType === "FIXED_PRICE") {
    contractAmount = round2(i.contractTotal + i.approvedChangeOrderTotal);
    if (i.approvedChangeOrderTotal !== 0) notes.push(`Contract sum includes ${money(i.approvedChangeOrderTotal)} of approved change orders on top of the signed ${money(i.contractTotal)}.`);
  } else {
    contractAmount = null;
    notes.push(`Job type ${i.jobType === "COST_PLUS" ? "cost-plus" : "owned rehab"} computes its contract from costs; the signed price ${money(i.contractTotal)} is recorded on the contract only.`);
  }

  let sov: SovEffect;
  if (i.billingMethod !== "PROGRESS") {
    sov = { action: "none" };
  } else if (i.issuedApplicationCount > 0) {
    sov = { action: "skip", reason: "applications_issued" };
    notes.push(`${i.issuedApplicationCount} payment application${i.issuedApplicationCount === 1 ? " has" : "s have"} already been issued; the schedule of values was left unchanged — reconcile it on the Invoices tab.`);
  } else {
    const base = i.sovLines.filter((l) => l.changeOrderId == null);
    if (base.length === 0) {
      const itemNo = i.sovLines.reduce((m, l) => Math.max(m, l.itemNo), 0) + 1;
      sov = { action: "create", itemNo, description: i.jobTitle, scheduledValue: round2(i.contractTotal) };
    } else if (base.length === 1) {
      sov = { action: "update", lineId: base[0].id, scheduledValue: round2(i.contractTotal) };
    } else {
      sov = { action: "skip", reason: "multiple_base_lines" };
      notes.push(`The schedule of values has ${base.length} base lines; it was left unchanged — redistribute ${money(i.contractTotal)} across them on the Invoices tab.`);
    }
  }

  return { contractAmount, depositRequired: round2(i.depositAmount), sov, notes };
}

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
