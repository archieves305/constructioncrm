import { prisma } from "@/lib/db/prisma";
import type { Prisma, ZylowProperty } from "@/generated/prisma/client";
import { zylowClient, ZylowCreditExhausted } from "./client";
import type { ZylowPropertyRecord } from "./types";

export const ZYLOW_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refresh ~once/day

const toDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

// API record (snake_case, numbers) → Prisma row data.
function toRow(rec: ZylowPropertyRecord): Prisma.ZylowPropertyUncheckedCreateInput {
  return {
    reapiId: rec.id,
    address: rec.address,
    city: rec.city,
    state: rec.state,
    zip: rec.zip,
    county: rec.county,
    latitude: rec.latitude,
    longitude: rec.longitude,
    ownerName: rec.owner_name,
    bedrooms: rec.bedrooms,
    bathrooms: rec.bathrooms,
    sqft: rec.sqft,
    yearBuilt: rec.year_built,
    propertyType: rec.property_type,
    roofType: rec.roof_type,
    lastSaleDate: toDate(rec.last_sale_date),
    lastSaleAmount: rec.last_sale_amount,
    outstandingMortgages: rec.outstanding_mortgages,
    estimatedValue: rec.estimated_value,
    cachedAtZylow: toDate(rec.cached_at),
  };
}

// Prisma row → canonical API record (so cached + live responses are identical).
export function fromRow(
  row: ZylowProperty,
  distanceMiles?: number | null,
): ZylowPropertyRecord {
  return {
    id: row.reapiId,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    county: row.county,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    owner_name: row.ownerName,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms === null ? null : Number(row.bathrooms),
    sqft: row.sqft,
    year_built: row.yearBuilt,
    property_type: row.propertyType,
    roof_type: row.roofType,
    last_sale_date: row.lastSaleDate
      ? row.lastSaleDate.toISOString().slice(0, 10)
      : null,
    last_sale_amount: row.lastSaleAmount,
    outstanding_mortgages: row.outstandingMortgages,
    estimated_value: row.estimatedValue,
    cached_at: row.cachedAtZylow ? row.cachedAtZylow.toISOString() : null,
    data_source: "zylow-cache",
    distance_miles: distanceMiles ?? null,
  };
}

export async function upsertProperty(
  rec: ZylowPropertyRecord,
): Promise<ZylowProperty> {
  const data = toRow(rec);
  return prisma.zylowProperty.upsert({
    where: { reapiId: rec.id },
    create: data,
    update: data,
  });
}

export async function upsertMany(recs: ZylowPropertyRecord[]): Promise<void> {
  // Sequential keeps it simple and avoids hammering the pool; nearby result
  // sets are small (≤500) and this runs server-side off the request's hot path.
  for (const rec of recs) {
    await upsertProperty(rec);
  }
}

/**
 * Serve a property from the local cache, fetching from Zylow only when missing
 * or stale (older than the TTL). `forceRefresh` bypasses the cache entirely.
 * Returns null when Zylow has no record for the id (404).
 */
export async function getCachedOrFetch(
  reapiId: string,
  forceRefresh = false,
): Promise<ZylowPropertyRecord | null> {
  const existing = await prisma.zylowProperty.findUnique({
    where: { reapiId },
  });

  const fresh =
    existing &&
    Date.now() - existing.fetchedAtLocal.getTime() < ZYLOW_CACHE_TTL_MS;

  if (existing && fresh && !forceRefresh) {
    return fromRow(existing);
  }

  let live: ZylowPropertyRecord | null;
  try {
    live = await zylowClient.getProperty(reapiId);
  } catch (err) {
    // Out of REAPI credits: serve a stale local copy if we have one rather than
    // failing the request; only propagate when we have nothing to fall back to.
    if (err instanceof ZylowCreditExhausted && existing) return fromRow(existing);
    throw err;
  }

  if (!live) {
    // REAPI had nothing. Fall back to any stale local copy we may hold.
    return existing ? fromRow(existing) : null;
  }

  const saved = await upsertProperty(live);
  return fromRow(saved);
}
