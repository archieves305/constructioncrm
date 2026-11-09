import { describe, expect, it } from "vitest";
import { enumItems, enumLabel } from "./enum-label";

describe("enumLabel", () => {
  it("turns an enum value into words", () => {
    expect(enumLabel("LEAD_STAGE_CHANGED")).toBe("Lead stage changed");
    expect(enumLabel("URGENT")).toBe("Urgent");
    expect(enumItems(["LOW", "HIGH"])).toEqual({ LOW: "Low", HIGH: "High" });
  });
});
