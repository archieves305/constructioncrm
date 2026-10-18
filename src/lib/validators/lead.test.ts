import { describe, expect, it } from "vitest";
import { createLeadSchema, updateLeadSchema } from "./lead";

describe("lead update", () => {
  it("leaves out what the PATCH did not send — no defaults", () => {
    expect(updateLeadSchema.parse({ parcelNumber: "50-43-43-23-05-012-0010" })).toEqual({ parcelNumber: "50-43-43-23-05-012-0010" });
  });
  it("a new lead still gets its defaults", () => {
    const v = createLeadSchema.parse({ firstName: "A", lastName: "B", primaryPhone: "5615550100", propertyAddress1: "1 Main", city: "Palm Beach", zipCode: "33480" });
    expect(v).toMatchObject({ state: "FL", propertyType: "RESIDENTIAL", insuranceClaim: false, financingNeeded: false, urgent: false });
  });
  it("the parcel number and legal description can be cleared", () => {
    expect(updateLeadSchema.parse({ parcelNumber: null, legalDescription: null })).toEqual({ parcelNumber: null, legalDescription: null });
  });
});
