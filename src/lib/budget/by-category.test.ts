import { describe, expect, it } from "vitest";
import { budgetByCategory } from "./by-category";

describe("budgetByCategory", () => {
  it("adds up each category and puts uncategorised lines under Other, last", () => {
    const rows = budgetByCategory([
      { category: "Interior", budget: 30_000, actual: 12_000.1, committed: 0 },
      { category: null, budget: 2_000, actual: 0, committed: 0 },
      { category: "Exterior", budget: 18_000, actual: 19_500, committed: 500 },
      { category: "Interior ", budget: 5_000, actual: 1_000, committed: 250 },
    ]);
    expect(rows).toEqual([
      { category: "Exterior", budget: 18_000, actual: 19_500, committed: 500, lines: 1 },
      { category: "Interior", budget: 35_000, actual: 13_000.1, committed: 250, lines: 2 },
      { category: "Other", budget: 2_000, actual: 0, committed: 0, lines: 1 },
    ]);
  });

  it("is empty with no lines", () => {
    expect(budgetByCategory([])).toEqual([]);
  });
});
