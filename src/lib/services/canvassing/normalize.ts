import type { ZylowPropertyRecord } from "@/lib/services/zylow/types";

// ─── Property normalization ───────────────────────────────────────────────────
// Turns a raw Zylow/REAPI property record into the canonical shape the scorer and
// summary generator consume. Pure (no I/O). Two rules from the spec are enforced
// here: equity is *derived* (value − mortgages) and left null when value is
// missing — never guessed; and fields Zylow doesn't carry (mailing address,
// owner-occupied, permits, lot size, stories, storm) are pulled defensively from
// the raw record when present and otherwise null/unknown.

export type NormalizedProperty = {
  reapiId: string;
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ownerName: string | null;
  mailingAddress: string | null;
  ownerOccupied: boolean | null;
  yearBuilt: number | null;
  propertyType: string | null;
  buildingSqft: number | null;
  stories: number | null;
  lotSizeSqft: number | null;
  roofType: string | null;
  lastSaleDate: string | null; // ISO YYYY-MM-DD
  lastSalePrice: number | null;
  ownedSince: number | null; // calendar year of last sale
  estimatedValue: number | null;
  estimatedMortgageBalance: number | null;
  estimatedEquity: number | null;
  equityPercentage: number | null; // 0–100, null when not computable
  lastRoofPermitDate: string | null; // ISO YYYY-MM-DD
  hasRoofPermit: boolean;
};

// Raw records may carry fields beyond the typed Zylow shape (permits, mailing
// address, etc.). Read them loosely so we never crash on a missing key.
type LooseRecord = ZylowPropertyRecord & Record<string, unknown>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function yearOf(iso: string | null): number | null {
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isFinite(y) && y > 1800 ? y : null;
}

// Most recent permit whose type/description mentions "roof". Accepts a few shapes
// (`roof_permits`, `permits[]` with a type field, or an explicit date field).
function extractLastRoofPermitDate(raw: LooseRecord): string | null {
  const explicit = str(raw["last_roof_permit_date"]);
  if (explicit) return explicit.slice(0, 10);

  const lists = [raw["roof_permits"], raw["permits"], raw["permit_history"]];
  let latest: string | null = null;
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const p of list as Array<Record<string, unknown>>) {
      const type = `${str(p?.["type"]) ?? ""} ${str(p?.["description"]) ?? ""}`.toLowerCase();
      const isRoof = type.includes("roof") || list === raw["roof_permits"];
      const date = str(p?.["date"]) ?? str(p?.["issued_date"]) ?? str(p?.["permit_date"]);
      if (isRoof && date && (!latest || date > latest)) latest = date.slice(0, 10);
    }
  }
  return latest;
}

function extractOwnerOccupied(
  raw: LooseRecord,
  propertyAddress: string | null,
  mailingAddress: string | null,
): boolean | null {
  const explicit = raw["owner_occupied"];
  if (typeof explicit === "boolean") return explicit;
  // Derive from mailing vs property address only when both are present.
  if (propertyAddress && mailingAddress) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    return norm(propertyAddress) === norm(mailingAddress);
  }
  return null;
}

export function normalizeFromZylow(rec: ZylowPropertyRecord): NormalizedProperty {
  const raw = rec as LooseRecord;

  const estimatedValue = num(rec.estimated_value);
  const estimatedMortgageBalance = num(rec.outstanding_mortgages);

  // Equity is only computable with a value; never guess (spec §12).
  let estimatedEquity: number | null = null;
  let equityPercentage: number | null = null;
  if (estimatedValue != null) {
    const mortgage = estimatedMortgageBalance ?? 0; // no mortgage on record ⇒ free & clear
    estimatedEquity = estimatedValue - mortgage;
    equityPercentage =
      estimatedValue > 0
        ? Math.max(0, Math.min(100, Math.round((estimatedEquity / estimatedValue) * 100)))
        : null;
  }

  const propertyAddress = str(rec.address);
  const mailingAddress = str(raw["mailing_address"]);
  const lastSaleDate = str(rec.last_sale_date)?.slice(0, 10) ?? null;
  const lastRoofPermitDate = extractLastRoofPermitDate(raw);

  return {
    reapiId: rec.id,
    propertyAddress,
    city: str(rec.city),
    state: str(rec.state),
    zip: str(rec.zip),
    ownerName: str(rec.owner_name),
    mailingAddress,
    ownerOccupied: extractOwnerOccupied(raw, propertyAddress, mailingAddress),
    yearBuilt: num(rec.year_built),
    propertyType: str(rec.property_type),
    buildingSqft: num(rec.sqft),
    stories: num(raw["stories"]),
    lotSizeSqft: num(raw["lot_size_sqft"]) ?? num(raw["lot_size"]),
    roofType: str(rec.roof_type),
    lastSaleDate,
    lastSalePrice: num(rec.last_sale_amount),
    ownedSince: yearOf(lastSaleDate),
    estimatedValue,
    estimatedMortgageBalance,
    estimatedEquity,
    equityPercentage,
    lastRoofPermitDate,
    hasRoofPermit: lastRoofPermitDate != null,
  };
}
