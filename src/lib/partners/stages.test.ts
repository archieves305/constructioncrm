import { describe, expect, it } from "vitest";
import { isPartnerStage, PARTNER_STAGES, STAGE_TERMINAL, stageDef, stageNeedsReason, stagesAsStageLike } from "./stages";

describe("partner stages", () => {
  it("are strictly ordered", () => {
    const orders = PARTNER_STAGES.map((s) => s.stageOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("parks and writes off as closed stages", () => {
    expect([...STAGE_TERMINAL]).toEqual(["DORMANT", "DO_NOT_PURSUE"]);
    expect(stageDef("ACTIVE").isClosed).toBe(false);
  });

  it("maps to StageLike with the key as id", () => {
    const rows = stagesAsStageLike();
    expect(rows[0]).toEqual({ id: "TARGET", name: "Target", stageOrder: 1, isClosed: false });
    expect(rows.at(-1)?.id).toBe("DO_NOT_PURSUE");
  });

  it("guards unknown values and needs a reason to write off", () => {
    expect(isPartnerStage("ENGAGED")).toBe(true);
    expect(isPartnerStage("WON")).toBe(false);
    expect(stageNeedsReason("DO_NOT_PURSUE")).toBe(true);
    expect(stageNeedsReason("DORMANT")).toBe(false);
  });
});
