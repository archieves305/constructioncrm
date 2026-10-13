import { describe, expect, it } from "vitest";
import { customerName } from "./job";

describe("customerName", () => {
  it("names the person on a customer lead, falling back to the company", () => {
    expect(customerName({ fullName: "Ana Ruiz", companyName: "Ruiz LLC" })).toBe("Ana Ruiz");
    expect(customerName({ fullName: "", companyName: "Ruiz LLC" })).toBe("Ruiz LLC");
  });
  it("names the contractor on a GC bid package, not the estimator", () => {
    expect(customerName({ kind: "GC_BID", fullName: "Dan Estimator", companyName: "Coastal Choice Construction" })).toBe("Coastal Choice Construction");
    expect(customerName({ kind: "GC_BID", fullName: "Dan Estimator", companyName: null })).toBe("Dan Estimator");
  });
});
