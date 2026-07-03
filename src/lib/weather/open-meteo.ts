// Open-Meteo integration for daily-log weather autofill. Keyless and free
// (https://open-meteo.com); calls happen server-side only, best-effort with a
// short timeout — the crew can always type weather manually.

export type DailyWeather = {
  summary: string;
  tempHighF: number | null;
  tempLowF: number | null;
  precipIn: number | null;
  windMph: number | null;
};

// WMO weather-code groups → human summary.
const WMO_SUMMARIES: [Set<number>, string][] = [
  [new Set([0]), "Clear"],
  [new Set([1, 2]), "Partly cloudy"],
  [new Set([3]), "Overcast"],
  [new Set([45, 48]), "Fog"],
  [new Set([51, 53, 55, 56, 57]), "Drizzle"],
  [new Set([61, 63, 65, 66, 67]), "Rain"],
  [new Set([71, 73, 75, 77]), "Snow"],
  [new Set([80, 81, 82]), "Rain showers"],
  [new Set([85, 86]), "Snow showers"],
  [new Set([95, 96, 99]), "Thunderstorms"],
];

export function wmoCodeToSummary(code: number): string {
  for (const [codes, summary] of WMO_SUMMARIES) {
    if (codes.has(code)) return summary;
  }
  return "Unknown";
}

type OpenMeteoDaily = {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    wind_speed_10m_max?: number[];
  };
};

/** Pure parser for an Open-Meteo daily response (single-day request). */
export function parseDailyResponse(body: OpenMeteoDaily): DailyWeather | null {
  const d = body.daily;
  if (!d?.time?.length) return null;
  const code = d.weather_code?.[0];
  const num = (v: number | undefined | null) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const high = num(d.temperature_2m_max?.[0]);
  const low = num(d.temperature_2m_min?.[0]);
  const precip = num(d.precipitation_sum?.[0]);
  const wind = num(d.wind_speed_10m_max?.[0]);
  return {
    summary: typeof code === "number" ? wmoCodeToSummary(code) : "Unknown",
    tempHighF: high == null ? null : Math.round(high),
    tempLowF: low == null ? null : Math.round(low),
    precipIn: precip == null ? null : Math.round(precip * 100) / 100,
    windMph: wind == null ? null : Math.round(wind),
  };
}

const FETCH_TIMEOUT_MS = 5000;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  return res.json();
}

/**
 * Weather for one date at coordinates. Forecast API covers today ± ~3 months
 * of past days; older dates fall back to the historical archive API.
 */
export async function fetchDailyWeather(
  latitude: number,
  longitude: number,
  date: string,
): Promise<DailyWeather | null> {
  const params =
    `latitude=${latitude}&longitude=${longitude}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&timezone=auto&start_date=${date}&end_date=${date}`;

  const ageDays =
    (Date.now() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000;
  const host =
    ageDays > 80
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast";

  const body = (await fetchJson(`${host}?${params}`)) as OpenMeteoDaily;
  return parseDailyResponse(body);
}

export type GeocodeResult = { latitude: number; longitude: number; name: string };

type GeocodeResponse = {
  results?: { latitude?: number; longitude?: number; name?: string }[];
};

export function parseGeocodeResponse(body: GeocodeResponse): GeocodeResult | null {
  const first = body.results?.[0];
  if (
    !first ||
    typeof first.latitude !== "number" ||
    typeof first.longitude !== "number"
  ) {
    return null;
  }
  return {
    latitude: first.latitude,
    longitude: first.longitude,
    name: first.name ?? "",
  };
}

/** Geocode a US zip (preferred) or "city, state" via Open-Meteo's geocoder. */
export async function geocodeUs(query: string): Promise<GeocodeResult | null> {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
    `&count=1&language=en&format=json&countryCode=US`;
  const body = (await fetchJson(url)) as GeocodeResponse;
  return parseGeocodeResponse(body);
}
