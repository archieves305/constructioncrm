/**
 * One-tap Done for an ordinary task, and the Undo that puts it back exactly as
 * it was (a blocked task gets its reason back, which the server requires).
 * Client-safe. A workflow step is never quick-completed here: its gates and
 * checklist decide, in the workflow block.
 */
export type QuickDoneTask = {
  status: string;
  blockedReason?: string | null;
  workflowTaskKey?: string | null;
};

export function canQuickComplete(t: QuickDoneTask): boolean {
  return !t.workflowTaskKey && t.status !== "COMPLETED" && t.status !== "CANCELLED";
}

export function canQuickReopen(t: QuickDoneTask): boolean {
  return !t.workflowTaskKey && t.status === "COMPLETED";
}

/** The PATCH body that undoes a completion from `prior`. */
export function undoPatch(prior: QuickDoneTask): { status: string; blockedReason?: string } {
  if (prior.status === "BLOCKED" && prior.blockedReason) return { status: "BLOCKED", blockedReason: prior.blockedReason };
  if (prior.status === "COMPLETED" || prior.status === "CANCELLED" || prior.status === "BLOCKED") return { status: "PENDING" };
  return { status: prior.status };
}
