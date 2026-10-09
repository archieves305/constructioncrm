import { describe, expect, it } from "vitest";
import { describeProgress, initialIndexSteps, pageIndexSteps, pageOfStep, rollupJob, runnableSteps, type StepState } from "./plan";

const state = (stepKey: string, status: StepState["status"], dependsOn: string[] = []): StepState => ({ stepKey, status, dependsOn });

describe("index step plan", () => {
  it("starts with the inventory alone, then one step per page, then classify, then scale", () => {
    expect(initialIndexSteps()).toEqual([{ sequence: 0, stepKey: "inventory", dependsOn: [] }]);
    const steps = pageIndexSteps(3);
    expect(steps.map((s) => s.stepKey)).toEqual(["page.1", "page.2", "page.3", "classify", "scale"]);
    expect(steps[3].dependsOn).toEqual(["page.1", "page.2", "page.3"]);
    expect(steps[4].dependsOn).toEqual(["classify"]);
    expect(pageOfStep("page.12")).toBe(12);
    expect(pageOfStep("classify")).toBeNull();
  });

  it("only offers steps whose dependencies are finished", () => {
    const steps = [state("inventory", "DONE"), state("page.1", "PENDING", ["inventory"]), state("page.2", "DONE", ["inventory"]), state("classify", "PENDING", ["page.1", "page.2"])];
    expect(runnableSteps(steps).map((s) => s.stepKey)).toEqual(["page.1"]);
  });

  it("rolls the job up from its steps", () => {
    expect(rollupJob([state("inventory", "DONE"), state("page.1", "DONE")], "RUNNING").status).toBe("DONE");
    expect(rollupJob([state("inventory", "DONE"), state("page.1", "FAILED"), state("classify", "PENDING", ["page.1"])], "RUNNING")).toMatchObject({ status: "FAILED", failedSteps: 1 });
    expect(rollupJob([state("inventory", "DONE"), state("page.1", "FAILED"), state("page.2", "PENDING", ["inventory"])], "RUNNING").status).toBe("RUNNING");
    expect(rollupJob([state("inventory", "PENDING")], "CANCELLED").status).toBe("CANCELLED");
  });

  it("describes progress for the person watching", () => {
    expect(describeProgress([state("inventory", "RUNNING")])).toBe("Opening the document");
    expect(describeProgress([state("inventory", "DONE"), state("page.1", "DONE"), state("page.2", "PENDING"), state("classify", "PENDING")])).toBe("Reading sheets 1/2");
    expect(describeProgress([state("inventory", "DONE"), state("page.1", "DONE"), state("classify", "RUNNING"), state("scale", "PENDING")])).toBe("Indexing sheets");
    expect(describeProgress([state("inventory", "DONE"), state("page.1", "DONE"), state("classify", "DONE"), state("scale", "DONE")])).toBe("Done");
  });
});
