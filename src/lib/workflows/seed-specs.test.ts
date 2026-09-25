import { describe, expect, it } from "vitest";
import { WORKFLOW_TEMPLATE_SPECS } from "../../../prisma/seeds/workflows";
import { CORE } from "../../../prisma/seeds/workflows/core";
import { ROOFING } from "../../../prisma/seeds/workflows/roofing";
import { INTERIOR_RENOVATION } from "../../../prisma/seeds/workflows/interior-renovation";
import { DOORS_WINDOWS } from "../../../prisma/seeds/workflows/doors-windows";
import { CODE_VIOLATION } from "../../../prisma/seeds/workflows/code-violation";
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
  it("all five load with the spec's task counts", () => {
    expect(WORKFLOW_TEMPLATE_SPECS.map((s) => [s.key, s.tasks.length])).toEqual([
      ["core", 34],
      ["roofing", 74],
      ["interior_renovation", 85],
      ["doors_windows", 81],
      ["code_violation", 75],
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

  // The four v1 templates are pinned by every job that applied them. Their
  // content hash is what the seeder compares, so ANY drift — a renamed enum
  // value, a new field on TaskDef, an edited spec — makes prod's seed throw
  // SeedVersionInUseError. These literals were captured on 2026-09-25 before
  // the engine was generalised for code-violation cases; if this test fails
  // the fix is to undo the drift, not to update the hash.
  it("v1 template hashes are byte-identical to the deployed versions", () => {
    expect(contentHash(CORE)).toBe("aea86c0466b4b45d94746f39b6f86a7bf5d21a36999d5c1dd778bbcfa7dea272");
    expect(contentHash(ROOFING)).toBe("48bb6378c9d5ce25c9bc15f53d54c3e25337f909e0f6e31110746d87ea8ada8f");
    expect(contentHash(INTERIOR_RENOVATION)).toBe("bfdf0234bbf07b9f2211feff5d7a6050c9d1c08583aa669793881817547b1975");
    expect(contentHash(DOORS_WINDOWS)).toBe("92d95a6d99ca3abc671135b076f6f59bfd61f36fa4afaa3a4d5ade7431e0f8d5");
  });
});

/**
 * The code-violation template composes ALONE (no Core) onto a case. Its
 * permit gate is its own step; corrective construction is thin because the
 * work runs on the linked job; the closure step needs the agency's
 * confirmation. Counts pinned from the first compose run.
 */
describe("code_violation template", () => {
  const cv = (permitStatus: "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED", toggles: Record<string, boolean> = {}) =>
    compose({ modules: [mod(CODE_VIOLATION as typeof CORE)], permitStatus, scopeToggles: { code_violation: toggles } });
  const keys = (p: ReturnType<typeof compose>) => new Set(p.tasks.map((t) => t.shortKey));

  it("is a VIOLATION template with 8 phases + the no-permit branch, 6 toggles, and its own permit gate", () => {
    expect(CODE_VIOLATION.kind).toBe("VIOLATION");
    expect(CODE_VIOLATION.trade).toBeNull();
    expect(CODE_VIOLATION.phases.map((p) => p.key)).toEqual([
      "intake", "site_investigation", "strategy", "permit_required", "no_permit", "corrective_construction", "agency_compliance", "hearings_fines_liens", "closure",
    ]);
    expect(CODE_VIOLATION.scopeToggles.map((t) => t.key)).toEqual(["construction_required", "hearing_required", "fines_accruing", "lien_recorded", "emergency", "appeal"]);
    expect(CODE_VIOLATION.tasks.some((t) => t.key === "determine_permit_requirement")).toBe(true);
    expect(CODE_VIOLATION.dependencies.some((d) => d.dependsOnRef.startsWith("core:"))).toBe(false);
    expect(CODE_VIOLATION.tasks.some((t) => t.overridesCoreKey)).toBe(false);
  });

  it("composes without Core and routes the permit branches through its own gate", () => {
    const und = cv("UNDETERMINED");
    const req = cv("REQUIRED");
    const not = cv("NOT_REQUIRED");
    expect(und.permitGateKey).toBe("code_violation:determine_permit_requirement");
    expect(und.modules.map((m) => m.moduleKey)).toEqual(["code_violation"]);
    expect([und.tasks.length, req.tasks.length, not.tasks.length]).toEqual([43, 53, 47]);
    expect(und.warnings).toEqual([]);
    expect(req.warnings).toEqual([]);
    expect(not.warnings).toEqual([]);
    // Branches are exclusive and the no-permit branch is the shared legal block.
    expect(keys(req).has("confirm_permit_issued")).toBe(true);
    expect(keys(req).has("obtain_pm_approval_no_permit")).toBe(false);
    expect(keys(not).has("confirm_permit_issued")).toBe(false);
    expect(keys(not).has("obtain_pm_approval_no_permit")).toBe(true);
    expect(keys(und).has("confirm_permit_issued")).toBe(false);
    expect(keys(und).has("obtain_pm_approval_no_permit")).toBe(false);
    const noPermit = CODE_VIOLATION.phases.find((p) => p.key === "no_permit")!;
    expect(noPermit.conditionPermit).toBe("NOT_REQUIRED");
    expect(noPermit.band).toBe(PHASE_BANDS.PERMITTING);
    expect(noPermit.note).toBe(LEGAL_NO_PERMIT_WARNING);
    expect(CODE_VIOLATION.tasks.find((t) => t.key === "obtain_pm_approval_no_permit")!.blocking).toBe(true);
  });

  it("scope toggles add and remove whole groups without breaking the chain", () => {
    const all = Object.fromEntries(CODE_VIOLATION.scopeToggles.map((t) => [t.key, true]));
    const none = Object.fromEntries(CODE_VIOLATION.scopeToggles.map((t) => [t.key, false]));
    const on = cv("REQUIRED", all);
    const off = cv("NOT_REQUIRED", none);
    expect(on.tasks.length).toBe(71);
    expect(off.tasks.length).toBe(41);
    expect(on.warnings).toEqual([]);
    expect(off.warnings).toEqual([]);
    // Hearing + fines + lien groups, and the allOf mitigation step only when both are on.
    expect(keys(on).has("prepare_fine_mitigation_for_hearing")).toBe(true);
    expect(keys(cv("REQUIRED", { hearing_required: true })).has("prepare_fine_mitigation_for_hearing")).toBe(false);
    expect(keys(cv("REQUIRED", { hearing_required: true })).has("record_hearing_outcome")).toBe(true);
    expect(keys(cv("REQUIRED", { lien_recorded: true })).has("obtain_lien_release")).toBe(true);
    expect(keys(cv("REQUIRED", { emergency: true })).has("secure_site_emergency")).toBe(true);
    // Construction off: Phase 5 vanishes and agency compliance waits on management approval instead.
    expect(off.tasks.some((t) => t.phaseKey === "code_violation:corrective_construction")).toBe(false);
    expect(off.tasks.find((t) => t.shortKey === "mark_items_corrected")!.dependsOn.map((d) => d.key)).toEqual(["code_violation:obtain_management_owner_approval"]);
  });

  it("keeps corrective construction thin and never duplicates a trade's steps", () => {
    const construction = CODE_VIOLATION.tasks.filter((t) => t.phaseKey === "corrective_construction");
    expect(construction.map((t) => t.key)).toEqual(["create_or_link_job", "apply_trade_workflow_on_job", "confirm_materials_scheduling_on_job", "corrective_work_complete"]);
    expect(construction.every((t) => t.conditionAnyOf.includes("construction_required"))).toBe(true);
    const gate = construction.at(-1)!;
    expect(gate).toMatchObject({ blocking: true, requiredEvidence: "LINKED_JOB", requiredEvidenceParam: "COMPLETE" });
    // The only keys shared with the trades are permit steps: the shared legal
    // no-permit block, "confirm permit issued" and the gate itself. Keys are
    // module-prefixed on a task, so a shared short key never collides; this
    // pins that no CONSTRUCTION step was copied into the case template.
    const cvKeys = new Set(CODE_VIOLATION.tasks.map((t) => t.key));
    for (const trade of [ROOFING, INTERIOR_RENOVATION, DOORS_WINDOWS, CORE]) {
      const shared = trade.tasks.map((t) => t.key).filter((k) => cvKeys.has(k)).sort();
      expect(shared, trade.key).toEqual(
        trade.key === "core"
          ? ["determine_permit_requirement"]
          : ["confirm_permit_issued", "obtain_pm_approval_no_permit", "record_no_permit_confirmation", "upload_no_permit_support", "verify_no_permit_required"],
      );
    }
  });

  it("gates closure on the agency's confirmation and reopens on a failed reinspection", () => {
    const byKey = new Map(CODE_VIOLATION.tasks.map((t) => [t.key, t]));
    expect(byKey.get("close_case")).toMatchObject({ blocking: true, requiredEvidence: "AGENCY_CONFIRMATION" });
    expect(byKey.get("obtain_written_compliance_confirmation")).toMatchObject({ blocking: true, requiredEvidence: "AGENCY_CONFIRMATION" });
    expect(byKey.get("agency_reinspection")).toMatchObject({ blocking: true, requiredEvidence: "INSPECTION_RESULT" });
    expect(byKey.get("confirm_all_items_complete")).toMatchObject({ blocking: true, requiredEvidence: "VIOLATION_ITEMS", requiredEvidenceParam: "COMPLETE" });
    expect(byKey.get("create_violation_items")).toMatchObject({ blocking: true, requiredEvidence: "VIOLATION_ITEMS", requiredEvidenceParam: "EXISTS" });
    // Compliance-critical steps count back from the deadline; hearing prep from the hearing date.
    expect(byKey.get("submit_proof_of_correction")).toMatchObject({ anchor: "COMPLIANCE_DEADLINE", dueOffsetBusinessDays: -5 });
    expect(byKey.get("request_reinspection")).toMatchObject({ anchor: "COMPLIANCE_DEADLINE", dueOffsetBusinessDays: -3 });
    expect(byKey.get("prepare_hearing_evidence")).toMatchObject({ anchor: "HEARING_DATE", dueOffsetBusinessDays: -3 });
    // Case-manager steps resolve to the case's manager.
    expect(byKey.get("upload_review_notice")!.role).toBe("CASE_MANAGER");
  });
});
