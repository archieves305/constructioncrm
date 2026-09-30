import { describe, expect, it } from "vitest";
import { WORKFLOW_SEED_GENERATIONS, WORKFLOW_TEMPLATE_SPECS } from "../../../prisma/seeds/workflows";
import { CORE } from "../../../prisma/seeds/workflows/v2/core";
import { ROOFING } from "../../../prisma/seeds/workflows/v2/roofing";
import { INTERIOR_RENOVATION } from "../../../prisma/seeds/workflows/v2/interior-renovation";
import { DOORS_WINDOWS } from "../../../prisma/seeds/workflows/v2/doors-windows";
import { CODE_VIOLATION } from "../../../prisma/seeds/workflows/v2/code-violation";
import { LEGAL_NO_PERMIT_WARNING, PHASE_BANDS, type TemplateDefinition } from "./templates/types";
import { compose, type ComposeModule } from "./compose";
import { contentHash } from "./seed";

/**
 * The streamlined generation: milestones instead of micro-steps. Richard
 * signed off on these lists on 2026-09-30; the counts below are what he
 * approved, so a change here is a change to the product, not a refactor.
 */

const mod = (def: TemplateDefinition): ComposeModule => ({
  moduleKey: def.key,
  kind: def.kind,
  name: def.name,
  trade: def.trade,
  versionId: `v-${def.key}`,
  version: 2,
  definition: def,
});

type Permit = "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED";
const TRADES = [ROOFING, INTERIOR_RENOVATION, DOORS_WINDOWS];
const job = (trades: TemplateDefinition[], permitStatus: Permit, scopeToggles = {}) =>
  compose({ modules: [mod(CORE), ...trades.map(mod)], permitStatus, scopeToggles });
const counts = (trades: TemplateDefinition[]) => (["UNDETERMINED", "REQUIRED", "NOT_REQUIRED"] as const).map((p) => job(trades, p).tasks.length);
const allToggles = (def: TemplateDefinition, value: boolean) => ({ [def.key]: Object.fromEntries(def.scopeToggles.map((t) => [t.key, value])) });

/** Evidence is required only where the CRM reads the fact from its own records. */
const RECORD_GATES = new Set([
  "PERMIT_NUMBER",
  "INSPECTION_RESULT",
  "PAYMENT_STATUS",
  "AGENCY_CONFIRMATION",
  "HEARING_RESULT",
  "FINE_STATUS",
  "VIOLATION_ITEMS",
  "LINKED_JOB",
  "LINKED_JOB_PERMIT",
]);

