import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import { fetchDailyWeather, geocodeUs } from "@/lib/weather/open-meteo";
import { logger } from "@/lib/logger";

type Context = { params: Promise<{ id: string; date: string }> };

// Weather autofill for the daily log. Returns the fields but does NOT
// persist them — the client merges into its draft, keeping manual override
// trivial. Job coordinates are geocoded once from the lead address (zip
// first, then city+state) and cached on the Job row.
export async function GET(request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "read");
  if ("response" in ctx) return ctx.response;

  // Device coordinates win when the client sends them — the iPad standing
  // on the jobsite beats a geocoded mailing address. Job coords remain the
  // fallback (and office users without GPS).
  const qLat = Number(request.nextUrl.searchParams.get("lat"));
  const qLng = Number(request.nextUrl.searchParams.get("lng"));
  if (
    Number.isFinite(qLat) && Number.isFinite(qLng) &&
    Math.abs(qLat) <= 90 && Math.abs(qLng) <= 180 &&
    (qLat !== 0 || qLng !== 0)
  ) {
    try {
      const weather = await fetchDailyWeather(qLat, qLng, date);
      if (weather) {
        return NextResponse.json({
          weatherSummary: weather.summary,
          weatherTempHighF: weather.tempHighF,
          weatherTempLowF: weather.tempLowF,
          weatherPrecipIn: weather.precipIn,
          weatherWindMph: weather.windMph,
          weatherSource: "open-meteo (device location)",
        });
      }
    } catch (err) {
      logger.exception(err, { where: "daily-logs.weather.device", jobId, date });
      // fall through to job coordinates
    }
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      latitude: true,
      longitude: true,
      lead: { select: { zipCode: true, city: true, state: true } },
    },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let lat = job.latitude == null ? null : Number(job.latitude);
  let lng = job.longitude == null ? null : Number(job.longitude);

  if (lat == null || lng == null) {
    try {
      const geo =
        (job.lead.zipCode ? await geocodeUs(job.lead.zipCode) : null) ??
        (job.lead.city
          ? await geocodeUs(`${job.lead.city}, ${job.lead.state ?? "FL"}`)
          : null);
      if (geo) {
        lat = geo.latitude;
        lng = geo.longitude;
        await prisma.job.update({
          where: { id: jobId },
          data: { latitude: lat, longitude: lng },
        });
      }
    } catch (err) {
      logger.exception(err, { where: "daily-logs.weather.geocode", jobId });
    }
  }

  if (lat == null || lng == null) {
    return NextResponse.json(
      { error: "Couldn't locate this job — set its coordinates or enter weather manually" },
      { status: 422 },
    );
  }

  try {
    const weather = await fetchDailyWeather(lat, lng, date);
    if (!weather) {
      return NextResponse.json(
        { error: "No weather data available for this date" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      weatherSummary: weather.summary,
      weatherTempHighF: weather.tempHighF,
      weatherTempLowF: weather.tempLowF,
      weatherPrecipIn: weather.precipIn,
      weatherWindMph: weather.windMph,
      weatherSource: "open-meteo",
    });
  } catch (err) {
    logger.exception(err, { where: "daily-logs.weather.fetch", jobId, date });
    return NextResponse.json(
      { error: "Weather service unavailable — enter weather manually" },
      { status: 502 },
    );
  }
}
