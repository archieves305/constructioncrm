import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { zylowClient } from "@/lib/services/zylow/client";
import { zylowErrorResponse } from "@/lib/services/zylow/http";
import {
  getSettings,
  persistScoredBatch,
  scoreRecord,
  toCard,
} from "@/lib/services/canvassing/repository";
import { propertySearchQuerySchema } from "@/lib/validators/canvassing";

// Find Properties (scored). Pulls nearby properties from Zylow, scores each
// in-memory against the current settings (no extra API calls — nearby already
// carries the full property shape), applies the admin visibility filters, and
// returns Knock-Score cards sorted high→low. Results are mirrored into the
// canvassing_properties cache best-effort, off the response path.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const parsed = propertySearchQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }
  const { lat, lng, radius_miles, limit } = parsed.data;

  try {
    const settings = await getSettings();
    const data = await zylowClient.getNearby({
      lat,
      lng,
      radiusMiles: radius_miles,
      limit,
    });

    const computedPairs = data.results.map((rec) => ({
      rec,
      computed: scoreRecord(rec, settings),
    }));

    // Best-effort cache warm; never block or fail the response on a hiccup.
    persistScoredBatch(computedPairs).catch(() => {});

    let cards = computedPairs.map(({ rec, computed }) => toCard(rec, computed));

    // Admin visibility filters (spec §10).
    if (!settings.showAbsenteeOwners) {
      cards = cards.filter((c) => c.ownerOccupied !== false);
    }
    if (settings.hideLowScoreProperties) {
      cards = cards.filter((c) => c.knockScore >= settings.minPriorityScore);
    }
    cards.sort((a, b) => b.knockScore - a.knockScore);

    return NextResponse.json({
      results: cards,
      count: cards.length,
      minPriorityScore: settings.minPriorityScore,
    });
  } catch (err) {
    return zylowErrorResponse(err, { route: "canvassing/properties", lat, lng });
  }
}
