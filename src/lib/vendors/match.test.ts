import { describe, expect, it } from "vitest";
import { aliasRows, groupPayees, matchVendor, normalisePayee, patternMatches } from "./match";

describe("normalisePayee", () => {
  it("lowercases, strips punctuation and collapses spaces", () => {
    expect(normalisePayee("  HomeDepot.com  800-430-3376 GA ")).toBe("homedepot com 800 430 3376 ga");
    expect(normalisePayee("WASTELINE SOLUTIONS,FORT LAUDERDA FL")).toBe("wasteline solutions fort lauderda fl");
    expect(normalisePayee(null)).toBe("");
  });
});

describe("patternMatches", () => {
  it("matches at a word start and leaves the end open", () => {
    expect(patternMatches("the home depot hollywood fl", "home depot")).toBe(true);
    expect(patternMatches("carmel dumpster rentlakeland fl", "carmel dumpster rent")).toBe(true);
    expect(patternMatches("nohome depot", "home depot")).toBe(false);
  });

  it("refuses patterns too short to mean anything", () => {
    expect(patternMatches("aci miami fl", "fl")).toBe(false);
  });
});

describe("matchVendor", () => {
  const aliases = aliasRows([
    { id: "hd", name: "Home Depot", aliases: [{ pattern: "homedepot" }] },
    { id: "hdpro", name: "Home Depot Pro" },
    { id: "lowes", name: "Lowes" },
  ]);

  it("attaches every bank spelling of a known payee", () => {
    expect(matchVendor("THE HOME DEPOT HOLLYWOOD FL", aliases)).toBe("hd");
    expect(matchVendor("HOMEDEPOT.COM 800-430-3376 GA", aliases)).toBe("hd");
    expect(matchVendor("home depot", aliases)).toBe("hd");
    expect(matchVendor("LOWES.COM 1-800-445-6937 NC", aliases)).toBe("lowes");
  });

  it("prefers the longest pattern", () => {
    expect(matchVendor("Home Depot Pro #4411", aliases)).toBe("hdpro");
  });

  it("returns null for an unknown or empty payee", () => {
    expect(matchVendor("Banner Supply", aliases)).toBeNull();
    expect(matchVendor("", aliases)).toBeNull();
    expect(matchVendor(null, aliases)).toBeNull();
  });
});

describe("groupPayees", () => {
  it("groups spellings that normalise alike and keeps the commonest text", () => {
    const groups = groupPayees([
      { vendor: "Home Depot", amount: 10, jobId: "a" },
      { vendor: "HOME DEPOT", amount: 5.5, jobId: "b" },
      { vendor: "Home Depot", amount: 1, jobId: "a" },
      { vendor: "Banner Supply", amount: 100, jobId: "a" },
      { vendor: null, amount: 3, jobId: "a" },
    ]);
    expect(groups).toEqual([
      { key: "home depot", text: "Home Depot", count: 3, total: 16.5, jobs: 2 },
      { key: "banner supply", text: "Banner Supply", count: 1, total: 100, jobs: 1 },
    ]);
  });
});
