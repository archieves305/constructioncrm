import { describe, expect, it } from "vitest";
import { canApproveTakeoff, canDeletePlanSet, canEditTakeoff } from "./access";

describe("takeoff access", () => {
  it("office roles and sales reps edit; office roles approve; admin and manager delete", () => {
    expect(canEditTakeoff("SALES_REP")).toBe(true);
    expect(canEditTakeoff("OFFICE_STAFF")).toBe(true);
    expect(canEditTakeoff("CREW_LEAD")).toBe(false);
    expect(canEditTakeoff("READ_ONLY")).toBe(false);
    expect(canEditTakeoff("MARKETING")).toBe(false);
    expect(canApproveTakeoff("SALES_REP")).toBe(false);
    expect(canApproveTakeoff("OFFICE_STAFF")).toBe(true);
    expect(canDeletePlanSet("OFFICE_STAFF")).toBe(false);
    expect(canDeletePlanSet("MANAGER")).toBe(true);
    expect(canEditTakeoff(null)).toBe(false);
  });
});
