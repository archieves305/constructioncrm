import { CORE_MODULE_KEY } from "./keys";
import type { ComposeModule } from "./compose";

/**
 * Which template versions may sit together on one job, and which version
 * may replace which. Pure.
 *
 * Two rules keep a job from ending up half on one generation of templates
 * and half on another:
 *
 *  - An in-place upgrade only follows a LINEAGE. The editor's drafts are
 *    copies of the version they started from (`sourceVersionId`), so v1 →
 *    an edited v2 is an upgrade. A seeded generation starts a new lineage:
 *    the streamlined templates share almost no steps with the long-form
 *    ones, and "upgrading" a job to them would cancel its open work and
 *    leave the rows it kept with their old checklists. Those jobs move by
 *    the one-time migration instead.
 *  - A trade must fit the job's Core: every Core step it waits on or
 *    overrides has to exist in the Core version the job pins.
 */

export type VersionLink = { id: string; sourceVersionId: string | null };

/** True when `versionId` was derived, directly or through drafts, from `ancestorId`. */
export function descendsFrom(versions: readonly VersionLink[], versionId: string, ancestorId: string): boolean {
  const byId = new Map(versions.map((v) => [v.id, v]));
  const seen = new Set<string>();
  let cur = byId.get(versionId)?.sourceVersionId ?? null;
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = byId.get(cur)?.sourceVersionId ?? null;
  }
  return false;
}

type CompatModule = Pick<ComposeModule, "moduleKey" | "kind" | "name"> & { definition: Pick<ComposeModule["definition"], "tasks" | "dependencies"> };

/** Core steps `trade` refers to — by dependency or by override — that `core` does not have. */
export function missingCoreKeys(core: CompatModule | undefined, trade: CompatModule): string[] {
  if (trade.kind !== "TRADE") return [];
  const have = new Set((core?.definition.tasks ?? []).map((t) => t.key));
  const wanted = new Set<string>();
  for (const d of trade.definition.dependencies) {
    if (d.dependsOnRef.startsWith(`${CORE_MODULE_KEY}:`)) wanted.add(d.dependsOnRef.slice(CORE_MODULE_KEY.length + 1));
  }
  for (const t of trade.definition.tasks) if (t.overridesCoreKey) wanted.add(t.overridesCoreKey);
  return Array.from(wanted).filter((k) => !have.has(k)).sort();
}

/** The trades in `modules` that do not fit its Core, with what each is missing. */
export function incompatibleTrades(modules: readonly CompatModule[]): { moduleKey: string; name: string; missing: string[] }[] {
  const core = modules.find((m) => m.kind === "CORE");
  return modules.flatMap((m) => {
    const missing = missingCoreKeys(core, m);
    return missing.length > 0 ? [{ moduleKey: m.moduleKey, name: m.name, missing }] : [];
  });
}

export const MIXED_GENERATION_MESSAGE =
  "This job is on the earlier workflow; its templates cannot be mixed with the streamlined ones. It moves to the streamlined workflow with the one-time migration.";
