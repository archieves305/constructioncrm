import { describe, expect, it } from "vitest";
import type { ZylowPropertyRecord } from "@/lib/services/zylow/types";
import { normalizeFromZylow } from "./normalize";

function rec(o: Partial<ZylowPropertyRecord> & Record<string, unknown>): ZylowPropertyRecord {
  return {
    id: "r1",
    address: null,
    city: null,
    state: null,
    zip: null,
    county: null,
    latitude: null,
    longitude: null,
    owner_name: null,
    bedrooms: null,
    bathrooms: null,
    sqft: null,
    year_built: null,
    property_type: null,
    roof_type: null,
    last_sale_date: null,
    last_sale_amount: null,
    outstanding_mortgages: null,
    estimated_value: null,
    cached_at: null,
    ...o,
  } as ZylowPropertyRecord;
}

describe("normalizeFromZylow — equity", () => {
  it("derives equity and percentage from value minus mortgages", () => {
    const n = normalizeFromZylow(rec({ estimated_value: 500000, outstanding_mortgages: 140000 }));
    expect(n.estimatedEquity).toBe(360000);
    expect(n.equityPercentage).toBe(72);
  });

  it("treats a missing mortgage as free-and-clear (100%)", () => {
    const n = normalizeFromZylow(rec({ estimated_value: 400000, outstanding_mortgages: null }));
    expect(n.estimatedEquity).toBe(400000);
    expect(n.equityPercentage).toBe(100);
  });

  it("leaves equity null when value is missing — never guesses", () => {
    const n = normalizeFromZylow(rec({ estimated_value: null, outstanding_mortgages: 100000 }));
    expect(n.estimatedEquity).toBeNull();
    expect(n.equityPercentage).toBeNull();
  });
});

describe("normalizeFromZylow — ownership & occupancy", () => {
  it("derives owned-since year from last sale date", () => {
    expect(normalizeFromZylow(rec({ last_sale_date: "2006-05-01" })).ownedSince).toBe(2006);
  });

  it("uses an explicit owner_occupied flag", () => {
    expect(normalizeFromZylow(rec({ owner_occupied: false })).ownerOccupied).toBe(false);
  });

  it("infers owner-occupied when mailing matches the property address", () => {
    const n = normalizeFromZylow(
      rec({ address: "123 Main St", mailing_address: "123 Main St." }),
    );
    expect(n.ownerOccupied).toBe(true);
  });

  it("leaves occupancy null when it cannot be determined", () => {
    expect(normalizeFromZylow(rec({ address: "123 Main St" })).ownerOccupied).toBeNull();
  });
});

describe("normalizeFromZylow — roof permits", () => {
  it("reads an explicit last roof permit date", () => {
    const n = normalizeFromZylow(rec({ last_roof_permit_date: "2018-09-12" }));
    expect(n.lastRoofPermitDate).toBe("2018-09-12");
    expect(n.hasRoofPermit).toBe(true);
  });

  it("picks the most recent roof permit out of a permit history array", () => {
    const n = normalizeFromZylow(
      rec({
        permits: [
          { type: "Roof Replacement", date: "2012-01-01" },
          { type: "Pool", date: "2020-01-01" },
          { type: "Re-Roof", date: "2016-06-01" },
        ],
      }),
    );
    expect(n.lastRoofPermitDate).toBe("2016-06-01");
    expect(n.hasRoofPermit).toBe(true);
  });

  it("has no roof permit when none are on record", () => {
    expect(normalizeFromZylow(rec({})).hasRoofPermit).toBe(false);
  });
});
