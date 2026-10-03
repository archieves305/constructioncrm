/**
 * Planning the one-time import of the roofing estimator's data. Pure: rows
 * in, a plan out. The script that reads both databases and applies the plan
 * is `scripts/import-roof-estimator-2026-10.ts`.
 */
import { addressKey } from "./address";
import { DEFAULT_RULES, type RuleDef } from "./engine/defaults";
import { MEASUREMENT_KEYS, type MeasurementKey } from "./measurements";

export type SourceProperty = { id: string; addressLine1: string; city: string | null; state: string | null; postalCode: string | null };
export type LeadAddress = { id: string; propertyAddress1: string; city: string; zipCode: string };

export type PropertyMatch =
  | { status: "matched"; leadId: string }
  | { status: "ambiguous"; leadIds: string[] }
  | { status: "unmatched" };

const zip5 = (z: string | null | undefined) => (z ?? "").trim().slice(0, 5);
const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * A property is a lead's when the street line is the same after
 * normalising (St / Street, NW / Northwest) AND the zip is the same — or,
 * when either side has no zip, the city is. Nothing looser: a near miss goes
 * to a person. Two leads at one address is "ambiguous", also for a person.
 */
export function matchProperty(p: SourceProperty, leads: readonly LeadAddress[]): PropertyMatch {
  const street = addressKey(p.addressLine1);
  if (!street) return { status: "unmatched" };
  const hits = leads.filter((l) => {
    if (addressKey(l.propertyAddress1) !== street) return false;
    const a = zip5(p.postalCode);
    const b = zip5(l.zipCode);
    return a && b ? a === b : same(p.city, l.city) && !!(p.city ?? "").trim();
  });
  if (hits.length === 1) return { status: "matched", leadId: hits[0].id };
  if (hits.length > 1) return { status: "ambiguous", leadIds: hits.map((h) => h.id) };
  return { status: "unmatched" };
}

export type SourceMaterial = { id: string; category: string; name: string; roofType: string | null };

/** A material is already here when one with the same name, category and roof type exists (case-insensitive). */
export function planMaterials<T extends SourceMaterial>(source: readonly T[], existing: readonly { category: string; name: string; roofType: string | null }[]) {
  const key = (m: { category: string; name: string; roofType: string | null }) => `${m.category.trim().toLowerCase()}|${m.name.trim().toLowerCase()}|${m.roofType ?? ""}`;
  const have = new Set(existing.map(key));
  const toCreate: T[] = [];
  const already: T[] = [];
  for (const m of source) {
    if (have.has(key(m))) already.push(m);
    else {
      toCreate.push(m);
      have.add(key(m));
    }
  }
  return { toCreate, already };
}

export type SourceRule = { key: string; value: number | null; active: boolean };

/**
 * The estimator's rule table against this app's rules: only rows that differ
 * from the code (a different number, or switched off) become a saved change.
 * A row for a rule this app does not have is reported, not imported.
 */
export function planRuleChanges(source: readonly SourceRule[], defaults: readonly RuleDef[] = DEFAULT_RULES) {
  const def = new Map(defaults.map((d) => [d.key, d]));
  const changes: { key: string; value: number; active: boolean; defaultValue: number }[] = [];
  const unknown: string[] = [];
  for (const r of source) {
    const d = def.get(r.key);
    if (!d) {
      unknown.push(r.key);
      continue;
    }
    const value = r.value ?? d.value;
    if (value !== d.value || !r.active) changes.push({ key: r.key, value, active: r.active, defaultValue: d.value });
  }
  return { changes, unknown };
}

/** Fields where the estimator's stored reading and a fresh parse of the same report disagree. */
export function measurementDifferences(stored: Record<string, unknown>, parsed: Record<string, unknown>): { field: MeasurementKey; stored: unknown; parsed: unknown }[] {
  const out: { field: MeasurementKey; stored: unknown; parsed: unknown }[] = [];
  for (const k of MEASUREMENT_KEYS) {
    const a = stored[k] ?? null;
    const b = parsed[k] ?? null;
    if (a === null && b === null) continue;
    const equal = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.01 : a === b;
    if (!equal) out.push({ field: k, stored: a, parsed: b });
  }
  return out;
}

/** The values a person typed over the estimator's reading: `{ field: { value } }` → `{ field: value }`, known fields only. */
export function manualOverrides(overrides: unknown): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {};
  if (!overrides || typeof overrides !== "object") return out;
  for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
    if (!MEASUREMENT_KEYS.includes(k as MeasurementKey)) continue;
    const value = v && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : undefined;
    if (value === null || typeof value === "number" || typeof value === "string") out[k] = value;
  }
  return out;
}
