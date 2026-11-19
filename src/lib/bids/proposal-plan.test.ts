import { describe, expect, it } from "vitest";
import { amountForScopes, baseTotal, confirmProblems, draftFromExtraction, emptyDraft, isStaleExtraction, quotedByScope, tradeFor, VALUE_KEYS, type Extraction } from "./proposal-plan";

const TRADES = [
  { id: "dry", name: "Drywall" },
  { id: "plb", name: "Plumbing" },
  { id: "roof", name: "Roofing" },
];
type V = Partial<Record<string, [string, number?, string?]>>;
/** A model answer: values with their evidence (confidence 0.95 on p.1 unless given). */
function extraction(over: { values?: V; lines?: Extraction["lines"]; bundleOnly?: boolean } = {}): Extraction {
  const base: V = {
    projectName: ["Towne Place Suites Clewiston"], address1: ["100 W Sugarland Hwy"], city: ["Clewiston"], state: ["FL"], zipCode: ["33440"],
    proposalNumber: ["P-2026-118"], proposalDate: ["2026-11-10"], validityDays: ["30"], knuCompany: ["KNU Construction"], currency: ["USD"],
    baseBid: ["$150,000.00"], gcCompany: ["Alpha Builders", 0.6], subDeadline: ["2026-11-20T14:00:00-05:00"], projectType: ["Hotel"],
  };
  const merged = { ...base, ...(over.values ?? {}) };
  const values = Object.fromEntries(VALUE_KEYS.map((k) => [k, merged[k]?.[0] ?? ""])) as Extraction["values"];
  const evidence = Object.entries(merged).filter(([, v]) => v && v[0]).map(([k, v]) => ({ field: k, source: v![2] ?? "p.1", confidence: v![1] ?? 0.95 }));
  return {
    documentKind: "proposal",
    summary: "Drywall and plumbing proposal for Towne Place Suites",
    values,
    evidence,
    gcContacts: [{ name: "Pat Est", email: "pat@alpha.example", phone: "", title: "Estimator" }, { name: "", email: "", phone: "", title: "" }],
    lines: over.lines ?? [
      { trade: "Metal studs and gypsum board", description: "Framing and drywall", kind: "BASE", amount: 100000, source: "p.2", confidence: 0.9 },
      { trade: "Plumbing", description: "", kind: "BASE", amount: 50000, source: "p.2", confidence: 0.9 },
      { trade: "Drywall", description: "Level 5 finish in lobby", kind: "ALTERNATE", amount: 8000, source: "p.3", confidence: 0.8 },
    ],
    bundleOnly: over.bundleOnly ?? false,
    inclusions: ["Taping", "Firestopping"],
    exclusions: ["Permits"],
    clarifications: [],
    conflicts: [],
  };
}

describe("tradeFor", () => {
  it("maps written trades through their usual words", () => {
    expect(tradeFor("Metal studs and gypsum board", TRADES)).toBe("dry");
    expect(tradeFor("PLUMBING", TRADES)).toBe("plb");
    expect(tradeFor("Re-roof", TRADES)).toBe("roof");
  });
  it("leaves an unknown or ambiguous trade for a person", () => {
    expect(tradeFor("Painting", TRADES)).toBeNull();
    expect(tradeFor("Drywall and plumbing", TRADES)).toBeNull();
  });
});

describe("draftFromExtraction", () => {
  it("marks low-confidence and missing values, and maps lines to trades", () => {
    const d = draftFromExtraction(extraction(), TRADES);
    expect(d.fields.baseBid.value).toBe("150000");
    expect(d.fields.baseBid.source).toBe("p.1");
    expect(d.fields.projectName.state).toBe("ok");
    expect(d.fields.gcCompany.state).toBe("uncertain");
    expect(d.fields.county.state).toBe("missing");
    expect(d.lines.map((l) => l.serviceCategoryId)).toEqual(["dry", "plb", "dry"]);
    expect(d.gcContacts).toHaveLength(1);
    expect(d.alternates).toContain("Level 5");
  });
  it("turns a validity period into an expiry date, flagged for checking", () => {
    const d = draftFromExtraction(extraction(), TRADES);
    expect(d.fields.validUntil.value).toBe("2026-12-10");
    expect(d.fields.validUntil.state).toBe("uncertain");
  });
  it("keeps a total that the lines do not add up to as a conflict, never picks one", () => {
    const d = draftFromExtraction(extraction({ values: { baseBid: ["145000"] } }), TRADES);
    expect(d.fields.baseBid.value).toBe("145000");
    expect(d.conflicts.find((c) => c.field === "baseBid")?.values.map((v) => v.value)).toEqual(["145000", "150000"]);
  });
  it("a negative line for the bundle is the bundle discount, not a line", () => {
    const d = draftFromExtraction(extraction({ values: { baseBid: ["135000"] }, lines: [
      { trade: "Drywall", description: "", kind: "BASE", amount: 100000, source: "p.1", confidence: 0.9 },
      { trade: "Plumbing", description: "", kind: "BASE", amount: 50000, source: "p.1", confidence: 0.9 },
      { trade: "Drywall, Plumbing", description: "Bundle discount", kind: "BASE", amount: -15000, source: "p.1", confidence: 0.9 },
    ] }), TRADES);
    expect(d.lines).toHaveLength(2);
    expect(d.conflicts).toHaveLength(0); // 150,000 − 15,000 = the printed 135,000
  });
  it("a bundle-only document with one total is not a conflict", () => {
    const d = draftFromExtraction(extraction({ bundleOnly: true, values: { baseBid: ["140000"] }, lines: [{ trade: "Drywall and plumbing", description: "", kind: "BASE", amount: 140000, source: "p.1", confidence: 0.9 }] }), TRADES);
    expect(d.conflicts).toHaveLength(0);
    expect(d.lines[0]!.serviceCategoryId).toBeNull();
  });
});

