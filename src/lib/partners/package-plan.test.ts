import { describe, expect, it } from "vitest";
import { contentsSheet, docLabel, entryName, planPackage, type PackageDoc, type PackageLine } from "./package-plan";

const today = "2026-10-13";
const doc = (over: Partial<PackageDoc> = {}): PackageDoc => ({ id: "d1", title: "GL COI", version: 1, fileName: "coi.pdf", confidentiality: "SHAREABLE", approvedForExternal: true, expiresAt: "2027-01-01T12:00:00.000Z", missing: false, ...over });
const line = (over: Partial<PackageLine> = {}): PackageLine => ({ requirementId: "r1", typeName: "General liability COI", required: true, status: "PENDING", attached: doc(), current: doc(), ...over });
const opts = { today, canReadRestricted: false, includeRestricted: false };

describe("planPackage", () => {
  it("includes an approved, in-date document", () => {
    const p = planPackage([line()], opts);
    expect(p.items[0]).toMatchObject({ included: true, reason: null, note: null });
    expect(p).toMatchObject({ included: 1, leftOut: 0, requiredMissing: 0 });
  });
  it("prefers the current version over an older attached one, and says so", () => {
    const p = planPackage([line({ attached: doc({ id: "old", version: 1 }), current: doc({ id: "new", version: 2 }) })], opts);
    expect(p.items[0].doc?.id).toBe("new");
    expect(p.items[0].note).toMatch(/v2 sent; v1 is attached/);
  });
  it("falls back to the attached version when the current one cannot go", () => {
    const p = planPackage([line({ attached: doc({ id: "old", version: 1 }), current: doc({ id: "new", version: 2, approvedForExternal: false }) })], opts);
    expect(p.items[0]).toMatchObject({ included: true, doc: { id: "old" } });
    expect(p.items[0].note).toMatch(/older v1 sent/);
  });
  it("uses the vault's current version for a line with nothing attached", () => {
    const p = planPackage([line({ attached: null })], opts);
    expect(p.items[0]).toMatchObject({ included: true, note: expect.stringMatching(/not attached/) });
  });
  it("leaves out what is expired, unapproved, missing or absent, with the reason", () => {
    const p = planPackage(
      [
        line({ requirementId: "a", attached: doc({ expiresAt: "2026-10-01T12:00:00.000Z" }), current: null }),
        line({ requirementId: "b", attached: doc({ approvedForExternal: false }), current: null }),
        line({ requirementId: "c", attached: doc({ missing: true }), current: null }),
        line({ requirementId: "d", attached: null, current: null }),
        line({ requirementId: "e", status: "WAIVED" }),
      ],
      opts,
    );
    expect(p.items.map((i) => i.reason)).toEqual(["expired 2026-10-01", expect.stringMatching(/not approved/), expect.stringMatching(/missing/), "nothing in the vault for it yet", "waived by the GC"]);
    expect(p).toMatchObject({ included: 0, requiredMissing: 4 });
  });
  it("sends a restricted document only to someone who may open it and asked for it", () => {
    const r = line({ attached: doc({ confidentiality: "RESTRICTED" }), current: null });
    expect(planPackage([r], opts)).toMatchObject({ included: 0, restrictedWithheld: 1 });
    expect(planPackage([r], { ...opts, canReadRestricted: true })).toMatchObject({ included: 0, restrictedWithheld: 1 });
    expect(planPackage([r], { ...opts, canReadRestricted: true, includeRestricted: true }).items[0]).toMatchObject({ included: true, restricted: true });
  });
  it("does not resend a version the GC rejected", () => {
    const p = planPackage([line({ status: "REJECTED", attached: doc({ id: "x" }), current: doc({ id: "x" }) })], opts);
    expect(p.items[0]).toMatchObject({ included: false, reason: expect.stringMatching(/rejected/) });
  });
});

describe("names and the contents sheet", () => {
  it("names a version once", () => {
    expect(docLabel("W-9 v3", 3)).toBe("W-9 v3");
    expect(docLabel("Signed W-9", 3)).toBe("Signed W-9 v3");
  });
  it("numbers and cleans entry names", () => {
    expect(entryName(3, "Workers' comp / COI", 'a:b"c.PDF')).toBe("03 - Workers' comp COI - a b c.PDF");
  });
  it("lists what is enclosed and what is to follow, never why", () => {
    const p = planPackage([line(), line({ requirementId: "x", typeName: "Bank letter", attached: doc({ confidentiality: "RESTRICTED" }), current: null })], opts);
    const s = contentsSheet(p, { companyName: "KNU Construction", organizationName: "Kaufman Lynn", platform: "TradeTapp", preparedBy: "Richard Carey", preparedOn: today });
    expect(s).toContain("01. General liability COI — GL COI v1 (valid to 2027-01-01)");
    expect(s).toContain("To follow:\r\n  - Bank letter");
    expect(s).not.toMatch(/restricted/i);
  });
});
