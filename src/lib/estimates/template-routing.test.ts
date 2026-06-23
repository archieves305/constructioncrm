import { describe, it, expect } from "vitest";
import {
  categoryForServiceName,
  categoriesForLeadServices,
  decideEstimateRoute,
  ALL_CATEGORIES,
  type LeadServiceLike,
} from "./template-routing";

const svc = (name: string): LeadServiceLike => ({
  serviceCategory: { name },
});

describe("categoryForServiceName", () => {
  it("maps canonical top-level names", () => {
    expect(categoryForServiceName("Roofing")).toBe("ROOFING");
    expect(categoryForServiceName("Drywall")).toBe("DRYWALL");
    expect(categoryForServiceName("Interior Renovations")).toBe(
      "INTERIOR_RENOVATION",
    );
    expect(categoryForServiceName("Windows")).toBe("WINDOWS_DOORS");
    expect(categoryForServiceName("Doors")).toBe("WINDOWS_DOORS");
  });

  it("resolves child categories via substring fallback", () => {
    expect(categoryForServiceName("Impact Windows")).toBe("WINDOWS_DOORS");
    expect(categoryForServiceName("Entry Doors")).toBe("WINDOWS_DOORS");
    expect(categoryForServiceName("Roof Repair")).toBe("ROOFING");
    expect(categoryForServiceName("Kitchen Remodel")).toBe(
      "INTERIOR_RENOVATION",
    );
    expect(categoryForServiceName("Drywall Repair")).toBe("DRYWALL");
  });

  it("returns null for unknown services", () => {
    expect(categoryForServiceName("Pool Cleaning")).toBeNull();
  });
});

describe("categoriesForLeadServices", () => {
  it("collapses Windows + Doors into a single WINDOWS_DOORS", () => {
    expect(categoriesForLeadServices([svc("Windows"), svc("Doors")])).toEqual([
      "WINDOWS_DOORS",
    ]);
  });

  it("dedupes while preserving order", () => {
    expect(
      categoriesForLeadServices([
        svc("Drywall"),
        svc("Roofing"),
        svc("Drywall Replacement"),
      ]),
    ).toEqual(["DRYWALL", "ROOFING"]);
  });
});

describe("decideEstimateRoute", () => {
  it("single Roofing → roofing form", () => {
    expect(decideEstimateRoute([svc("Roofing")])).toEqual({ kind: "roofing" });
  });

  it("single Drywall → generic builder", () => {
    expect(decideEstimateRoute([svc("Drywall")])).toEqual({
      kind: "generic",
      category: "DRYWALL",
    });
  });

  it("single Windows → generic WINDOWS_DOORS", () => {
    expect(decideEstimateRoute([svc("Windows")])).toEqual({
      kind: "generic",
      category: "WINDOWS_DOORS",
    });
  });

  it("single Interior Renovations → generic INTERIOR_RENOVATION", () => {
    expect(decideEstimateRoute([svc("Interior Renovations")])).toEqual({
      kind: "generic",
      category: "INTERIOR_RENOVATION",
    });
  });

  it("multiple distinct categories → picker", () => {
    const d = decideEstimateRoute([svc("Roofing"), svc("Drywall")]);
    expect(d.kind).toBe("picker");
    if (d.kind === "picker") {
      expect(d.categories).toEqual(["ROOFING", "DRYWALL"]);
    }
  });

  it("no services → picker over all categories", () => {
    expect(decideEstimateRoute([])).toEqual({
      kind: "picker",
      categories: ALL_CATEGORIES,
    });
  });
});
