import { describe, expect, it } from "vitest";
import { stepHasOpenRequirement } from "./step-requirements";

describe("stepHasOpenRequirement", () => {
  it("an ordinary task never does, whatever else it carries", () => {
    expect(stepHasOpenRequirement({ workflowTaskKey: null, requiredEvidence: "PHOTO", checklist: [{ done: false }] })).toBe(false);
    expect(stepHasOpenRequirement({})).toBe(false);
  });

  it("a step with a record gate or an unticked line does", () => {
    expect(stepHasOpenRequirement({ workflowTaskKey: "core:verify_deposit", requiredEvidence: "PAYMENT_STATUS" })).toBe(true);
    expect(stepHasOpenRequirement({ workflowTaskKey: "core:review_contract", checklist: [{ key: "item_1", done: true }, { key: "item_2", done: false }] })).toBe(true);
  });

  it("a step with nothing left to tick and no gate is one click", () => {
    expect(stepHasOpenRequirement({ workflowTaskKey: "core:review_contract", requiredEvidence: null, checklist: [{ done: true }, { done: true }] })).toBe(false);
    expect(stepHasOpenRequirement({ workflowTaskKey: "core:obtain_pm_approval_no_permit", checklist: null })).toBe(false);
    expect(stepHasOpenRequirement({ workflowTaskKey: "core:x", checklist: "not a list" })).toBe(false);
  });
});