describe("streamlined workflow templates", () => {
  it("are the newest generation of every seeded template", () => {
    expect(WORKFLOW_SEED_GENERATIONS.map((t) => [t.key, t.generations.map((g) => g.generation)])).toEqual([
      ["core", [1, 2]],
      ["roofing", [1, 2]],
      ["interior_renovation", [1, 2]],
      ["doors_windows", [1, 2]],
      ["code_violation", [1, 2]],
    ]);
    expect(WORKFLOW_TEMPLATE_SPECS).toEqual([CORE, ROOFING, INTERIOR_RENOVATION, DOORS_WINDOWS, CODE_VIOLATION]);
  });

  it("define the approved number of steps", () => {
    expect(WORKFLOW_TEMPLATE_SPECS.map((s) => [s.key, s.tasks.length])).toEqual([
      ["core", 18],
      ["roofing", 10],
      ["interior_renovation", 10],
      ["doors_windows", 8],
      ["code_violation", 32],
    ]);
  });

  it("compose to the approved totals: undetermined / permit required / no permit", () => {
    expect(counts([])).toEqual([12, 16, 14]);
    expect(counts([ROOFING])).toEqual([18, 24, 20]);
    expect(counts([DOORS_WINDOWS])).toEqual([17, 22, 19]);
    expect(counts([INTERIOR_RENOVATION])).toEqual([17, 21, 19]);
    expect(counts([ROOFING, DOORS_WINDOWS])).toEqual([24, 32, 26]);
    expect(counts(TRADES)).toEqual([30, 39, 32]);
    expect(job([INTERIOR_RENOVATION], "REQUIRED", allToggles(INTERIOR_RENOVATION, true)).tasks.length).toBe(24);
  });

  it("require evidence only on record gates — never a photo, an attachment or a note", () => {
    for (const def of WORKFLOW_TEMPLATE_SPECS) {
      for (const t of def.tasks) {
        if (t.requiredEvidence) expect(RECORD_GATES.has(t.requiredEvidence), `${def.key}:${t.key} requires ${t.requiredEvidence}`).toBe(true);
      }
    }
  });

  it("use the roles people actually hold", () => {
    const roles = (def: TemplateDefinition) => Array.from(new Set(def.tasks.map((t) => t.role))).sort();
    for (const def of [CORE, ...TRADES]) {
      for (const r of roles(def)) expect(["ACCOUNTING", "OFFICE_ADMIN", "PERMIT_COORDINATOR", "PROJECT_MANAGER", "SALES_REP", "SUPERINTENDENT"], `${def.key} ${r}`).toContain(r);
    }
    expect(roles(CODE_VIOLATION)).toEqual(["ACCOUNTING", "CASE_MANAGER", "OFFICE_ADMIN", "PERMIT_COORDINATOR", "PROJECT_MANAGER"]);
  });

  it("keep the keys the engine and the reports read", () => {
    const has = (def: TemplateDefinition, key: string) => def.tasks.some((t) => t.key === key);
    for (const key of ["determine_permit_requirement", "confirm_production_start", "confirm_permit_issued", "obtain_pm_approval_no_permit", "verify_deposit", "close_job"]) {
      expect(has(CORE, key), key).toBe(true);
    }
    for (const key of ["determine_permit_requirement", "close_case", "agency_reinspection", "confirm_permit_issued", "obtain_pm_approval_no_permit"]) {
      expect(has(CODE_VIOLATION, key), key).toBe(true);
    }
    expect(CORE.tasks.find((t) => t.key === "confirm_permit_issued")).toMatchObject({ blocking: true, requiredEvidence: "PERMIT_NUMBER" });
    expect(CORE.tasks.find((t) => t.key === "verify_deposit")).toMatchObject({ blocking: true, requiredEvidence: "PAYMENT_STATUS", requiredEvidenceParam: "DEPOSIT" });
    expect(CORE.tasks.find((t) => t.key === "confirm_final_payment")).toMatchObject({ blocking: true, requiredEvidence: "PAYMENT_STATUS", requiredEvidenceParam: "FINAL" });
    expect(CORE.tasks.find((t) => t.key === "collect_lien_releases")!.blocking).toBe(true);
  });

  it("hold the permit branch once, in Core, with the exact legal warning", () => {
    const permit = CORE.phases.filter((p) => p.conditionPermit !== null);
    expect(permit.map((p) => [p.key, p.conditionPermit, p.band])).toEqual([
      ["permit_required", "REQUIRED", PHASE_BANDS.PERMITTING],
      ["no_permit", "NOT_REQUIRED", PHASE_BANDS.PERMITTING],
    ]);
    expect(permit[1]!.note).toBe(LEGAL_NO_PERMIT_WARNING);
    for (const def of TRADES) expect(def.phases.every((p) => p.conditionPermit === null), def.key).toBe(true);
    const noPermit = CODE_VIOLATION.phases.find((p) => p.key === "no_permit")!;
    expect(noPermit).toMatchObject({ conditionPermit: "NOT_REQUIRED", note: LEGAL_NO_PERMIT_WARNING });
  });

  describe("composed onto a job", () => {
    for (const def of TRADES) {
      it(`${def.key}: permit branches are exclusive and production waits on whichever gate exists`, () => {
        const req = job([def], "REQUIRED");
        const not = job([def], "NOT_REQUIRED");
        const und = job([def], "UNDETERMINED");
        const keys = (p: typeof req) => new Set(p.tasks.map((t) => t.key));
        expect(keys(req).has("core:confirm_permit_issued")).toBe(true);
        expect(keys(req).has("core:obtain_pm_approval_no_permit")).toBe(false);
        expect(keys(not).has("core:confirm_permit_issued")).toBe(false);
        expect(keys(not).has("core:obtain_pm_approval_no_permit")).toBe(true);
        expect(keys(und).has("core:confirm_permit_issued")).toBe(false);
        expect(keys(und).has("core:obtain_pm_approval_no_permit")).toBe(false);

        const startDeps = (p: typeof req) => p.tasks.find((t) => t.key === "core:confirm_production_start")!.dependsOn.map((d) => d.key);
        expect(startDeps(req)).toContain("core:confirm_permit_issued");
        expect(startDeps(not)).toContain("core:obtain_pm_approval_no_permit");
        expect(startDeps(und)).toContain("core:determine_permit_requirement");
        for (const p of [req, not, und]) {
          expect(startDeps(p)).toContain("core:verify_deposit");
          expect(p.warnings).toEqual([]);
        }
      });

      it(`${def.key}: replaces Core's two placeholders, so the application and the closeout wait on the trade`, () => {
        const plan = job([def], "REQUIRED");
        const keys = plan.tasks.map((t) => t.key);
        expect(keys).not.toContain("core:prepare_permit_documents");
        expect(keys).not.toContain("core:complete_work");
        expect(plan.excluded.filter((e) => e.reason === "overridden").map((e) => e.key).sort()).toEqual(["core:complete_work", "core:prepare_permit_documents"]);
        const docs = def.tasks.find((t) => t.overridesCoreKey === "prepare_permit_documents")!;
        const last = def.tasks.find((t) => t.overridesCoreKey === "complete_work")!;
        const deps = (key: string) => plan.tasks.find((t) => t.key === key)!.dependsOn.map((d) => d.key);
        expect(deps("core:submit_permit_application")).toEqual([`${def.key}:${docs.key}`]);
        for (const closeout of ["core:complete_punch_list", "core:obtain_final_inspection", "core:collect_lien_releases"]) {
          expect(deps(closeout), closeout).toEqual([`${def.key}:${last.key}`]);
        }
      });

      it(`${def.key}: composes without warnings with every scope option on and off`, () => {
        for (const value of [true, false]) {
          for (const permit of ["UNDETERMINED", "REQUIRED", "NOT_REQUIRED"] as const) {
            const plan = job([def], permit, allToggles(def, value));
            expect(plan.warnings, `${permit} ${value}`).toEqual([]);
            expect(plan.phases.every((p) => p.taskKeys.length > 0)).toBe(true);
          }
        }
      });
    }

    it("a Core-only job keeps the placeholders and still closes out", () => {
      const plan = job([], "REQUIRED");
      expect(plan.warnings).toEqual([]);
      expect(plan.tasks.map((t) => t.key)).toContain("core:prepare_permit_documents");
      expect(plan.tasks.map((t) => t.key)).toContain("core:complete_work");
    });

    it("day one of a roofing job has five steps ready to work", () => {
      const plan = job([ROOFING], "UNDETERMINED");
      expect(plan.tasks.filter((t) => t.initiallyActive).map((t) => t.key).sort()).toEqual([
        "core:assign_project_manager",
        "core:determine_permit_requirement",
        "core:review_contract",
        "core:verify_deposit",
        "roofing:confirm_roof_scope",
      ]);
    });

    it("two trades share one permit application, one final inspection, one invoice and one close", () => {
      const plan = job([ROOFING, DOORS_WINDOWS], "REQUIRED");
      expect(plan.warnings).toEqual([]);
      const deps = (key: string) => plan.tasks.find((t) => t.key === key)!.dependsOn.map((d) => d.key).sort();
      expect(deps("core:submit_permit_application")).toEqual(["doors_windows:dw_permit_documents", "roofing:roofing_permit_documents"]);
      expect(deps("core:complete_punch_list")).toEqual(["doors_windows:finish_and_test", "roofing:install_roof_system"]);
      for (const once of ["submit_permit_application", "confirm_permit_issued", "obtain_final_inspection", "submit_final_invoice", "confirm_final_payment", "close_job"]) {
        expect(plan.tasks.filter((t) => t.shortKey === once).map((t) => t.moduleKey), once).toEqual(["core"]);
      }
      const bands = plan.phases.map((p) => p.band);
      expect([...bands].sort((a, b) => a - b)).toEqual(bands);
    });

    it("interior with every scope off still leaves a connected chain", () => {
      const plan = job([INTERIOR_RENOVATION], "NOT_REQUIRED", allToggles(INTERIOR_RENOVATION, false));
      expect(plan.tasks.find((t) => t.key === "interior_renovation:install_finishes")!.dependsOn.map((d) => d.key)).toEqual(["interior_renovation:mobilize_and_demolish"]);
    });

    it("every trade override and core: reference points at a real Core step", () => {
      const coreKeys = new Set(CORE.tasks.map((t) => t.key));
      for (const def of TRADES) {
        for (const t of def.tasks) if (t.overridesCoreKey) expect(coreKeys.has(t.overridesCoreKey), `${def.key}:${t.key}`).toBe(true);
        for (const d of def.dependencies) {
          if (d.dependsOnRef.startsWith("core:")) expect(coreKeys.has(d.dependsOnRef.slice(5)), `${def.key}:${d.taskKey} → ${d.dependsOnRef}`).toBe(true);
        }
      }
    });
  });

  describe("code_violation", () => {
    const cv = (permitStatus: Permit, toggles: Record<string, boolean> = {}) =>
      compose({ modules: [mod(CODE_VIOLATION)], permitStatus, scopeToggles: { code_violation: toggles } });
    const all = (value: boolean) => Object.fromEntries(CODE_VIOLATION.scopeToggles.map((t) => [t.key, value]));

    it("keeps the nine phases and six toggles the case page reads", () => {
      expect(CODE_VIOLATION.phases.map((p) => p.key)).toEqual([
        "intake", "site_investigation", "strategy", "permit_required", "no_permit", "corrective_construction", "agency_compliance", "hearings_fines_liens", "closure",
      ]);
      expect(CODE_VIOLATION.scopeToggles.map((t) => t.key)).toEqual(["construction_required", "hearing_required", "fines_accruing", "lien_recorded", "emergency", "appeal"]);
    });

    it("composes to the approved totals", () => {
      expect((["UNDETERMINED", "REQUIRED", "NOT_REQUIRED"] as const).map((p) => cv(p).tasks.length)).toEqual([17, 20, 19]);
      expect((["UNDETERMINED", "REQUIRED", "NOT_REQUIRED"] as const).map((p) => cv(p, all(true)).tasks.length)).toEqual([27, 30, 29]);
      expect((["UNDETERMINED", "REQUIRED", "NOT_REQUIRED"] as const).map((p) => cv(p, all(false)).tasks.length)).toEqual([15, 18, 17]);
      for (const value of [true, false]) {
        for (const p of ["UNDETERMINED", "REQUIRED", "NOT_REQUIRED"] as const) expect(cv(p, all(value)).warnings).toEqual([]);
      }
    });

    it("keeps every legal gate with its evidence", () => {
      const byKey = new Map(CODE_VIOLATION.tasks.map((t) => [t.key, t]));
      expect(byKey.get("close_case")).toMatchObject({ blocking: true, requiredEvidence: "AGENCY_CONFIRMATION" });
      expect(byKey.get("obtain_written_compliance_confirmation")).toMatchObject({ blocking: true, requiredEvidence: "AGENCY_CONFIRMATION" });
      expect(byKey.get("agency_reinspection")).toMatchObject({ blocking: true, requiredEvidence: "INSPECTION_RESULT" });
      expect(byKey.get("create_violation_items")).toMatchObject({ blocking: true, requiredEvidence: "VIOLATION_ITEMS", requiredEvidenceParam: "EXISTS" });
      expect(byKey.get("confirm_all_items_complete")).toMatchObject({ blocking: true, requiredEvidence: "VIOLATION_ITEMS", requiredEvidenceParam: "COMPLETE" });
      expect(byKey.get("create_or_link_job")).toMatchObject({ blocking: true, requiredEvidence: "LINKED_JOB", requiredEvidenceParam: "WORKFLOW" });
      expect(byKey.get("corrective_work_complete")).toMatchObject({ blocking: true, requiredEvidence: "LINKED_JOB", requiredEvidenceParam: "COMPLETE" });
      expect(byKey.get("obtain_lien_release")).toMatchObject({ blocking: true, requiredEvidence: "FINE_STATUS", requiredEvidenceParam: "LIEN_RELEASED" });
      for (const key of ["obtain_management_owner_approval", "determine_permit_requirement", "obtain_pm_approval_no_permit", "obtain_payment_approval", "obtain_manager_close_approval", "assign_case_manager"]) {
        expect(byKey.get(key)!.blocking, key).toBe(true);
      }
      expect(byKey.get("submit_proof_of_correction")).toMatchObject({ anchor: "COMPLIANCE_DEADLINE", dueOffsetBusinessDays: -5 });
      expect(byKey.get("prepare_hearing_evidence")).toMatchObject({ anchor: "HEARING_DATE", dueOffsetBusinessDays: -3 });
    });

    it("lets the emergency and the hearing start at once, and falls back when there is no construction", () => {
      const on = cv("REQUIRED", all(true));
      const ready = new Set(on.tasks.filter((t) => t.initiallyActive).map((t) => t.shortKey));
      for (const key of ["secure_site_emergency", "prepare_hearing_evidence", "confirm_official_balance", "review_notice", "create_violation_items", "assign_case_manager"]) {
        expect(ready.has(key), key).toBe(true);
      }
      const off = cv("NOT_REQUIRED", all(false));
      expect(off.tasks.some((t) => t.phaseKey === "code_violation:corrective_construction")).toBe(false);
      expect(off.tasks.find((t) => t.shortKey === "submit_proof_of_correction")!.dependsOn.map((d) => d.key)).toEqual(["code_violation:obtain_management_owner_approval"]);
    });
  });

  // Captured when the streamlined generation was first seeded. Jobs and
  // cases pin these versions from then on: if this fails after the prod
  // seed, the fix is a new generation, not a new hash.
  it("streamlined hashes match the seeded versions", () => {
    expect(Object.fromEntries(WORKFLOW_TEMPLATE_SPECS.map((s) => [s.key, contentHash(s)]))).toEqual({
      core: "80716667b84401d9406988bb13081c92882da02c1cf71eaa54f5f2e80b67c785",
      roofing: "5793d80213f8cf21b2f9c40de303d0ec397e71c767fad80d9e2b0ebf8ec29980",
      interior_renovation: "394b60091780edd5dd83ccc5d11b3a87fab3ebd5ab846bcdef845fdc9017f879",
      doors_windows: "e571b618e176197e3035eb821610cc12a8a820910f71a11ad25b951ef8530d9c",
      code_violation: "5fad3867b7267c69f8c457d1813ae8fe98800ead3186a8ebe04d048ed2a3337c",
    });
  });
});
