import { describe, expect, it } from "vitest";
import { isHoursBasedPay, resolveWorkerScope } from "./scope";

const profile = {
  payType: "PIECEWORK" as const,
  workDescription: "Hangs and finishes drywall",
};

describe("resolveWorkerScope", () => {
  it("falls back to the profile when the job has no override row", () => {
    expect(resolveWorkerScope(profile, null)).toEqual({
      payType: "PIECEWORK",
      workDescription: "Hangs and finishes drywall",
      isOverridden: false,
    });
  });

  it("treats an all-null row the same as no row", () => {
    expect(
      resolveWorkerScope(profile, { payType: null, workDescription: null }),
    ).toEqual({
      payType: "PIECEWORK",
      workDescription: "Hangs and finishes drywall",
      isOverridden: false,
    });
  });

  it("falls through per column — a description override keeps the profile pay type", () => {
    expect(
      resolveWorkerScope(profile, {
        payType: null,
        workDescription: "Punch list, 2nd floor",
      }),
    ).toEqual({
      payType: "PIECEWORK",
      workDescription: "Punch list, 2nd floor",
      isOverridden: true,
    });
  });

  it("a pay-type override keeps the profile description", () => {
    expect(
      resolveWorkerScope(profile, { payType: "HOURLY", workDescription: null }),
    ).toEqual({
      payType: "HOURLY",
      workDescription: "Hangs and finishes drywall",
      isOverridden: true,
    });
  });

  it("overrides both when both are set", () => {
    expect(
      resolveWorkerScope(profile, {
        payType: "CONTRACT",
        workDescription: "Framing package, fixed bid",
      }),
    ).toEqual({
      payType: "CONTRACT",
      workDescription: "Framing package, fixed bid",
      isOverridden: true,
    });
  });

  it("a null profile description stays null rather than becoming empty text", () => {
    expect(
      resolveWorkerScope({ payType: "HOURLY", workDescription: null }, null)
        .workDescription,
    ).toBeNull();
  });
});

describe("isHoursBasedPay", () => {
  it("only HOURLY earns hours × rate", () => {
    expect(isHoursBasedPay("HOURLY")).toBe(true);
    expect(isHoursBasedPay("CONTRACT")).toBe(false);
    expect(isHoursBasedPay("PIECEWORK")).toBe(false);
  });
});
