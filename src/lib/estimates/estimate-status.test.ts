import { describe, expect, it } from "vitest";
import {
  ESTIMATE_STATUS_ACTIONS,
  ESTIMATE_STATUS_LABEL,
  ESTIMATE_STATUS_TONE,
  canGenerateContractFromEstimate,
  isEstimateStatus,
} from "./estimate-status";
import { ESTIMATE_STATUSES } from "./generic-schema";

describe("estimate status presentation", () => {
  it("covers every schema status with a tone and a label", () => {
    for (const s of ESTIMATE_STATUSES) {
      expect(ESTIMATE_STATUS_TONE[s]).toBeDefined();
      expect(ESTIMATE_STATUS_LABEL[s]).toBeTruthy();
    }
  });

  it("offers every status as a menu action exactly once", () => {
    expect(ESTIMATE_STATUS_ACTIONS.map((a) => a.to).sort()).toEqual([...ESTIMATE_STATUSES].sort());
  });

  it("narrows unknown strings", () => {
    expect(isEstimateStatus("SENT")).toBe(true);
    expect(isEstimateStatus("toString")).toBe(false);
    expect(isEstimateStatus("VOID")).toBe(false);
  });

  it("only an accepted estimate can become a contract", () => {
    expect(canGenerateContractFromEstimate("ACCEPTED")).toBe(true);
    expect(canGenerateContractFromEstimate("SENT")).toBe(false);
    expect(canGenerateContractFromEstimate("DRAFT")).toBe(false);
  });
});