describe("confirmProblems", () => {
  const ok = { total: 150000, bundleAdjustment: 0, projectName: "X project", creatingProject: true, gcs: [], lines: [{ serviceCategoryId: "dry", kind: "BASE" as const, description: null, amount: 100000 }, { serviceCategoryId: "plb", kind: "BASE" as const, description: null, amount: 50000 }] };
  it("passes a complete review", () => {
    expect(confirmProblems(ok)).toEqual([]);
  });
  it("names what is missing", () => {
    expect(confirmProblems({ ...ok, total: 0, projectName: "", lines: [] })).toEqual(["Name the project", "Enter the total base bid", "Add at least one base line (a trade and its price)"]);
    expect(confirmProblems({ ...ok, total: 140000 })).toContain("The base lines and the bundle adjustment do not add up to the total");
    expect(confirmProblems({ ...ok, total: 140000, bundleAdjustment: -10000 })).toEqual([]);
    expect(confirmProblems({ ...ok, gcs: [{ organizationId: null, bidDueAt: null }] })).toEqual(["Pick the GC for every GC row, or remove the row"]);
  });
  it("allows one unsplit bundle line only", () => {
    const two = { ...ok, lines: ok.lines.map((l) => ({ ...l, serviceCategoryId: null })) };
    expect(confirmProblems(two)).toContain("Only one base line can be an unsplit bundle; pick a trade for the others");
  });
  it("an existing project needs no name", () => {
    expect(confirmProblems({ ...ok, projectName: null, creatingProject: false })).toEqual([]);
  });
});

describe("amountForScopes", () => {
  const v = { bundleAdjustment: -10000, lines: [{ scopeId: "s-dry", kind: "BASE", amount: 100000 }, { scopeId: "s-plb", kind: "BASE", amount: 50000 }, { scopeId: "s-dry", kind: "ALTERNATE", amount: 8000 }] };
  it("a GC bidding both scopes gets the bundle price", () => {
    expect(amountForScopes(v, ["s-dry", "s-plb"])).toBe(140000);
  });
  it("a GC bidding one scope gets that scope's price, never the bundle discount", () => {
    expect(amountForScopes(v, ["s-dry"])).toBe(100000);
  });
  it("alternates are never in the base amount", () => {
    expect(amountForScopes({ bundleAdjustment: 0, lines: v.lines }, ["s-dry"])).toBe(100000);
  });
  it("an unsplit bundle line goes to whoever bids from it", () => {
    expect(amountForScopes({ bundleAdjustment: 0, lines: [{ scopeId: null, kind: "BASE", amount: 120000 }] }, ["s-dry"])).toBe(120000);
  });
  it("quotes per scope, null when priced only inside a bundle", () => {
    const q = quotedByScope({ lines: [{ scopeId: "s-dry", kind: "BASE", amount: 100000 }, { scopeId: null, kind: "BASE", amount: 5 }] }, ["s-dry", "s-plb"]);
    expect([...q.entries()]).toEqual([["s-dry", 100000], ["s-plb", null]]);
  });
});

describe("misc", () => {
  it("baseTotal and the empty draft", () => {
    expect(baseTotal([{ kind: "BASE", amount: 10.005 }, { kind: "UNIT", amount: 3 }], -0.005)).toBe(10);
    expect(emptyDraft().fields.projectName.state).toBe("missing");
  });
  it("a stuck reading restarts; a third failure does not", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    expect(isStaleExtraction({ status: "EXTRACTING", extractStartedAt: new Date("2026-11-18T11:50:00Z"), extractAttempts: 1 }, now)).toBe(true);
    expect(isStaleExtraction({ status: "EXTRACTING", extractStartedAt: new Date("2026-11-18T11:58:00Z"), extractAttempts: 1 }, now)).toBe(false);
    expect(isStaleExtraction({ status: "EXTRACTING", extractStartedAt: null, extractAttempts: 3 }, now)).toBe(false);
  });
});
