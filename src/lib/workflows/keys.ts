/**
 * Key conventions for workflow tasks.
 *
 * A task inside a template has a short key ("permit_submit"). Once composed
 * onto a job it is addressed by its FULL key, "<module>:<task>"
 * ("roofing:permit_submit"), which is what `Task.workflowTaskKey` stores and
 * what the unique index on (instance, key) enforces. Phases follow the same
 * pattern ("roofing:permitting") so two modules may both have a "permitting"
 * phase without colliding.
 *
 * Cross-module references are restricted to Core ("core:contract_signed"):
 * trades must stay independently selectable, so a trade may never depend on
 * another trade.
 */

import type { WorkflowTemplateKind } from "@/generated/prisma/client";

export const CORE_MODULE_KEY = "core";

/**
 * "Determine permit requirement" — the one task every permit branch hangs
 * off. On a job it lives in Core; a VIOLATION template carries its own
 * (`isBaseKind`), so compose looks the gate up by the base module rather
 * than assuming Core.
 */
export const DETERMINE_PERMIT_TASK_KEY = "determine_permit_requirement";
export const DETERMINE_PERMIT_FULL_KEY = `${CORE_MODULE_KEY}:${DETERMINE_PERMIT_TASK_KEY}`;

/** A "base" module composes first and owns the permit gate: Core on a job, the VIOLATION template on a case. */
export function isBaseKind(kind: WorkflowTemplateKind): boolean {
  return kind === "CORE" || kind === "VIOLATION";
}

/** Full key of the permit gate for a set of modules, or null when no base module is present. */
export function permitGateKeyFor(modules: readonly { moduleKey: string; kind: WorkflowTemplateKind }[]): string | null {
  const base = modules.find((m) => isBaseKind(m.kind));
  return base ? fullKey(base.moduleKey, DETERMINE_PERMIT_TASK_KEY) : null;
}

export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function fullKey(moduleKey: string, shortKey: string): string {
  return `${moduleKey}:${shortKey}`;
}

export function splitFullKey(full: string): { moduleKey: string; shortKey: string } {
  const i = full.indexOf(":");
  if (i < 0) return { moduleKey: "", shortKey: full };
  return { moduleKey: full.slice(0, i), shortKey: full.slice(i + 1) };
}

/**
 * Resolve a dependency reference written inside `selfModule` to a full key.
 * "x" → "<self>:x"; "core:x" → "core:x". Any other prefix is rejected by
 * `defineTemplate`, so by the time refs reach here they are one of the two.
 */
export function resolveRef(ref: string, selfModule: string): string {
  if (ref.startsWith(`${CORE_MODULE_KEY}:`)) return ref;
  if (ref.includes(":")) throw new Error(`Only core: cross-module references are allowed: "${ref}"`);
  return fullKey(selfModule, ref);
}

/** The Task.sourceKey a workflow step is created with: "wf:<instanceId>:<fullKey>". */
export function sourceKeyFor(instanceId: string, taskFullKey: string): string {
  return `wf:${instanceId}:${taskFullKey}`;
}

/** Job-level scope toggles are stored per module: { roofing: { tear_off: true } }. */
export type ScopeToggleState = Record<string, Record<string, boolean>>;
