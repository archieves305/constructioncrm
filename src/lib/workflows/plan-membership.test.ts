import { describe, expect, it } from "vitest";
import { CORE as CORE_V1 } from "../../../prisma/seeds/workflows/v1/core";
import { CORE } from "../../../prisma/seeds/workflows/v2/core";
import { ROOFING } from "../../../prisma/seeds/workflows/v2/roofing";
import { isLegacyStep, pinnedSteps, pinnedStepsOf } from "./plan-membership";

const slim = pinnedSteps([
  { moduleKey: "core", definition: CORE },
  { moduleKey: "roofing", definition: ROOFING },
]);

describe("isLegacyStep", () => {
  it("a step of the pinned version is current, whether new or carried over by key", () => {
    expect(isLegacyStep("core:review_contract", slim)).toBe(false);
    expect(isLegacyStep("core:precon_plan", slim)).toBe(false);
    expect(isLegacyStep("roofing:install_roof_system", slim)).toBe(false);
  });

  it("a step the pinned version no longer has is legacy", () => {
    expect(isLegacyStep("core:confirm_customer_property", slim)).toBe(true);
    expect(isLegacyStep("roofing:mobilize", slim)).toBe(true);
    expect(isLegacyStep("roofing:install_ridge_vent", slim)).toBe(true);
  });

  it("a manual task is never legacy, and a correction follows the step it corrects", () => {
    expect(isLegacyStep(null, slim)).toBe(false);
    expect(isLegacyStep("roofing:dry_in_inspection:correction:1", slim)).toBe(false);
    expect(isLegacyStep("roofing:obtain_dry_in_inspection:correction:2", slim)).toBe(true);
  });

  it("a removed trade's rows are that trade's history, not legacy", () => {
    expect(isLegacyStep("doors_windows:install_windows_doors", slim)).toBe(false);
  });

  it("on the version it was applied with, nothing is legacy", () => {
    const v1 = pinnedSteps([{ moduleKey: "core", definition: CORE_V1 }]);
    for (const t of CORE_V1.tasks) expect(isLegacyStep(`core:${t.key}`, v1)).toBe(false);
  });

  it("builds the same set from flat (module, step) pairs", () => {
    const flat = pinnedStepsOf(
      [...CORE.tasks.map((t) => ({ moduleKey: "core", stepKey: t.key })), ...ROOFING.tasks.map((t) => ({ moduleKey: "roofing", stepKey: t.key }))],
      ["core", "roofing"],
    );
    expect(Array.from(flat.keys).sort()).toEqual(Array.from(slim.keys).sort());
    expect(isLegacyStep("roofing:mobilize", flat)).toBe(true);
  });
});
