import { describe, expect, it } from "vitest";
import { defineTemplate, TemplateDefinitionError } from "./define";
import type { TemplateSpec } from "./types";
import { LEGAL_NO_PERMIT_WARNING } from "./types";

const core: TemplateSpec = {
  key: "core",
  name: "Core Construction",
  kind: "CORE",
  phases: [
    {
      key: "setup",
      name: "Job Setup",
      band: 100,
      tasks: [
        { key: "kickoff", title: "Kickoff", role: "PROJECT_MANAGER", dueOffsetBusinessDays: 1 },
        { key: "determine_permit_requirement", title: "Determine permit requirement", role: "PERMIT_COORDINATOR", dependsOn: ["^"], blocking: true },
      ],
    },
  ],
};

const trade = (over: Partial<TemplateSpec> = {}): TemplateSpec => ({
  key: "roofing",
  name: "Roofing",
  kind: "TRADE",
  trade: "Roofing",
  scopeToggles: [{ key: "tear_off", label: "Tear-off", default: true }],
  phases: [
    {
      key: "scope",
      name: "Scope Review",
      band: 300,
      startsAfter: ["core:kickoff"],
      tasks: [
        { key: "measure", title: "Measure roof", role: "ESTIMATOR" },
        { key: "confirm", title: "Confirm scope", role: "PROJECT_MANAGER", dependsOn: ["^"], checklist: ["Pitch", { text: "Layers", condition: { anyOf: ["tear_off"] } }] },
      ],
    },
    {
      key: "no_permit",
      name: "No Permit Required",
      band: 400,
      permit: "NOT_REQUIRED",
      note: LEGAL_NO_PERMIT_WARNING,
      tasks: [{ key: "no_permit_confirm", title: "Confirm exemption", role: "PERMIT_COORDINATOR", dependsOn: ["core:determine_permit_requirement"] }],
    },
  ],
  ...over,
});

describe("defineTemplate", () => {
  it("normalises a valid spec: ^, startsAfter, inherited permit condition, checklist keys", () => {
    const def = defineTemplate(trade());
    expect(def.tasks.map((t) => t.key)).toEqual(["measure", "confirm", "no_permit_confirm"]);
    expect(def.dependencies).toEqual([
      { taskKey: "measure", dependsOnRef: "core:kickoff", kind: "BLOCKING" },
      { taskKey: "confirm", dependsOnRef: "measure", kind: "BLOCKING" },
      { taskKey: "no_permit_confirm", dependsOnRef: "core:determine_permit_requirement", kind: "BLOCKING" },
    ]);
    const confirm = def.tasks[1]!;
    expect(confirm.anchor).toBe("PREDECESSOR");
    expect(confirm.checklist).toEqual([
      { key: "item_1", label: "Pitch", condition: null },
      { key: "item_2", label: "Layers", condition: { anyOf: ["tear_off"] } },
    ]);
    expect(def.tasks[2]!.conditionPermit).toBe("NOT_REQUIRED");
    expect(def.phases[1]!.note).toBe(LEGAL_NO_PERMIT_WARNING);
    // A dependency-free task counts from job creation by default.
    expect(defineTemplate(core).tasks[0]!.anchor).toBe("JOB_CREATED");
  });

  it("does not add startsAfter to a task that already waits inside the phase", () => {
    const def = defineTemplate(trade());
    expect(def.dependencies.filter((d) => d.taskKey === "confirm")).toHaveLength(1);
  });

  const expectFail = (spec: TemplateSpec, fragment: string) => {
    try {
      defineTemplate(spec);
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateDefinitionError);
      expect((err as Error).message).toContain(fragment);
      return;
    }
    throw new Error("expected defineTemplate to throw");
  };

  it("rejects duplicate task keys with the path", () => {
    const spec = trade();
    spec.phases[0]!.tasks.push({ key: "measure", title: "Again", role: "ESTIMATOR" });
    expectFail(spec, 'duplicate task "measure"');
  });

  it("rejects unresolved references", () => {
    const spec = trade();
    spec.phases[0]!.tasks[0]!.dependsOn = ["nowhere"];
    expectFail(spec, 'unknown task "nowhere"');
  });

  it("rejects cross-module references other than core:", () => {
    const spec = trade();
    spec.phases[0]!.tasks[0]!.dependsOn = ["interior:demo"];
    expectFail(spec, "only core: cross-module references");
  });

  it("rejects unknown scope toggles", () => {
    const spec = trade();
    spec.phases[0]!.tasks[0]!.condition = { anyOf: ["skylights"] };
    expectFail(spec, 'unknown scope toggle "skylights"');
  });

  it("reports a cycle with its path", () => {
    const spec = trade();
    spec.phases[0]!.tasks[0]!.dependsOn = ["confirm"];
    expectFail(spec, "cycle: measure → confirm → measure");
  });

  it("requires the legal warning on a No-Permit phase", () => {
    const spec = trade();
    spec.phases[1]!.note = undefined;
    expectFail(spec, "legal warning");
  });

  it("rejects a negative offset unless anchored on TARGET_START", () => {
    const spec = trade();
    spec.phases[0]!.tasks[0]!.dueOffsetBusinessDays = -3;
    expectFail(spec, "negative offset");
    spec.phases[0]!.tasks[0]!.anchor = "TARGET_START";
    expect(defineTemplate(spec).tasks[0]!.dueOffsetBusinessDays).toBe(-3);
  });

  it("requires determine_permit_requirement on the Core template and refuses to override it", () => {
    const bad = { ...core, phases: [{ ...core.phases[0]!, tasks: [core.phases[0]!.tasks[0]!] }] };
    expectFail(bad, 'must contain "determine_permit_requirement"');
    const spec = trade();
    spec.phases[0]!.tasks[0]!.overridesCoreKey = "determine_permit_requirement";
    expectFail(spec, "never overridden");
  });

  it("rejects ^ on the first task of a phase and self-dependencies", () => {
    const spec = trade();
    spec.phases[0]!.tasks[0]!.dependsOn = ["^"];
    expectFail(spec, "no previous task");
    spec.phases[0]!.tasks[0]!.dependsOn = ["measure"];
    expectFail(spec, "cannot depend on itself");
  });
});
