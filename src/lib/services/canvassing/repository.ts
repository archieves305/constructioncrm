import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { getCachedOrFetch } from "@/lib/services/zylow/cache";
import type { ZylowPropertyRecord } from "@/lib/services/zylow/types";
import { normalizeFromZylow } from "./normalize";
import { computeKnockScore } from "./score";
import { buildCanvasserSummary, type CanvasserSummary } from "./summary";
import type { RoofAgeEstimate } from "./roof-age";
import {
  DEFAULT_COMPLIANCE_DISCLAIMER,
  DEFAULT_OPENING_SCRIPT,
  DEFAULT_SCORING_CONFIG,
  scoringConfigSchema,
  type ScoringConfig,
} from "./scoring-config";

// ─── Canvassing property repository ───────────────────────────────────────────
// Orchestrates the pure scoring layer (normalize → score → summary) with the
// Zylow data source and the `canvassing_properties` cache. Scoring is cheap and
// always recomputed from the raw payload on read, so editing the scoring config
// or passing a canvasser name reflects immediately WITHOUT a new API call; Zylow
// is only re-hit when the raw payload is missing, older than cacheTtlDays, or a
// refresh is forced (spec §11).

export type CanvassingSettings = Awaited<ReturnType<typeof getSettings>>;

const toDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

/** Singleton settings, seeding defaults on first read. Parses the JSON config,
 *  falling back to the default config if it's somehow invalid. */
export async function getSettings() {
  const row = await prisma.canvassingSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      scoringConfigJson: DEFAULT_SCORING_CONFIG as unknown as Prisma.InputJsonValue,
      defaultOpeningScript: DEFAULT_OPENING_SCRIPT,
      complianceDisclaimer: DEFAULT_COMPLIANCE_DISCLAIMER,
    },
  });

  const parsed = scoringConfigSchema.safeParse(row.scoringConfigJson);
  const scoringConfig: ScoringConfig = parsed.success
    ? parsed.data
    : DEFAULT_SCORING_CONFIG;

  return { ...row, scoringConfig };
}

type Computed = {
  normalized: ReturnType<typeof normalizeFromZylow>;
  result: ReturnType<typeof computeKnockScore>;
  roofAge: RoofAgeEstimate;
  summary: CanvasserSummary;
};

/** Pure scoring of one upstream record against the current settings. */
export function scoreRecord(
  rec: ZylowPropertyRecord,
  settings: CanvassingSettings,
  opts: { canvasserName?: string | null; companyName?: string } = {},
): Computed {
  const normalized = normalizeFromZylow(rec);
  const result = computeKnockScore(normalized, settings.scoringConfig);
  const summary = buildCanvasserSummary(normalized, result, {
    canvasserName: opts.canvasserName,
    companyName: opts.companyName,
    defaultOpeningScript: settings.defaultOpeningScript,
    complianceDisclaimer: settings.complianceDisclaimer,
    highEquityThreshold: settings.scoringConfig.highEquityThreshold,
  });
  return { normalized, result, roofAge: result.breakdown.roofAge, summary };
}

/** Compact card for the Find Properties list/map (spec §5). */
export function toCard(rec: ZylowPropertyRecord, c: Computed) {
  const n = c.normalized;
  return {
    reapiId: n.reapiId,
    address: n.propertyAddress,
    city: n.city,
    state: n.state,
    zip: n.zip,
    ownerName: n.ownerName,
    ownerOccupied: n.ownerOccupied,
    latitude: rec.latitude,
    longitude: rec.longitude,
    distanceMiles: rec.distance_miles ?? null,
    yearBuilt: n.yearBuilt,
    ownedSince: n.ownedSince,
    estimatedValue: n.estimatedValue,
    estimatedEquity: n.estimatedEquity,
    equityPercentage: n.equityPercentage,
    roofType: n.roofType,
    estimatedRoofAge: c.roofAge.years,
    roofAgeBasis: c.roofAge.basis,
    knockScore: c.result.score,
    knockScoreTier: c.result.tier,
    priority: c.summary.priority,
  };
}

