import type { AllocatorPosting } from "@/lib/integrations/cc-allocator/postings";

/**
 * The two classes only cc-allocator's side can reveal, computed from its
 * export against the CRM's rows keyed by externalId:
 *
 *   missingInCrm  — cc-allocator holds a CRM expense id, the CRM has no row
 *                   with that externalId (deleted here after posting; it
 *                   will never retry).
 *   neverPosted   — a CRM job was picked but no expense exists yet, with
 *                   the reason in cc-allocator's own terms so the fix is
 *                   obvious: approve it there, turn the CRM leg on, or read
 *                   the error.
 *
 * Pure. The intake guard's PENDING holds are reported too, so a reviewer
 * sees why a posting has not moved money yet.
 */

export type NeverPostedReason =
  | "error"
  | "crm_leg_off"
  | "awaiting_approval"
  | "queued"
  | "failed"
  | "pending_settlement"
  | "marked_duplicate"
  | "not_attempted";

export const NEVER_POSTED_LABEL: Record<NeverPostedReason, string> = {
  error: "CRM rejected it",
  crm_leg_off: "CRM leg not requested",
  awaiting_approval: "awaiting approval in cc-allocator",
  queued: "queued for the worker",
  failed: "failed on cc-allocator's side",
  pending_settlement: "card charge not settled yet",
  marked_duplicate: "marked a duplicate in cc-allocator",
  not_attempted: "posted elsewhere, CRM leg never ran",
};

export type CrmExternalRow = { externalId: string; status: "PENDING" | "APPROVED" | "REJECTED"; id: string };

export type MissingPosting = AllocatorPosting;
export type NeverPosted = AllocatorPosting & { reason: NeverPostedReason };
export type HeldPosting = AllocatorPosting & { crmExpenseIdHere: string };

export type AllocatorClasses = {
  missingInCrm: MissingPosting[];
  neverPosted: NeverPosted[];
  heldPending: HeldPosting[];
  totals: {
    missing: { count: number; amount: number };
    neverPosted: { count: number; amount: number; credits: { count: number; amount: number } };
    held: { count: number; amount: number };
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function neverPostedReason(p: AllocatorPosting): NeverPostedReason {
  if (p.source === "card") {
    if (p.isPending) return "pending_settlement";
    if (p.duplicateOfId) return "marked_duplicate";
    if (p.lastCrmError) return "error";
    if (["UNREVIEWED", "SUGGESTED", "NEEDS_ATTENTION"].includes(p.status)) return "awaiting_approval";
    if (["APPROVED", "POSTING"].includes(p.status)) return "queued";
    if (p.status === "FAILED") return "failed";
    return "not_attempted";
  }
  if (!p.crmRequested) return "crm_leg_off";
  if (p.lastCrmError) return "error";
  if (["NEW", "MATCHED", "REVIEW", "NEEDS_ASSIGNMENT"].includes(p.status)) return "awaiting_approval";
  if (["APPROVED", "POSTING", "PARTIALLY_POSTED"].includes(p.status)) return "queued";
  if (p.status === "FAILED") return "failed";
  return "not_attempted";
}

export function classifyAllocatorPostings(postings: AllocatorPosting[], crmRows: CrmExternalRow[]): AllocatorClasses {
  const byExt = new Map(crmRows.map((r) => [r.externalId, r]));
  const missingInCrm: MissingPosting[] = [];
  const neverPosted: NeverPosted[] = [];
  const heldPending: HeldPosting[] = [];
  for (const p of postings) {
    const here = byExt.get(p.externalId);
    if (here) {
      if (here.status === "PENDING") heldPending.push({ ...p, crmExpenseIdHere: here.id });
      continue;
    }
    if (p.crmExpenseId) {
      missingInCrm.push(p);
      continue;
    }
    if (p.crmJobId) neverPosted.push({ ...p, reason: neverPostedReason(p) });
  }
  const sum = (xs: { amount: number }[]) => round2(xs.reduce((s, x) => s + x.amount, 0));
  const credits = neverPosted.filter((p) => p.amount < 0);
  const byAmountDesc = <T extends { amount: number }>(xs: T[]) => xs.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return {
    missingInCrm: byAmountDesc(missingInCrm),
    neverPosted: byAmountDesc(neverPosted),
    heldPending: byAmountDesc(heldPending),
    totals: {
      missing: { count: missingInCrm.length, amount: sum(missingInCrm) },
      neverPosted: { count: neverPosted.length, amount: sum(neverPosted), credits: { count: credits.length, amount: sum(credits) } },
      held: { count: heldPending.length, amount: sum(heldPending) },
    },
  };
}
