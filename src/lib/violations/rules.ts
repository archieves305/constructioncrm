import type { CodeViolationItemStatus, CodeViolationStatus } from "@/generated/prisma/client";

/**
 * The pure rules a case obeys: which lifecycle moves are allowed, what
 * blocks closure, which items a failed reinspection reopens.
 */

const OPEN: readonly CodeViolationStatus[] = ["NEW", "ACTIVE", "ON_HOLD", "APPEALED", "COMPLIED"];

export function isOpenCaseStatus(s: CodeViolationStatus): boolean {
  return OPEN.includes(s);
}

export const OPEN_CASE_STATUSES = OPEN;

/** Lifecycle moves a person may make from the Change-status menu. Closure goes through closeCase. */
export function allowedTransitions(from: CodeViolationStatus): CodeViolationStatus[] {
  switch (from) {
    case "NEW":
      return ["ACTIVE", "ON_HOLD", "CANCELLED"];
    case "ACTIVE":
      return ["ON_HOLD", "APPEALED", "CANCELLED"];
    case "ON_HOLD":
      return ["ACTIVE", "CANCELLED"];
    case "APPEALED":
      return ["ACTIVE", "ON_HOLD", "CANCELLED"];
    case "COMPLIED":
      return ["ACTIVE", "ON_HOLD"];
    case "CLOSED":
    case "CANCELLED":
      return [];
  }
}

/** Transitions that need a written reason. */
export function transitionNeedsReason(to: CodeViolationStatus): boolean {
  return to === "ON_HOLD" || to === "CANCELLED";
}

export type ClosureBlocker = { key: "items" | "agency" | "lien" | "fines" | "steps"; message: string };

/**
 * Why a case cannot close yet. Every blocker is listed, not just the first,
 * so the dialog can show the whole picture. An ADMIN/MANAGER may close past
 * them with a written reason (audited separately).
 */
export function closureBlockers(input: {
  items: { status: CodeViolationItemStatus }[];
  agencyConfirmedAt: Date | null;
  lienStatus: "NONE" | "RECORDED" | "RELEASED";
  officialBalance: number | null;
  fineResolvedAt: Date | null;
  openBlockingSteps: number;
}): ClosureBlocker[] {
  const out: ClosureBlocker[] = [];
  const openItems = input.items.filter((i) => i.status !== "VERIFIED" && i.status !== "WITHDRAWN").length;
  if (openItems > 0) out.push({ key: "items", message: `${openItems} violation item${openItems === 1 ? " is" : "s are"} not yet verified or withdrawn` });
  if (!input.agencyConfirmedAt) out.push({ key: "agency", message: "No agency compliance confirmation is recorded" });
  if (input.lienStatus === "RECORDED") out.push({ key: "lien", message: "A lien is recorded and not yet released" });
  if (input.officialBalance !== null && input.officialBalance > 0 && !input.fineResolvedAt) out.push({ key: "fines", message: "The official balance is not resolved" });
  if (input.openBlockingSteps > 0) out.push({ key: "steps", message: `${input.openBlockingSteps} blocking workflow step${input.openBlockingSteps === 1 ? " is" : "s are"} still open` });
  return out;
}

/** Items the agency re-cited on a failed reinspection go back to OPEN; withdrawn ones stay withdrawn. */
export function itemsToReopen<T extends { id: string; status: CodeViolationItemStatus }>(items: T[], failedItemIds: string[]): T[] {
  const failed = new Set(failedItemIds);
  return items.filter((i) => failed.has(i.id) && (i.status === "CORRECTED" || i.status === "VERIFIED" || i.status === "IN_PROGRESS"));
}
