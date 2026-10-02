import { describe, expect, it } from "vitest";
import { stageNameForWorkflow, type StageStep } from "./stage-sync";

const at = new Date("2026-10-01T12:00:00Z");
const step = (short: string, status: StageStep["status"], active = true): StageStep => ({ key: `core:${short}`, status, activatedAt: active ? at : null });
const done = (short: string) => step(short, "COMPLETED");
const ready = (short: string) => step(short, "PENDING");
const waiting = (short: string) => step(short, "PENDING", false);

describe("stageNameForWorkflow", () => {
  it("earns nothing until a milestone is done", () => {
    expect(stageNameForWorkflow([ready("review_contract"), ready("verify_deposit"), waiting("precon_plan")])).toBeNull();
    expect(stageNameForWorkflow([])).toBeNull();
  });

  it("walks the job forward one milestone at a time", () => {
    const steps: StageStep[] = [done("verify_deposit")];
    expect(stageNameForWorkflow(steps)).toBe("Financing Cleared");
    steps.push(done("precon_plan"));
    expect(stageNameForWorkflow(steps)).toBe("Scope Finalized");
    steps.push(done("submit_permit_application"));
    expect(stageNameForWorkflow(steps)).toBe("Permit Submitted");
    steps.push(done("confirm_permit_issued"));
    expect(stageNameForWorkflow(steps)).toBe("Permit Approved");
    steps.push(done("confirm_production_start"));
    expect(stageNameForWorkflow(steps)).toBe("In Progress");
    steps.push(ready("complete_punch_list"), ready("obtain_final_inspection"));
    expect(stageNameForWorkflow(steps)).toBe("Punch List");
  });

  it("goes to Final Inspection once the punch list is done and the inspection is still open", () => {
    expect(stageNameForWorkflow([done("complete_punch_list"), ready("obtain_final_inspection")])).toBe("Final Inspection");
    // No permit, so no inspection step: it stays at Punch List until the final invoice goes out.
    expect(stageNameForWorkflow([done("complete_punch_list"), waiting("submit_final_invoice")])).toBe("Punch List");
  });

  it("is Final Payment Due once the final invoice step is done, and Closed when the job is closed", () => {
    expect(stageNameForWorkflow([done("complete_punch_list"), done("obtain_final_inspection"), done("submit_final_invoice"), ready("confirm_final_payment")])).toBe("Final Payment Due");
    expect(stageNameForWorkflow([done("submit_final_invoice"), done("confirm_final_payment"), done("close_job")])).toBe("Closed");
  });

  it("the furthest milestone wins even when an earlier one was never completed", () => {
    expect(stageNameForWorkflow([ready("verify_deposit"), done("confirm_production_start")])).toBe("In Progress");
  });

  it("a skipped or retired step proves nothing", () => {
    expect(stageNameForWorkflow([step("verify_deposit", "CANCELLED")])).toBeNull();
    expect(stageNameForWorkflow([step("complete_punch_list", "CANCELLED")])).toBeNull();
  });

  it("ignores trade steps and tasks with no workflow key", () => {
    expect(stageNameForWorkflow([{ key: "roofing:verify_deposit", status: "COMPLETED", activatedAt: at }, { key: null, status: "COMPLETED", activatedAt: at }])).toBeNull();
  });
});
