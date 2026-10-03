import { describe, expect, it } from "vitest";
import { deriveCompliance, docInForce, needsAttention, type ComplianceDoc } from "./compliance";
import { alertsForVendor, liveVendorAlertKeys } from "./alerts";

const TODAY = "2026-10-05";
const pin = (day: string) => new Date(`${day}T12:00:00.000Z`);
let n = 0;
function doc(type: ComplianceDoc["type"], expires: string | null, filed = "2026-01-01", id = `d${++n}`): ComplianceDoc {
  return { id, type, expiresAt: expires ? pin(expires) : null, createdAt: pin(filed) };
}
const status = (c: ReturnType<typeof deriveCompliance>) => Object.fromEntries(c.requirements.map((r) => [r.key, r.status]));

describe("deriveCompliance", () => {
  it("a subcontractor with nothing on file is missing all three, and the license is simply not recorded", () => {
    const c = deriveCompliance("SUBCONTRACTOR", [], TODAY);
    expect(status(c)).toEqual({ liability: "missing", workers_comp: "missing", w9: "missing", license: "not_recorded" });
    expect(c.verdict).toBe("missing");
    expect(c.gaps).toEqual(["General liability missing", "Workers' comp missing", "W-9 missing"]);
  });

  it("is compliant with a certificate, an exemption and a W-9; a W-9 never expires", () => {
    const c = deriveCompliance("SUBCONTRACTOR", [doc("GL_INSURANCE", "2027-03-01"), doc("WC_EXEMPTION", "2027-06-01"), doc("W9", "2020-01-01")], TODAY);
    expect(c.verdict).toBe("ok");
    expect(c.gaps).toEqual([]);
    expect(status(c).w9).toBe("ok");
  });

  it("flags a certificate inside 30 days as expiring and one past its day as expired", () => {
    const base = [doc("WORKERS_COMP", "2027-01-01"), doc("W9", null)];
    const soon = deriveCompliance("SUBCONTRACTOR", [...base, doc("GL_INSURANCE", "2026-11-04")], TODAY);
    expect(soon.verdict).toBe("expiring");
    expect(soon.requirements[0]).toMatchObject({ status: "expiring", daysLeft: 30, expiresDay: "2026-11-04" });
    expect(deriveCompliance("SUBCONTRACTOR", [...base, doc("GL_INSURANCE", "2026-11-05")], TODAY).verdict).toBe("ok");
    const today = deriveCompliance("SUBCONTRACTOR", [...base, doc("GL_INSURANCE", TODAY)], TODAY);
    expect(today.requirements[0].status).toBe("expiring");
    const lapsed = deriveCompliance("SUBCONTRACTOR", [...base, doc("GL_INSURANCE", "2026-10-04")], TODAY);
    expect(lapsed.verdict).toBe("expired");
    expect(lapsed.gaps).toEqual(["General liability expired Oct 4, 2026"]);
  });

  it("the most recently filed document of a requirement is the one in force", () => {
    const old = doc("GL_INSURANCE", "2026-09-01", "2025-09-01", "old");
    const renewed = doc("GL_INSURANCE", "2027-09-01", "2026-09-02", "new");
    expect(docInForce("liability", [old, renewed])?.id).toBe("new");
    const c = deriveCompliance("SUBCONTRACTOR", [old, renewed, doc("WORKERS_COMP", "2027-01-01"), doc("W9", null)], TODAY);
    expect(c.verdict).toBe("ok");
    // An exemption filed after a certificate replaces it.
    expect(docInForce("workers_comp", [doc("WORKERS_COMP", "2026-01-01", "2025-01-01", "cert"), doc("WC_EXEMPTION", "2028-01-01", "2026-02-01", "ex")])?.id).toBe("ex");
  });

  it("an expired license counts, a missing one does not", () => {
    const base = [doc("GL_INSURANCE", "2027-03-01"), doc("WORKERS_COMP", "2027-03-01"), doc("W9", null)];
    expect(deriveCompliance("SUBCONTRACTOR", base, TODAY).verdict).toBe("ok");
    expect(deriveCompliance("SUBCONTRACTOR", [...base, doc("LICENSE", "2026-08-31")], TODAY).verdict).toBe("expired");
  });

  it("worst wins: expired over missing over expiring", () => {
    const c = deriveCompliance("SUBCONTRACTOR", [doc("GL_INSURANCE", "2026-09-30"), doc("WORKERS_COMP", "2026-10-20")], TODAY);
    expect(c.verdict).toBe("expired");
    expect(c.gaps).toEqual(["General liability expired Sep 30, 2026", "W-9 missing", "Workers' comp expires Oct 20, 2026"]);
  });

  it("a supplier needs nothing, but a dated document it carries is still watched", () => {
    expect(deriveCompliance("SUPPLIER", [], TODAY).verdict).toBe("not_required");
    expect(needsAttention(deriveCompliance("SUPPLIER", [], TODAY).verdict)).toBe(false);
    expect(deriveCompliance("SUPPLIER", [doc("GL_INSURANCE", "2027-01-01")], TODAY).verdict).toBe("not_required");
    expect(deriveCompliance("OTHER", [doc("GL_INSURANCE", "2026-10-01")], TODAY).verdict).toBe("expired");
  });
});

