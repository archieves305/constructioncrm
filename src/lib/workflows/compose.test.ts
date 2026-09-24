import { describe, expect, it } from "vitest";
import { compose, ComposeCycleError, type ComposeModule } from "./compose";
import { defineTemplate } from "./templates/define";
import { LEGAL_NO_PERMIT_WARNING, type TemplateSpec } from "./templates/types";

const coreSpec: TemplateSpec = {
  key: "core",
  name: "Core Construction",
  kind: "CORE",
  phases: [
    {
      key: "setup",
      name: "Job Setup",
      band: 100,
      tasks: [
        { key: "kickoff", title: "Kickoff", role: "PROJECT_MANAGER" },
        { key: "determine_permit_requirement", title: "Determine permit requirement", role: "PERMIT_COORDINATOR", dependsOn: ["^"], blocking: true },
      ],
    },
    {
      key: "permit",
      name: "Permitting",
      band: 400,
      permit: "REQUIRED",
      tasks: [
        { key: "permit_submit", title: "Submit permit", role: "PERMIT_COORDINATOR", dependsOn: ["determine_permit_requirement"] },
        { key: "permit_approved", title: "Permit approved", role: "PERMIT_COORDINATOR", dependsOn: ["^"], blocking: true },
      ],
    },
    {
      key: "no_permit",
      name: "No Permit Required",
      band: 400,
      permit: "NOT_REQUIRED",
      note: LEGAL_NO_PERMIT_WARNING,
      tasks: [{ key: "no_permit_confirmed", title: "Confirm no permit needed", role: "PROJECT_MANAGER", dependsOn: ["determine_permit_requirement"], blocking: true }],
    },
    {
      key: "production",
      name: "Production",
      band: 700,
      tasks: [{ key: "mobilize", title: "Mobilize", role: "SUPERINTENDENT", dependsOn: ["permit_approved", "no_permit_confirmed"] }],
    },
    {
      key: "closeout",
      name: "Closeout",
      band: 1000,
      tasks: [
        { key: "final_inspection", title: "Final inspection", role: "QUALITY_CONTROL", dependsOn: ["mobilize"] },
        { key: "close_job", title: "Close job", role: "PROJECT_MANAGER", dependsOn: ["^"] },
      ],
    },
  ],
};

const roofingSpec: TemplateSpec = {
  key: "roofing",
  name: "Roofing",
  kind: "TRADE",
  trade: "Roofing",
  scopeToggles: [{ key: "tear_off", label: "Tear-off", default: true }],
  phases: [
    {
      key: "install",
      name: "Installation",
      band: 800,
      startsAfter: ["core:mobilize"],
      tasks: [
        { key: "tear_off", title: "Tear off", role: "SUPERINTENDENT", condition: { allOf: ["tear_off"] } },
        { key: "install", title: "Install shingles", role: "SUPERINTENDENT", dependsOn: ["^"] },
      ],
    },
    {
      key: "closeout",
      name: "Roofing Closeout",
      band: 900,
      tasks: [{ key: "roof_final_inspection", title: "Roof final inspection", role: "QUALITY_CONTROL", dependsOn: ["install"], overridesCoreKey: "final_inspection" }],
    },
  ],
};

const mod = (spec: TemplateSpec, version = 1): ComposeModule => {
  const def = defineTemplate(spec);
  return { moduleKey: def.key, kind: def.kind, name: def.name, trade: def.trade, versionId: `v-${def.key}`, version, definition: def };
};

const deps = (plan: ReturnType<typeof compose>, key: string) =>
  plan.tasks.find((t) => t.key === key)!.dependsOn.map((d) => d.key).sort();

