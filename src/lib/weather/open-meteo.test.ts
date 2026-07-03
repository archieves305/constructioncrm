import { describe, expect, it } from "vitest";
import {
  parseDailyResponse,
  parseGeocodeResponse,
  wmoCodeToSummary,
} from "./open-meteo";

describe("wmoCodeToSummary", () => {
  it("maps representative codes", () => {
    expect(wmoCodeToSummary(0)).toBe("Clear");
    expect(wmoCodeToSummary(2)).toBe("Partly cloudy");
    expect(wmoCodeToSummary(3)).toBe("Overcast");
    expect(wmoCodeToSummary(45)).toBe("Fog");
    expect(wmoCodeToSummary(55)).toBe("Drizzle");
    expect(wmoCodeToSummary(65)).toBe("Rain");
    expect(wmoCodeToSummary(75)).toBe("Snow");
    expect(wmoCodeToSummary(82)).toBe("Rain showers");
    expect(wmoCodeToSummary(95)).toBe("Thunderstorms");
    expect(wmoCodeToSummary(42)).toBe("Unknown");
  });
});

describe("parseDailyResponse", () => {
  it("parses a normal single-day response", () => {
    const out = parseDailyResponse({
      daily: {
        time: ["2026-07-03"],
        weather_code: [80],
        temperature_2m_max: [91.4],
        temperature_2m_min: [78.2],
        precipitation_sum: [0.354],
        wind_speed_10m_max: [12.6],
      },
    });
    expect(out).toEqual({
      summary: "Rain showers",
      tempHighF: 91,
      tempLowF: 78,
      precipIn: 0.35,
      windMph: 13,
    });
  });

  it("returns null on empty/missing daily block", () => {
    expect(parseDailyResponse({})).toBeNull();
    expect(parseDailyResponse({ daily: { time: [] } })).toBeNull();
  });

  it("tolerates partial fields", () => {
    const out = parseDailyResponse({
      daily: { time: ["2026-07-03"], weather_code: [0] },
    });
    expect(out).toEqual({
      summary: "Clear",
      tempHighF: null,
      tempLowF: null,
      precipIn: null,
      windMph: null,
    });
  });
});

describe("parseGeocodeResponse", () => {
  it("takes the first result", () => {
    expect(
      parseGeocodeResponse({
        results: [{ latitude: 26.12, longitude: -80.14, name: "Fort Lauderdale" }],
      }),
    ).toEqual({ latitude: 26.12, longitude: -80.14, name: "Fort Lauderdale" });
  });

  it("returns null when empty or malformed", () => {
    expect(parseGeocodeResponse({})).toBeNull();
    expect(parseGeocodeResponse({ results: [] })).toBeNull();
    expect(parseGeocodeResponse({ results: [{ name: "x" }] })).toBeNull();
  });
});
