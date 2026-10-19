import { describe, expect, it } from "vitest";
import { canManageApprovals } from "./access";
import { approvalPatchSchema, permitProductPatchSchema } from "./approval-validation";
import { ADVISORY, approvalAlert, approvalFromExtraction, checkProduct, normalizeNumber, readDay, readPressure, type CheckInput, type Extraction } from "./approvals-plan";
import * as extract from "./prompts/approval-extract";

const out = (o: Partial<Extraction> = {}): Extraction => ({
  isApproval: true,
  authority: "MIAMI_DADE_NOA",
  approvalNumber: "26-0504.06",
  revision: null,
  manufacturer: "Tag and Stick, LLC",
  productName: "Tag & Stick MTP",
  models: ["Tag & Stick MTP", "Tag & Stick MTP", "  "],
  category: "UNDERLAYMENT",
  hvhzApproved: true,
  nonHvhzApproved: null,
  designPressurePos: null,
  designPressureNeg: 90,
  impactRated: null,
  limitations: "Not an approved underlayment under tile.",
  configurations: [{ deck: "Plywood 19/32\"", slope: "2:12 min", underlayment: null, fastening: null, maxDesignPressure: "-90 psf" }],
  issuedAt: "2026-07-09",
  expiresAt: "2028-04-11",
  evidence: [
    { field: "expiresAt", page: 1, quote: "Expiration Date: 04/11/28" },
    { field: "approvalNumber", page: 1, quote: "NOA No.: 26-0504.06" },
    { field: "approvalNumber", page: 2, quote: "a second quote" },
    { field: "nonsense", page: 1, quote: "x" },
    { field: "hvhzApproved", page: 40, quote: "beyond the document" },
  ],
  ...o,
});