/** Persist (upsert) a scored record into the canvassing_properties cache. */
export async function upsertScored(
  rec: ZylowPropertyRecord,
  c: Computed,
): Promise<void> {
  const n = c.normalized;
  const data: Prisma.CanvassingPropertyUncheckedCreateInput = {
    reapiId: n.reapiId,
    propertyAddress: n.propertyAddress,
    city: n.city,
    state: n.state,
    zip: n.zip,
    ownerName: n.ownerName,
    mailingAddress: n.mailingAddress,
    ownerOccupied: n.ownerOccupied,
    yearBuilt: n.yearBuilt,
    ownedSince: n.ownedSince,
    lastSaleDate: toDate(n.lastSaleDate),
    lastSalePrice: n.lastSalePrice,
    estimatedValue: n.estimatedValue,
    estimatedMortgageBalance: n.estimatedMortgageBalance,
    estimatedEquity: n.estimatedEquity,
    equityPercentage: n.equityPercentage,
    lastRoofPermitDate: toDate(n.lastRoofPermitDate),
    estimatedRoofAge: c.roofAge.years,
    roofType: n.roofType,
    propertyType: n.propertyType,
    buildingSqft: n.buildingSqft,
    stories: n.stories,
    lotSizeSqft: n.lotSizeSqft,
    knockScore: c.result.score,
    knockScoreTier: c.result.tier,
    recommendedOpening: c.summary.recommendedOpening,
    canvasserSummaryJson: c.summary as unknown as Prisma.InputJsonValue,
    realapiRawJson: rec as unknown as Prisma.InputJsonValue,
    lastRealapiSyncAt: new Date(),
  };

  await prisma.canvassingProperty.upsert({
    where: { reapiId: n.reapiId },
    create: data,
    update: data,
  });
}

/** Best-effort mirror of a batch of search results into the cache, off the
 *  request's hot path (never throws). */
export async function persistScoredBatch(
  pairs: Array<{ rec: ZylowPropertyRecord; computed: Computed }>,
): Promise<void> {
  for (const { rec, computed } of pairs) {
    try {
      await upsertScored(rec, computed);
    } catch (err) {
      logger.warn("canvassing cache upsert failed", {
        reapiId: rec.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export type CanvasserDetail = ReturnType<typeof toCard> & {
  mailingAddress: string | null;
  propertyType: string | null;
  buildingSqft: number | null;
  stories: number | null;
  lotSizeSqft: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  estimatedMortgageBalance: number | null;
  lastRoofPermitDate: string | null;
  summary: CanvasserSummary;
  stale: boolean;
};

/**
 * Full scored detail + canvasser summary for one property (spec §6). Uses the
 * stored raw payload when fresh; re-fetches from Zylow only when missing, stale,
 * or forced. Returns null when the property is unknown to both us and Zylow.
 */
export async function getOrEnrich(
  reapiId: string,
  opts: {
    forceRefresh?: boolean;
    canvasserName?: string | null;
    companyName?: string;
  } = {},
): Promise<CanvasserDetail | null> {
  const settings = await getSettings();
  const ttlMs = settings.cacheTtlDays * 24 * 60 * 60 * 1000;

  const row = await prisma.canvassingProperty.findUnique({ where: { reapiId } });
  const fresh =
    row?.realapiRawJson != null &&
    row.lastRealapiSyncAt != null &&
    Date.now() - row.lastRealapiSyncAt.getTime() < ttlMs;

  let rec: ZylowPropertyRecord | null = null;
  let fetched = false;
  let stale = false;

  if (opts.forceRefresh || !fresh) {
    try {
      rec = await getCachedOrFetch(reapiId, opts.forceRefresh);
      fetched = rec != null;
    } catch (err) {
      // Couldn't reach the data source — fall back to a stale local copy if we
      // have one rather than failing the canvasser (spec §12).
      if (row?.realapiRawJson) {
        rec = row.realapiRawJson as unknown as ZylowPropertyRecord;
        stale = true;
      } else {
        throw err;
      }
    }
  }
  if (!rec && row?.realapiRawJson) {
    rec = row.realapiRawJson as unknown as ZylowPropertyRecord;
    stale = !fresh;
  }
  if (!rec) return null;

  const computed = scoreRecord(rec, settings, {
    canvasserName: opts.canvasserName,
    companyName: opts.companyName,
  });

  // Persist only when we pulled fresh upstream data (keeps the score column and
  // last_realapi_sync_at current); a stale-fallback read doesn't touch the row.
  if (fetched) {
    await upsertScored(rec, computed).catch(() => {});
  }

  const n = computed.normalized;
  return {
    ...toCard(rec, computed),
    mailingAddress: n.mailingAddress,
    propertyType: n.propertyType,
    buildingSqft: n.buildingSqft,
    stories: n.stories,
    lotSizeSqft: n.lotSizeSqft,
    lastSaleDate: n.lastSaleDate,
    lastSalePrice: n.lastSalePrice,
    estimatedMortgageBalance: n.estimatedMortgageBalance,
    lastRoofPermitDate: n.lastRoofPermitDate,
    summary: computed.summary,
    stale,
  };
}