describe("alertsForVendor", () => {
  const vendor = { id: "v1", name: "Rocket HVAC" };

  it("raises one HIGH task for a certificate expiring in 30 days, due 14 days before", () => {
    const gl = doc("GL_INSURANCE", "2026-11-04", "2026-01-01", "gl");
    const alerts = alertsForVendor(vendor, [gl, doc("W9", null)], TODAY);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "expiring", sourceKey: "vendor:v1:doc:gl:expiring@2026-11-04", priority: "HIGH", dueDay: "2026-10-21", docId: "gl" });
    expect(alerts[0].title).toBe("Rocket HVAC: general liability certificate expires Wed, Nov 4");
  });

  it("is due today when the 14-day mark has passed, and says nothing beyond 30 days", () => {
    expect(alertsForVendor(vendor, [doc("GL_INSURANCE", "2026-10-10")], TODAY)[0].dueDay).toBe(TODAY);
    expect(alertsForVendor(vendor, [doc("GL_INSURANCE", "2026-11-05")], TODAY)).toEqual([]);
  });

  it("raises an URGENT task once the document has lapsed", () => {
    const [a] = alertsForVendor(vendor, [doc("WORKERS_COMP", "2026-10-01", "2026-01-01", "wc")], TODAY);
    expect(a).toMatchObject({ kind: "expired", sourceKey: "vendor:v1:doc:wc:expired@2026-10-01", priority: "URGENT", dueDay: TODAY });
  });

  it("watches only the document in force, and never an undated one or a W-9", () => {
    const old = doc("GL_INSURANCE", "2026-10-10", "2025-10-10", "old");
    const renewed = doc("GL_INSURANCE", "2027-10-10", "2026-10-01", "new");
    expect(alertsForVendor(vendor, [old, renewed, doc("W9", "2026-10-06"), doc("LICENSE", null)], TODAY)).toEqual([]);
    expect([...liveVendorAlertKeys("v1", [old, renewed])]).toEqual(["vendor:v1:doc:new:expiring@2027-10-10", "vendor:v1:doc:new:expired@2027-10-10"]);
  });

  it("a corrected date is a new key, so the old alert is no longer live", () => {
    const before = liveVendorAlertKeys("v1", [doc("GL_INSURANCE", "2026-10-20", "2026-01-01", "gl")]);
    const after = liveVendorAlertKeys("v1", [doc("GL_INSURANCE", "2027-10-20", "2026-01-01", "gl")]);
    expect([...before].some((k) => after.has(k))).toBe(false);
  });
});
