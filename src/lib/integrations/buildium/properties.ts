import { buildiumRequest } from "./client";
import {
  scoreAddressMatch,
  normalizeZip,
  type MatchInput,
} from "./address-match";

type BuildiumAddress = {
  AddressLine1?: string | null;
  AddressLine2?: string | null;
  City?: string | null;
  State?: string | null;
  PostalCode?: string | null;
};

type BuildiumProperty = {
  Id: number;
  Name?: string | null;
  Address?: BuildiumAddress | null;
  NumberUnits?: number;
};

type BuildiumUnit = {
  Id: number;
  UnitNumber?: string | null;
  Address?: BuildiumAddress | null;
};

export type PropertyCandidate = {
  propertyId: string;
  propertyName: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  unitCount: number;
  score: number;
};

async function fetchPropertiesByZip(zip: string): Promise<BuildiumProperty[]> {
  const normalized = normalizeZip(zip);
  if (!normalized) return [];
  const list = await buildiumRequest<BuildiumProperty[]>("/rentals", {
    query: { postalcode: normalized, limit: 200 },
  });
  return Array.isArray(list) ? list : [];
}

async function fetchPropertiesByCity(city: string): Promise<BuildiumProperty[]> {
  if (!city.trim()) return [];
  const list = await buildiumRequest<BuildiumProperty[]>("/rentals", {
    query: { city: city.trim(), limit: 200 },
  });
  return Array.isArray(list) ? list : [];
}

export async function findPropertyCandidates(
  target: MatchInput,
  { minScore = 50, limit = 5 }: { minScore?: number; limit?: number } = {},
): Promise<PropertyCandidate[]> {
  const seen = new Map<number, BuildiumProperty>();

  for (const p of await fetchPropertiesByZip(target.zip)) {
    seen.set(p.Id, p);
  }
  if (seen.size === 0) {
    for (const p of await fetchPropertiesByCity(target.city)) {
      seen.set(p.Id, p);
    }
  }

  const scored: PropertyCandidate[] = [];
  for (const p of seen.values()) {
    const score = scoreAddressMatch(target, {
      address1: p.Address?.AddressLine1 ?? null,
      city: p.Address?.City ?? null,
      state: p.Address?.State ?? null,
      zip: p.Address?.PostalCode ?? null,
    });
    if (score < minScore) continue;
    scored.push({
      propertyId: String(p.Id),
      propertyName: p.Name ?? null,
      address1: p.Address?.AddressLine1 ?? null,
      city: p.Address?.City ?? null,
      state: p.Address?.State ?? null,
      zip: p.Address?.PostalCode ?? null,
      unitCount: p.NumberUnits ?? 0,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export type UnitCandidate = {
  unitId: string;
  unitNumber: string | null;
  address1: string | null;
};

export async function listPropertyUnits(
  buildiumPropertyId: string,
): Promise<UnitCandidate[]> {
  const list = await buildiumRequest<BuildiumUnit[]>("/rentals/units", {
    query: { propertyids: buildiumPropertyId, limit: 200 },
  });
  if (!Array.isArray(list)) return [];
  return list.map((u) => ({
    unitId: String(u.Id),
    unitNumber: u.UnitNumber ?? null,
    address1: u.Address?.AddressLine1 ?? null,
  }));
}
