import { describe, expect, it } from "vitest";
import { WORKFLOW_TEMPLATE_SPECS } from "../../../prisma/seeds/workflows";
import { CORE } from "../../../prisma/seeds/workflows/core";
import { ROOFING } from "../../../prisma/seeds/workflows/roofing";
import { INTERIOR_RENOVATION } from "../../../prisma/seeds/workflows/interior-renovation";
import { DOORS_WINDOWS } from "../../../prisma/seeds/workflows/doors-windows";
import { LEGAL_NO_PERMIT_WARNING, PHASE_BANDS } from "./templates/types";
import { compose, type ComposeModule } from "./compose";
import { contentHash } from "./seed";

/**
 * The seed files ARE the product content, so they get the same scrutiny as
 * code: every task from Richard's spec present, in order, wired so the
 * composed workflow behaves (permit branches exclusive, Mobilize gated,
 * Core closeout overridden by each trade).
 */

const mod = (def: typeof CORE): ComposeModule => ({
  moduleKey: def.key,
  kind: def.kind,
  name: def.name,
  trade: def.trade,
  versionId: `v-${def.key}`,
  version: 1,
  definition: def,
});

describe("seeded workflow templates", () => {
  it("all four load with the spec's task counts", () => {
    expect(WORKFLOW_TEMPLATE_SPECS.map((s) => [s.key, s.tasks.length])).toEqual([
      ["core", 34],
      ["roofing", 74],
      ["interior_renovation", 85],
      ["doors_windows", 81],
    ]);
  });

  it("keeps the spec's order inside each phase (spot checks)", () => {
    const titles = (def: typeof CORE, phase: string) => def.tasks.filter((t) => t.phaseKey === phase).map((t) => t.title);
    expect(titles(CORE, "job_setup").slice(0, 3)).toEqual([
      "Review executed contract and scope",
      "Confirm customer and property information",
      "Confirm contract value and payment schedule",
    ]);
    expect(titles(ROOFING, "installation")[0]).toBe("Mobilize");
    expect(titles(ROOFING, "installation").at(-1)).toBe("Complete corrective work");
    expect(titles(INTERIOR_RENOVATION, "construction")).toHaveLength(23);
    expect(titles(DOORS_WINDOWS, "closeout").at(-1)).toBe("Close doors and windows workflow");
  });

  it("every trade override points at a real Core task", () => {
    const coreKeys = new Set(CORE.tasks.map((t) => t.key));
    for (const def of [ROOFING, INTERIOR_RENOVATION, DOORS_WINDOWS]) {
      for (const t of def.tasks) {
        if (t.overridesCoreKey) expect(coreKeys.has(t.overridesCoreKey), `${def.key}:${t.key} → ${t.overridesCoreKey}`).toBe(true);
      }
    }
  });

  it("every core: reference resolves to a Core task", () => {
    const coreKeys = new Set(CORE.tasks.map((t) => t.key));
    for (const def of [ROOFING, INTERIOR_RENOVATION, DOORS_WINDOWS]) {
      for (const d of def.dependencies) {
        if (d.dependsOnRef.startsWith("core:")) {
          expect(coreKeys.has(d.dependsOnRef.slice(5)), `${def.key}:${d.taskKey} → ${d.dependsOnRef}`).toBe(true);
        }
      }
    }
  });

  it("permit phases sit at the permitting band and every No-Permit phase carries the exact legal warning", () => {
    for (const def of [ROOFING, INTERIOR_RENOVATION, DOORS_WINDOWS]) {
      const permit = def.phases.filter((p) => p.conditionPermit !== null);
      expect(permit.map((p) => p.conditionPermit).sort()).toEqual(["NOT_REQUIRED", "REQUIRED"]);
      for (const p of permit) expect(p.band).toBe(PHASE_BANDS.PERMITTING);
      expect(permit.find((p) => p.conditionPermit === "NOT_REQUIRED")!.note).toBe(LEGAL_NO_PERMIT_WARNING);
    }
  });

  it("scope toggles match the spec's lists", () => {
    expect(ROOFING.scopeToggles).toHaveLength(11);
    expect(INTERIOR_RENOVATION.scopeToggles).toHaveLength(11);
    expect(DOORS_WINDOWS.scopeToggles).toHaveLength(9);
  });

  describe("composed with Core", () => {
    for (const def of [ROOFING, INTERIOR_RENOVATION, DOORS_WINDOWS]) {
      it(`${def.key}: REQUIRED and NOT_REQUIRED are exclusive, and the mobilization gate follows the branch`, () => {
        const req = compose({ modules: [mod(CORE), mod(def)], permitStatus: "REQUIRED", scopeToggles: {} });
        const not = compose({ modules: [mod(CORE), mod(def)], permitStatus: "NOT_REQUIRED", scopeToggles: {} });
        const und = compose({ modules: [mod(CORE), mod(def)], permitStatus: "UNDETERMINED", scopeToggles: {} });
        const keys = (p: typeof req) => new Set(p.tasks.map((t) => t.key));
        expect(keys(req).has(`${def.key}:confirm_permit_issued`)).toBe(true);
        expect(keys(req).has(`${def.key}:obtain_pm_approval_no_permit`)).toBe(false);
        expect(keys(not).has(`${def.key}:confirm_permit_issued`)).toBe(false);
        expect(keys(not).has(`${def.key}:obtain_pm_approval_no_permit`)).toBe(true);
        expect(keys(und).has(`${def.key}:confirm_permit_issued`)).toBe(false);
        expect(keys(und).has(`${def.key}:obtain_pm_approval_no_permit`)).toBe(false);

        const gateKey = def.tasks.find((t) => t.phaseKey === (def.key === "interior_renovation" ? "construction" : "installation"))!.key;
        const gateDeps = (p: typeof req) => p.tasks.find((t) => t.key === `${def.key}:${gateKey}`)!.dependsOn.map((d) => d.key);
        expect(gateDeps(req)).toContain(`${def.key}:confirm_permit_issued`);
        expect(gateDeps(not)).toContain(`${def.key}:obtain_pm_approval_no_permit`);
        expect(gateDeps(und)).toContain("core:determine_permit_requirement");
        expect(req.warnings).toEqual([]);
        expect(not.warnings).toEqual([]);
      });

      it(`${def.key}: overrides Core's closeout so there is one final invoice, payment and close step`, () => {
        const plan = compose({ modules: [mod(CORE), mod(def)], permitStatus: "REQUIRED", scopeToggles: {} });
        const keys = plan.tasks.map((t) => t.key);
        for (const core of ["core:submit_final_invoice", "core:confirm_final_payment", "core:close_job", "core:collect_lien_releases", "core:complete_punch_list", "core:internal_quality_inspection"]) {
          expect(keys, core).not.toContain(core);
        }
        expect(plan.excluded.filter((e) => e.reason === "overridden").length).toBeGreaterThanOrEqual(6);
      });
    }

    it("all three trades on one job compose without warnings and every phase is non-empty", () => {
      const plan = compose({ modules: [mod(CORE), mod(ROOFING), mod(INTERIOR_RENOVATION), mod(DOORS_WINDOWS)], permitStatus: "REQUIRED", scopeToggles: {} });
      expect(plan.warnings).toEqual([]);
      expect(plan.phases.every((p) => p.taskKeys.length > 0)).toBe(true);
      // Core's overridden closeout tasks are suppressed once; each trade keeps its own.
      expect(plan.tasks.filter((t) => t.shortKey === "submit_final_invoice").map((t) => t.moduleKey).sort()).toEqual(["doors_windows", "interior_renovation", "roofing"]);
      // Bands are non-decreasing through the phase list.
      const bands = plan.phases.map((p) => p.band);
      expect([...bands].sort((a, b) => a - b)).toEqual(bands);
    });

    it("interior with every scope off still leaves a connected construction chain", () => {
      const off = Object.fromEntries(INTERIOR_RENOVATION.scopeToggles.map((t) => [t.key, false]));
      const plan = compose({ modules: [mod(CORE), mod(INTERIOR_RENOVATION)], permitStatus: "NOT_REQUIRED", scopeToggles: { interior_renovation: off } });
      const finishes = plan.tasks.find((t) => t.key === "interior_renovation:complete_final_finishes")!;
      expect(finishes.dependsOn.map((d) => d.key)).toEqual(["interior_renovation:mobilize_install_protection"]);
      expect(plan.warnings).toEqual([]);
    });
  });

  it("content hash is stable for identical definitions and ignores service-category suggestions", () => {
    expect(contentHash(CORE)).toBe(contentHash({ ...CORE }));
    expect(contentHash(ROOFING)).toBe(contentHash({ ...ROOFING, serviceCategoryNames: [] }));
    expect(contentHash(ROOFING)).not.toBe(contentHash({ ...ROOFING, name: "Roofing v2" }));
  });
});
