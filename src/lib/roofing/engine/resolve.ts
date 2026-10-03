/**
 * From what the company has saved to what the takeoff engine reads: the rule
 * set for a roof type, and the priced catalog as of a date. Pure.
 */
import type { RoofType } from "../types";
import { DEFAULT_RULES, type RuleDef, type RuleKind } from "./defaults";
import type { PricedMaterial, ResolvedRule } from "./engine";

/** A saved change to one rule: a different number, or switched off. */
export type RuleOverride = { key: string; value: number; active: boolean };

export type RuleRow = RuleDef & {
  /** The number in the code. */
  defaultValue: number;
  /** True when the company has changed the number or switched the rule off. */
  changed: boolean;
  active: boolean;
};

/** Every rule with the company's changes laid over the defaults — what the admin page lists. */
export function ruleRows(overrides: readonly RuleOverride[], defaults: readonly RuleDef[] = DEFAULT_RULES): RuleRow[] {
  const by = new Map(overrides.map((o) => [o.key, o]));
  return defaults.map((d) => {
    const o = by.get(d.key);
    return { ...d, defaultValue: d.value, value: o ? o.value : d.value, active: o ? o.active : true, changed: !!o && (o.value !== d.value || !o.active) };
  });
}

/**
 * The rules the engine runs for a roof type (plus the rules for any roof).
 * A rule switched off is left out entirely. (The estimator fell back to the
 * code default when a rule was switched off, so it could not be switched off.)
 * A saved change for a key the code no longer has is ignored.
 */
export function resolveRules(roofType: RoofType, overrides: readonly RuleOverride[], defaults: readonly RuleDef[] = DEFAULT_RULES): ResolvedRule[] {
  return ruleRows(overrides, defaults)
    .filter((r) => r.active && (r.roofType === roofType || r.roofType === null))
    .map((r) => ({ key: r.key, label: r.label, category: r.category, kind: r.kind, inputMetric: r.inputMetric ?? null, value: r.value, unit: r.unit ?? null, params: r.params ?? null }));
}

/** Why a number is refused for a rule of this kind, in words; null when it is fine. */
export function ruleValueProblem(kind: RuleKind, value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number";
  if (value < 0) return "The number cannot be negative";
  if (kind === "waste_pct") return value > 0.5 ? "Waste is a fraction: 0.10 is 10%, and no more than 0.50" : null;
  if ((kind === "squares_per_unit" || kind === "lf_per_unit") && value === 0) return "Coverage per unit cannot be zero — switch the rule off instead";
  return null;
}

/**
 * A price takes effect on a DAY, not at an instant: `effectiveDate` is stored
 * at noon UTC of that day and only its date is read. `createdAt` settles two
 * prices for the same day — the one entered later is the correction.
 */
export type PriceRow = { unitCost: number; effectiveDate: Date; createdAt?: Date };

/** yyyy-MM-dd */
export type Day = string;
export const priceDay = (p: PriceRow): Day => p.effectiveDate.toISOString().slice(0, 10);

/** The price in force on a day: the latest one effective that day or earlier. Null when there is none. */
export function priceInForce<T extends PriceRow>(prices: readonly T[], asOfDay: Day): T | null {
  let best: T | null = null;
  for (const p of prices) {
    const day = priceDay(p);
    if (day > asOfDay) continue;
    if (!best) best = p;
    else {
      const bestDay = priceDay(best);
      if (day > bestDay || (day === bestDay && (p.createdAt?.getTime() ?? 0) > (best.createdAt?.getTime() ?? 0))) best = p;
    }
  }
  return best;
}

/** A price older than this is shown as worth re-checking. */
export const STALE_PRICE_DAYS = 90;

export function priceAgeDays(price: PriceRow | null, asOfDay: Day): number | null {
  return price ? Math.round((Date.parse(`${asOfDay}T12:00:00Z`) - Date.parse(`${priceDay(price)}T12:00:00Z`)) / 86_400_000) : null;
}

export type CatalogItem = {
  id: string;
  category: string;
  name: string;
  sku: string | null;
  roofType: string | null;
  unitType: string;
  isPreferred: boolean;
  isActive: boolean;
  prices: readonly PriceRow[];
};

/**
 * The catalog as the engine reads it. Inactive items are left out. Within a
 * category the engine takes the first match, so the order here is the choice:
 * an item for this roof type before one for any roof, preferred before not,
 * priced before unpriced, then by name. An item with no price in force is
 * priced 0 and the engine says so — it never guesses.
 */
export function pricedCatalog(items: readonly CatalogItem[], roofType: RoofType, asOfDay: Day): PricedMaterial[] {
  const rank = (i: CatalogItem, priced: boolean) => (i.roofType === roofType ? 0 : 4) + (i.isPreferred ? 0 : 2) + (priced ? 0 : 1);
  return items
    .filter((i) => i.isActive && (i.roofType === roofType || i.roofType === null))
    .map((i) => ({ item: i, price: priceInForce(i.prices, asOfDay) }))
    .sort((a, b) => rank(a.item, !!a.price) - rank(b.item, !!b.price) || a.item.name.localeCompare(b.item.name))
    .map(({ item, price }) => ({ id: item.id, category: item.category, name: item.name, sku: item.sku, unitType: item.unitType, unitCost: price?.unitCost ?? 0, roofType: (item.roofType as RoofType | null) ?? null }));
}