describe("compose", () => {
  it("UNDETERMINED: both permit branches are excluded and Mobilize waits on the determination gate", () => {
    const plan = compose({ modules: [mod(coreSpec)], permitStatus: "UNDETERMINED", scopeToggles: {} });
    expect(plan.tasks.map((t) => t.key)).toEqual(["core:kickoff", "core:determine_permit_requirement", "core:mobilize", "core:final_inspection", "core:close_job"]);
    expect(deps(plan, "core:mobilize")).toEqual(["core:determine_permit_requirement"]);
    expect(plan.excluded.map((e) => e.reason)).toEqual(["permit-undetermined", "permit-undetermined", "permit-undetermined"]);
    expect(plan.phases.map((p) => p.shortKey)).toEqual(["setup", "production", "closeout"]);
  });

  it("REQUIRED: the permit branch is in, the no-permit branch is out, Mobilize follows the permit gate", () => {
    const plan = compose({ modules: [mod(coreSpec)], permitStatus: "REQUIRED", scopeToggles: {} });
    expect(plan.tasks.map((t) => t.key)).toContain("core:permit_approved");
    expect(plan.tasks.map((t) => t.key)).not.toContain("core:no_permit_confirmed");
    // The missing branch's gate collapses onto its own predecessor, the
    // (already completed) determination task — never a dangling edge.
    expect(deps(plan, "core:mobilize")).toEqual(["core:determine_permit_requirement", "core:permit_approved"]);
    expect(plan.warnings).toEqual([]);
  });

  it("NOT_REQUIRED: the no-permit branch carries the legal warning and gates Mobilize", () => {
    const plan = compose({ modules: [mod(coreSpec)], permitStatus: "NOT_REQUIRED", scopeToggles: {} });
    expect(deps(plan, "core:mobilize")).toEqual(["core:determine_permit_requirement", "core:no_permit_confirmed"]);
    expect(plan.phases.find((p) => p.shortKey === "no_permit")!.note).toBe(LEGAL_NO_PERMIT_WARNING);
  });

  it("interleaves trade phases by band with Core first, numbers tasks ×10 and applies overrides", () => {
    const plan = compose({ modules: [mod(roofingSpec), mod(coreSpec)], permitStatus: "REQUIRED", scopeToggles: {} });
    expect(plan.modules.map((m) => m.moduleKey)).toEqual(["core", "roofing"]);
    expect(plan.phases.map((p) => p.key)).toEqual([
      "core:setup",
      "core:permit",
      "core:production",
      "roofing:install",
      "roofing:closeout",
      "core:closeout",
    ]);
    expect(plan.tasks.map((t) => t.sortOrder)).toEqual(plan.tasks.map((_, i) => (i + 1) * 10));
    // Roofing's final inspection replaces Core's and inherits Close job's edge.
    expect(plan.tasks.map((t) => t.key)).not.toContain("core:final_inspection");
    expect(plan.excluded).toContainEqual({ key: "core:final_inspection", reason: "overridden" });
    expect(deps(plan, "core:close_job")).toEqual(["roofing:roof_final_inspection"]);
    // startsAfter reaches the first task of the phase only.
    expect(deps(plan, "roofing:tear_off")).toEqual(["core:mobilize"]);
    expect(deps(plan, "roofing:install")).toEqual(["roofing:tear_off"]);
  });

  it("bypasses a scope-excluded task so its dependents inherit its predecessors", () => {
    const plan = compose({ modules: [mod(coreSpec), mod(roofingSpec)], permitStatus: "REQUIRED", scopeToggles: { roofing: { tear_off: false } } });
    expect(plan.excluded).toContainEqual({ key: "roofing:tear_off", reason: "scope" });
    expect(deps(plan, "roofing:install")).toEqual(["core:mobilize"]);
  });

  it("marks only dependency-free auto-activating tasks as initially active", () => {
    const plan = compose({ modules: [mod(coreSpec)], permitStatus: "REQUIRED", scopeToggles: {} });
    expect(plan.tasks.filter((t) => t.initiallyActive).map((t) => t.key)).toEqual(["core:kickoff"]);
  });

  it("warns and drops a dependency on a task that is not part of the workflow", () => {
    const lonely: TemplateSpec = {
      ...roofingSpec,
      phases: [{ key: "p", name: "P", band: 800, tasks: [{ key: "x", title: "X", role: "SUPERINTENDENT", dependsOn: ["core:nowhere"] }] }],
    };
    const plan = compose({ modules: [mod(coreSpec), mod(lonely)], permitStatus: "REQUIRED", scopeToggles: {} });
    expect(deps(plan, "roofing:x")).toEqual([]);
    expect(plan.warnings[0]).toContain("core:nowhere");
  });

  it("throws ComposeCycleError for a cycle that only appears across modules", () => {
    // Core's close_job depends on the trade's inspection (via override), and the
    // trade inspection is made to depend on core:close_job.
    const cyclic: TemplateSpec = {
      ...roofingSpec,
      phases: [
        roofingSpec.phases[0]!,
        {
          key: "closeout",
          name: "Roofing Closeout",
          band: 900,
          tasks: [{ key: "roof_final_inspection", title: "Roof final inspection", role: "QUALITY_CONTROL", dependsOn: ["core:close_job"], overridesCoreKey: "final_inspection" }],
        },
      ],
    };
    expect(() => compose({ modules: [mod(coreSpec), mod(cyclic)], permitStatus: "REQUIRED", scopeToggles: {} })).toThrow(ComposeCycleError);
  });
});
