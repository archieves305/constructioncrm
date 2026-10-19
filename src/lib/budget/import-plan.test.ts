import { describe, expect, it } from "vitest";
import { planBudgetImport } from "./import-plan";

describe("planBudgetImport", () => {
  const existing = [
    { id: "a", category: "Roof", name: "Roof replacement", amount: 9000 },
    { id: "b", category: "Demo", name: "Tear-out", amount: 3000 },
    { id: "c", category: null, name: "Permit", amount: 500 },
  ];

  it("keeps a line that is still in the file, whatever its case or spacing, so its allocations stay", () => {
    const plan = planBudgetImport(existing, [
      { category: "roof", name: "Roof  Replacement", amount: 9500 },
      { category: null, name: "Permit", amount: 500 },
    ]);
    expect(plan.update).toEqual([
      { id: "a", category: "roof", name: "Roof  Replacement", amount: 9500, sortOrder: 0 },
      { id: "c", category: null, name: "Permit", amount: 500, sortOrder: 1 },
    ]);
    expect(plan.remove).toEqual(["b"]);
    expect(plan.create).toEqual([]);
  });

  it("creates new lines and matches a repeated name once each", () => {
    const plan = planBudgetImport([{ id: "x", category: "A", name: "Labor", amount: 1 }], [
      { category: "A", name: "Labor", amount: 2 },
      { category: "A", name: "Labor", amount: 3 },
    ]);
    expect(plan.update.map((u) => u.id)).toEqual(["x"]);
    expect(plan.create).toEqual([{ category: "A", name: "Labor", amount: 3, sortOrder: 1 }]);
    expect(plan.remove).toEqual([]);
  });
});
