/**
 * Does completing this task take more than a click?
 *
 * A workflow step with an unticked checklist line or a record gate cannot be
 * completed from a bare checkbox — the server would refuse and the person
 * would get a red toast with nothing to do about it. Lists and cards ask
 * this first and open the step instead, where the checklist, the attach
 * button and the gate are in view.
 *
 * Pure and client-safe. The server stays the authority (`checkEvidence`).
 */
export function stepHasOpenRequirement(task: { workflowTaskKey?: string | null; requiredEvidence?: string | null; checklist?: unknown }): boolean {
  if (!task.workflowTaskKey) return false;
  if (task.requiredEvidence) return true;
  if (!Array.isArray(task.checklist)) return false;
  return task.checklist.some((c) => c && typeof c === "object" && (c as { done?: unknown }).done !== true);
}
