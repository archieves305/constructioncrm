import { fullKey, splitFullKey } from "./keys";

/**
 * Which of an instance's step rows belong to the template versions it pins.
 *
 * A job moved to a newer generation of templates keeps every row the
 * earlier one created — completed work is history, and nothing is ever
 * deleted. Those rows are "legacy": their key is no longer a step of the
 * pinned version. They stay on record (the Workflow tab folds them into an
 * "Earlier version" group) but they are not part of the workflow's progress:
 * counting forty completed micro-steps beside four milestones would show a
 * job as nearly done the day it was migrated.
 *
 * Pure, and derived on read — there is no legacy flag to keep in sync.
 */

/** Correction tasks hang off an inspection step: "<step key>:correction:<n>". */
const CORRECTION_MARK = ":correction:";

export type PinnedModule = { moduleKey: string; definition: { tasks: readonly { key: string }[] } };

export type PinnedSteps = { keys: ReadonlySet<string>; modules: ReadonlySet<string> };

export function pinnedSteps(modules: readonly PinnedModule[]): PinnedSteps {
  const keys = new Set<string>();
  for (const m of modules) for (const t of m.definition.tasks) keys.add(fullKey(m.moduleKey, t.key));
  return { keys, modules: new Set(modules.map((m) => m.moduleKey)) };
}

/** The same from flat rows, for callers that loaded only (module, step key) pairs. */
export function pinnedStepsOf(pairs: readonly { moduleKey: string; stepKey: string }[], moduleKeys: readonly string[]): PinnedSteps {
  return { keys: new Set(pairs.map((p) => fullKey(p.moduleKey, p.stepKey))), modules: new Set(moduleKeys) };
}

/**
 * True when the row is a step of a module the instance still has, but not of
 * the version it pins. A manual task (no key) is never legacy; a correction
 * task follows the step it corrects; a row of a module that was REMOVED from
 * the job is not legacy either — it is that trade's history, shown as such.
 */
export function isLegacyStep(taskKey: string | null | undefined, pinned: PinnedSteps): boolean {
  if (!taskKey) return false;
  const at = taskKey.indexOf(CORRECTION_MARK);
  const stepKey = at >= 0 ? taskKey.slice(0, at) : taskKey;
  const { moduleKey } = splitFullKey(stepKey);
  if (!pinned.modules.has(moduleKey)) return false;
  return !pinned.keys.has(stepKey);
}
