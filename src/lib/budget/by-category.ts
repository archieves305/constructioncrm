/**
 * A job's budget lines rolled up by category. Pure (client-safe).
 *
 * "Actual" is what is booked against the lines (their allocations);
 * "committed" is what is promised to vendors on them and not yet paid.
 * A line with no category falls under "Other", which sorts last.
 */
export type BudgetCategoryRow = { category: string; budget: number; actual: number; committed: number; lines: number };

export const OTHER_CATEGORY = "Other";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function budgetByCategory(lines: { category: string | null; budget: number; actual: number; committed: number }[]): BudgetCategoryRow[] {
  const by = new Map<string, BudgetCategoryRow>();
  for (const l of lines) {
    const category = l.category?.trim() || OTHER_CATEGORY;
    const row = by.get(category) ?? { category, budget: 0, actual: 0, committed: 0, lines: 0 };
    row.budget = round2(row.budget + l.budget);
    row.actual = round2(row.actual + l.actual);
    row.committed = round2(row.committed + l.committed);
    row.lines += 1;
    by.set(category, row);
  }
  return [...by.values()].sort((a, b) =>
    a.category === OTHER_CATEGORY ? 1 : b.category === OTHER_CATEGORY ? -1 : a.category.localeCompare(b.category),
  );
}
