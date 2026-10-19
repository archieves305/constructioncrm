/**
 * How an imported budget replaces a job's lines. Pure.
 *
 * A line that is still in the file (same category and name, case and spacing
 * ignored) keeps its row, so the expenses and labor contracts allocated to it
 * stay allocated; only its amount and order change. Lines not in the file are
 * removed (their allocations with them); new ones are created.
 */
export type ExistingBudgetLine = { id: string; category: string | null; name: string; amount: number };
export type ImportedBudgetRow = { category: string | null; name: string; amount: number };

export type BudgetImportPlan = {
  update: { id: string; category: string | null; name: string; amount: number; sortOrder: number }[];
  create: { category: string | null; name: string; amount: number; sortOrder: number }[];
  remove: string[];
};

const key = (category: string | null, name: string) =>
  `${(category ?? "").trim().toLowerCase().replace(/\s+/g, " ")}|${name.trim().toLowerCase().replace(/\s+/g, " ")}`;

export function planBudgetImport(existing: readonly ExistingBudgetLine[], rows: readonly ImportedBudgetRow[]): BudgetImportPlan {
  const free = new Map<string, ExistingBudgetLine[]>();
  for (const line of existing) {
    const k = key(line.category, line.name);
    free.set(k, [...(free.get(k) ?? []), line]);
  }
  const plan: BudgetImportPlan = { update: [], create: [], remove: [] };
  rows.forEach((row, sortOrder) => {
    const match = free.get(key(row.category, row.name))?.shift();
    if (match) plan.update.push({ id: match.id, category: row.category, name: row.name, amount: row.amount, sortOrder });
    else plan.create.push({ category: row.category, name: row.name, amount: row.amount, sortOrder });
  });
  for (const left of free.values()) plan.remove.push(...left.map((l) => l.id));
  return plan;
}
