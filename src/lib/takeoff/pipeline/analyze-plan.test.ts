import { describe, expect, it } from "vitest";
import { analyzeSteps, describeAnalyzeProgress, regionStepKey, sheetOfRegionStep, SPECS_STEP } from "./analyze-plan";
import { rollupJob, runnableSteps } from "./plan";

describe("analyzeSteps", () => {
  it("plans the specs call and one regions call per roof plan, none depending on another", () => {
    const steps = analyzeSteps(["sh1", "sh2"]);
    expect(steps.map((s) => s.stepKey)).toEqual([SPECS_STEP, "regions.sh1", "regions.sh2"]);
    expect(steps.every((s) => s.dependsOn.length === 0)).toBe(true);
    expect(runnableSteps(steps.map((s) => ({ ...s, status: "PENDING" as const })))).toHaveLength(3);
  });
  it("can leave the specs call out", () => {
    expect(analyzeSteps(["sh1"], false).map((s) => s.stepKey)).toEqual(["regions.sh1"]);
  });
  it("reads a sheet id back from its step", () => {
    expect(sheetOfRegionStep(regionStepKey("abc.def"))).toBe("abc.def");
    expect(sheetOfRegionStep("specs")).toBeNull();
  });
});

describe("describeAnalyzeProgress", () => {
  const names = new Map([["sh1", "A-10"], ["sh2", "A-08"]]);
  it("follows the steps", () => {
    const base = analyzeSteps(["sh1", "sh2"]);
    const at = (st: Record<string, "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED">) => base.map((s) => ({ ...s, status: st[s.stepKey] ?? "PENDING" }));
    expect(describeAnalyzeProgress(at({}), names)).toBe("Reading the specifications");
    expect(describeAnalyzeProgress(at({ specs: "RUNNING" }), names)).toBe("Reading the specifications");
    expect(describeAnalyzeProgress(at({ specs: "DONE", "regions.sh1": "RUNNING" }), names)).toBe("Labelling A-10 (1/2)");
    expect(describeAnalyzeProgress(at({ specs: "DONE", "regions.sh1": "DONE" }), names)).toBe("Labelling roof plans (1/2)");
    expect(describeAnalyzeProgress(at({ specs: "DONE", "regions.sh1": "DONE", "regions.sh2": "FAILED" }), names)).toBe("Stopped");
    const done = at({ specs: "DONE", "regions.sh1": "DONE", "regions.sh2": "DONE" });
    expect(describeAnalyzeProgress(done, names)).toBe("Done");
    expect(rollupJob(done, "RUNNING").status).toBe("DONE");
  });
});
