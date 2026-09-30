import { describe, expect, it } from "vitest";
import { WORKFLOW_SEED_GENERATIONS } from "../../../prisma/seeds/workflows";
import {
  SLIM_ABSORBS,
  SLIM_DROPPED,
  SLIM_NEW_STEPS,
  SLIM_PHASE_MAP,
  SLIM_TOGGLE_MAP,
  slimDestinationOf,
} from "../../../prisma/seeds/workflows/v2/mapping";
import type { TemplateDefinition } from "./templates/types";

/**
 * The v1 → streamlined mapping drives the one-time migration, so it is held
 * to the specs: no v1 step unaccounted for, no target that does not exist.
 */

const gen = (n: number): TemplateDefinition[] => WORKFLOW_SEED_GENERATIONS.map((t) => t.generations.find((g) => g.generation === n)!.definition);
const stepKeys = (defs: TemplateDefinition[]): string[] => defs.flatMap((d) => d.tasks.map((t) => `${d.key}:${t.key}`));
const phaseKeys = (defs: TemplateDefinition[]) => new Set(defs.flatMap((d) => d.phases.map((p) => `${d.key}:${p.key}`)));

const V1 = gen(1);
const SLIM = gen(2);

describe("v1 → streamlined mapping", () => {
  it("accounts for every v1 step exactly once — absorbed or dropped", () => {
    const absorbed = Object.values(SLIM_ABSORBS).flat();
    const seen = new Map<string, number>();
    for (const k of [...absorbed, ...Object.keys(SLIM_DROPPED)]) seen.set(k, (seen.get(k) ?? 0) + 1);
    const v1 = stepKeys(V1);
    expect(v1.filter((k) => !seen.has(k)), "v1 steps the mapping forgot").toEqual([]);
    expect(Array.from(seen.entries()).filter(([, n]) => n > 1).map(([k]) => k), "v1 steps mapped twice").toEqual([]);
    expect(Array.from(seen.keys()).filter((k) => !v1.includes(k)), "mapping names a v1 step that does not exist").toEqual([]);
    expect(v1).toHaveLength(34 + 74 + 85 + 81 + 75);
    expect(Object.keys(SLIM_DROPPED)).toHaveLength(21);
  });

  it("maps onto real streamlined steps, and every streamlined step has a source or is declared new", () => {
    const slim = stepKeys(SLIM);
    expect(Object.keys(SLIM_ABSORBS).filter((k) => !slim.includes(k)), "targets that do not exist").toEqual([]);
    const sourced = new Set([...Object.keys(SLIM_ABSORBS), ...SLIM_NEW_STEPS]);
    expect(slim.filter((k) => !sourced.has(k)), "streamlined steps with no source").toEqual([]);
    expect(SLIM_NEW_STEPS.filter((k) => !slim.includes(k))).toEqual([]);
    expect(Object.values(SLIM_ABSORBS).every((from) => from.length > 0)).toBe(true);
  });

  it("a step whose key exists in both generations lists itself — the row lives on and answers for itself", () => {
    const v1 = new Set(stepKeys(V1));
    for (const key of stepKeys(SLIM).filter((k) => v1.has(k))) {
      expect(SLIM_ABSORBS[key], key).toContain(key);
    }
    // …and only such a step may list its own key.
    for (const [key, from] of Object.entries(SLIM_ABSORBS)) {
      if (from.includes(key)) expect(v1.has(key), key).toBe(true);
    }
  });

  it("never carries a step across the permit branches", () => {
    const branch = (defs: TemplateDefinition[]) => new Map<string, string | null>(defs.flatMap((d) => d.tasks.map((t) => [`${d.key}:${t.key}`, t.conditionPermit] as const)));
    const from = branch(V1);
    const to = branch(SLIM);
    for (const [target, sources] of Object.entries(SLIM_ABSORBS)) {
      const t = to.get(target);
      if (!t) continue;
      // A branch step only absorbs steps of the same branch; an unconditional
      // step may absorb a branch step (it became a checklist line).
      for (const s of sources) expect(from.get(s), `${s} → ${target}`).toBe(t);
    }
  });

  it("resolves a v1 key to where it went", () => {
    expect(slimDestinationOf("core:confirm_jurisdiction")).toEqual({ to: "core:determine_permit_requirement" });
    expect(slimDestinationOf("roofing:submit_permit_package")).toEqual({ to: "core:submit_permit_application" });
    expect(slimDestinationOf("roofing:track_permit_review")).toMatchObject({ dropped: expect.stringContaining("Permits tab") });
    expect(slimDestinationOf("roofing:no_such_step")).toBeNull();
  });

  it("maps every v1 scope toggle of a template whose toggles changed", () => {
    for (const [moduleKey, map] of Object.entries(SLIM_TOGGLE_MAP)) {
      const v1 = V1.find((d) => d.key === moduleKey)!;
      const slim = new Set(SLIM.find((d) => d.key === moduleKey)!.scopeToggles.map((t) => t.key));
      expect(Object.keys(map).sort(), moduleKey).toEqual(v1.scopeToggles.map((t) => t.key).sort());
      for (const to of Object.values(map)) if (to) expect(slim.has(to), `${moduleKey} → ${to}`).toBe(true);
      // Every streamlined toggle is reachable from a v1 one.
      expect(Array.from(slim).filter((k) => !Object.values(map).includes(k)), moduleKey).toEqual([]);
    }
    // Templates not listed kept their toggles as they were.
    for (const d of V1.filter((x) => !(x.key in SLIM_TOGGLE_MAP))) {
      expect(SLIM.find((s) => s.key === d.key)!.scopeToggles.map((t) => t.key), d.key).toEqual(d.scopeToggles.map((t) => t.key));
    }
  });

  it("gives every v1 phase a streamlined home", () => {
    const slim = phaseKeys(SLIM);
    for (const p of phaseKeys(V1)) {
      const home = SLIM_PHASE_MAP[p] ?? p;
      expect(slim.has(home), `${p} → ${home}`).toBe(true);
    }
    for (const from of Object.keys(SLIM_PHASE_MAP)) expect(phaseKeys(V1).has(from), from).toBe(true);
  });
});