describe("reading an approval", () => {
  it("keeps what the document backs and nothing else", () => {
    const d = approvalFromExtraction(out(), 11);
    expect(d).toMatchObject({ approvalNumber: "26-0504.06", models: ["Tag & Stick MTP"], designPressureNeg: -90, designPressurePos: null, hvhzApproved: true });
    expect(d.expiresAt?.toISOString().slice(0, 10)).toBe("2028-04-11");
    expect(Object.keys(d.evidence).sort()).toEqual(["approvalNumber", "expiresAt"]);
    expect(d.evidence.approvalNumber.page).toBe(1);
  });
  it("an impossible date or an expiry before the issue is dropped", () => {
    expect(readDay("2028-02-30")).toBeNull();
    expect(readDay("1890-01-01")).toBeNull();
    expect(readDay("04/11/28")).toBeNull();
    expect(approvalFromExtraction(out({ issuedAt: "2026-07-09", expiresAt: "2025-01-01" }), null).expiresAt).toBeNull();
  });
  it("pressures: uplift always negative, absurd values dropped", () => {
    expect(readPressure(-55.5, -1)).toBe(-55.5);
    expect(readPressure(55.5, -1)).toBe(-55.5);
    expect(readPressure(-70, 1)).toBe(70);
    expect(readPressure(9000, 1)).toBeNull();
    expect(readPressure(0, 1)).toBeNull();
  });
  it("numbers compare however they were typed", () => {
    expect(normalizeNumber("fl 11842.3")).toBe(normalizeNumber("FL11842.3"));
    expect(normalizeNumber("NOA No. 26-0504.06")).toBe("NOANO.260504.06");
  });
  it("the PDF goes to the model as a document with the data-only rule", () => {
    const blocks = extract.content("JVBERi0=", "noa.pdf");
    expect(blocks[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
    expect((blocks[1] as { text: string }).text).toMatch(/third party/);
    expect(extract.SYSTEM).toMatch(/Never infer an expiration date/);
  });
});

const base: CheckInput = {
  approval: { readState: "VERIFIED", hvhzApproved: true, designPressurePos: 70, designPressureNeg: -90, expiresAt: new Date("2028-04-11T12:00:00Z"), isActive: true, authority: "MIAMI_DADE_NOA" },
  use: { requiredPressurePos: null, requiredPressureNeg: null },
  permit: { hvhz: true, expectedApprovalDate: null },
  inPackage: true,
  today: new Date("2026-10-18T15:00:00Z"),
};
const codes = (c: CheckInput) => checkProduct(c).map((f) => f.code);

describe("advisory checks on a permit", () => {
  it("a checked, current, adequate approval in the package raises nothing", () => {
    expect(checkProduct({ ...base, use: { requiredPressurePos: 45, requiredPressureNeg: -85 } })).toEqual([]);
  });
  it("expired, expiring, or lapsing before the permit is expected", () => {
    expect(codes({ ...base, approval: { ...base.approval, expiresAt: new Date("2026-10-01T12:00:00Z") } })).toContain("expired");
    expect(codes({ ...base, approval: { ...base.approval, expiresAt: new Date("2026-11-10T12:00:00Z") } })).toContain("expiring");
    expect(codes({ ...base, approval: { ...base.approval, expiresAt: new Date("2027-01-10T12:00:00Z") }, permit: { hvhz: true, expectedApprovalDate: new Date("2027-02-01T12:00:00Z") } })).toContain("expires-before-approval");
  });
  it("HVHZ needs an approval that says HVHZ", () => {
    expect(codes({ ...base, approval: { ...base.approval, hvhzApproved: null } })).toContain("hvhz");
    expect(checkProduct({ ...base, approval: { ...base.approval, hvhzApproved: false } }).find((f) => f.code === "hvhz")?.message).toMatch(/says it is not/);
    expect(codes({ ...base, permit: { hvhz: false, expectedApprovalDate: null }, approval: { ...base.approval, hvhzApproved: null } })).not.toContain("hvhz");
  });
  it("a required pressure beyond the approval's, by magnitude, whichever sign was typed", () => {
    expect(codes({ ...base, use: { requiredPressurePos: 75, requiredPressureNeg: null } })).toContain("pressure-pos");
    expect(codes({ ...base, use: { requiredPressurePos: null, requiredPressureNeg: -95 } })).toContain("pressure-neg");
    expect(codes({ ...base, use: { requiredPressurePos: null, requiredPressureNeg: 95 } })).toContain("pressure-neg");
    expect(codes({ ...base, approval: { ...base.approval, designPressurePos: null }, use: { requiredPressurePos: 40, requiredPressureNeg: null } })).toContain("pressure-unknown");
  });
  it("unchecked, set aside, not in the package, no expiry on an NOA", () => {
    const c = codes({ ...base, approval: { ...base.approval, readState: "REVIEW", isActive: false, expiresAt: null }, inPackage: false });
    expect(c).toEqual(expect.arrayContaining(["unverified", "inactive", "not-in-documents", "no-expiry"]));
  });
  it("every flag is advice", () => {
    expect(ADVISORY).toMatch(/not an engineering determination/);
  });
});

describe("expiry tasks", () => {
  const today = new Date("2026-10-18T15:00:00Z");
  it("raised 30 days ahead, due 14 days ahead, keyed by approval, permit and date", () => {
    expect(approvalAlert({ id: "a1", expiresAt: new Date("2026-12-01T12:00:00Z"), label: "x" }, "p1", today)).toBeNull();
    const p = approvalAlert({ id: "a1", expiresAt: new Date("2026-11-10T12:00:00Z"), label: "NOA 1" }, "p1", today)!;
    expect(p).toMatchObject({ sourceKey: "approval:a1:p1:expiring@2026-11-10", dueDay: "2026-10-27", priority: "HIGH" });
  });
  it("lapsed: urgent, due today", () => {
    expect(approvalAlert({ id: "a1", expiresAt: new Date("2026-10-01T12:00:00Z"), label: "NOA 1" }, "p1", today)).toMatchObject({ dueDay: "2026-10-18", priority: "URGENT" });
  });
  it("no expiry, no task", () => {
    expect(approvalAlert({ id: "a1", expiresAt: null, label: "FL" }, "p1", today)).toBeNull();
  });
});

describe("access and schemas", () => {
  it("the office roles keep the repository", () => {
    expect(canManageApprovals("OFFICE_STAFF")).toBe(true);
    expect(canManageApprovals("SALES_REP")).toBe(false);
  });
  it("PATCH schemas carry no defaults", () => {
    expect(approvalPatchSchema.parse({ notes: "x" })).toEqual({ notes: "x" });
    expect(permitProductPatchSchema.parse({ usedAs: "underlayment" })).toEqual({ usedAs: "underlayment" });
  });
});
