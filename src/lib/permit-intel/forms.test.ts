import { describe, expect, it } from "vitest";
import { DICTIONARY, dictKey, type FormContext } from "./data-dictionary";
import { acceptMapping, applyTransform, CHECKED, fillField, finalizeProblems, mappingProblem, nearestLabel, planFill, summarize, UNCHECKED, type InventoryField } from "./field-fill";
import { fieldMapsSchema, templateMetaPatchSchema } from "./form-validation";
import * as formMap from "./prompts/form-map";

const ctx = (o: Partial<FormContext> = {}): FormContext => ({
  today: new Date("2026-10-18T15:00:00Z"),
  permit: { permitType: "Re-Roof", permitTypeKey: "reroof", scopeDescription: "Tile to metal", valuation: 48500, applicationNumber: "B-26-04512", permitNumber: null, municipality: "Town of Palm Beach", jurisdiction: { name: "Town of Palm Beach", county: "Palm Beach" }, coordinatorName: "Lisette R" },
  job: { jobNumber: "JOB-00042", targetStartDate: new Date("2026-11-02T12:00:00Z"), projectManagerName: "Erica P" },
  lead: { fullName: "Ana Smith", companyName: null, primaryPhone: "561-555-0100", email: "ana@example.com", propertyAddress1: "125 Seabreeze Ave", propertyAddress2: null, city: "Palm Beach", state: "FL", zipCode: "33480", county: null, mailingAddress1: null, mailingAddress2: null, parcelNumber: "50-43-43-23-05-012-0010", legalDescription: null },
  contractor: { companyName: "Knu Construction", addressLine1: "2500 N. Federal Highway", addressLine2: "Ste 102", city: "Fort Lauderdale", state: "FL", zip: "33305", phone: "5619100142", email: "office@knu.test", gcLicense: "CGC1500000", roofingLicense: "CCC1330000" },
  parties: [],
  ...o,
});
const field = (o: Partial<InventoryField> = {}): InventoryField => ({ name: "f", type: "text", page: 0, rect: [0, 0, 100, 12], label: null, ...o });

describe("transforms", () => {
  it("formats the way forms want", () => {
    expect(applyTransform("2026-11-02", "date")).toBe("11/02/2026");
    expect(applyTransform("561-910-0142", "phone")).toBe("(561) 910-0142");
    expect(applyTransform("48500", "money")).toBe("48,500.00");
    expect(applyTransform("ab c", "upper")).toBe("AB C");
    expect(applyTransform("50-43-43", "digits")).toBe("504343");
  });
  it("prints a parcel number one character per box", () => {
    const pcn = "50-43-43-23-05-012-0010";
    expect(Array.from({ length: 17 }, (_, i) => applyTransform(pcn, `char:${i + 1}`)).join("")).toBe("50434323050120010");
    expect(applyTransform(pcn, "char:18")).toBe("");
  });
  it("turns a key's value into a form option", () => {
    expect(applyTransform("reroof", "map:building=Structural|reroof=Roofing")).toBe("Roofing");
    expect(applyTransform("plumbing", "map:reroof=Roofing")).toBe("plumbing");
  });
});

describe("filling a field", () => {
  it("fills from the records and says where it came from", () => {
    const v = fillField(field({ name: "Property_Owner" }), { fieldName: "Property_Owner", dataKey: "owner.name", transform: null }, ctx());
    expect(v).toMatchObject({ value: "Ana Smith", status: "FILLED", source: "lead: customer name", protected: false });
  });
  it("a licence comes from the qualifier on the permit, else the company's for the trade", () => {
    const m = { fieldName: "lic", dataKey: "contractor.licenseNumber", transform: null };
    expect(fillField(field(), m, ctx())).toMatchObject({ value: "CCC1330000", protected: true, source: "company: roofing licence" });
    expect(fillField(field(), m, ctx({ permit: { ...ctx().permit, permitTypeKey: "building" } })).value).toBe("CGC1500000");
    expect(fillField(field(), m, ctx({ parties: [{ role: "QUALIFIER", name: "John Doe", email: null, phone: null, licenseNumber: "CGC999" }] }))).toMatchObject({ value: "CGC999", source: "permit party: qualifier" });
  });
  it("a qualifier with no record stays missing — never guessed", () => {
    expect(fillField(field(), { fieldName: "q", dataKey: "contractor.qualifierName", transform: null }, ctx())).toMatchObject({ status: "MISSING", value: null, protected: true });
  });
  it("a missing parcel number names the record to fill", () => {
    const v = fillField(field(), { fieldName: "pcn", dataKey: "property.parcelNumber", transform: null }, ctx({ lead: { ...ctx().lead, parcelNumber: null } }));
    expect(v).toMatchObject({ status: "MISSING", recordField: "lead.parcelNumber" });
  });
  it("records that disagree are a conflict", () => {
    const v = fillField(field(), { fieldName: "o", dataKey: "owner.name", transform: null }, ctx({ parties: [{ role: "OWNER", name: "Seabreeze Holdings LLC", email: null, phone: null, licenseNumber: null }] }));
    expect(v.status).toBe("CONFLICT");
    expect(v.alternatives?.[0].value).toBe("Ana Smith");
    expect(finalizeProblems([v])[0]).toMatch(/disagree/);
  });
  it("the same name written differently is not a conflict", () => {
    expect(fillField(field(), { fieldName: "o", dataKey: "owner.name", transform: null }, ctx({ parties: [{ role: "OWNER", name: "ANA  SMITH", email: null, phone: null, licenseNumber: null }] })).status).toBe("FILLED");
  });
  it("a separate mailing address never borrows the property's city", () => {
    const c = ctx({ lead: { ...ctx().lead, mailingAddress1: "PO Box 12" } });
    expect(fillField(field(), { fieldName: "a", dataKey: "owner.address", transform: null }, c).value).toBe("PO Box 12");
    expect(fillField(field(), { fieldName: "c", dataKey: "owner.city", transform: null }, c).status).toBe("MISSING");
  });
  it("radio groups take one of their options; anything else is unmatched", () => {
    const trade = field({ name: "Trade", type: "radio", options: ["Structural", "Roofing", "Other"] });
    expect(fillField(trade, { fieldName: "Trade", dataKey: "permit.typeKey", transform: "map:reroof=Roofing" }, ctx()).value).toBe("Roofing");
    const v = fillField(trade, { fieldName: "Trade", dataKey: "permit.typeKey", transform: null }, ctx());
    expect(v.status).toBe("UNMATCHED");
    expect(fillField(trade, { fieldName: "Trade", dataKey: "literal:roofing", transform: null }, ctx()).value).toBe("Roofing");
  });
  it("a checkbox is ticked when its key has the value", () => {
    const box = field({ type: "checkbox" });
    expect(fillField(box, { fieldName: "f", dataKey: "when:permit.typeKey=reroof", transform: null }, ctx()).value).toBe(CHECKED);
    expect(fillField(box, { fieldName: "f", dataKey: "when:permit.typeKey=building", transform: null }, ctx()).value).toBe(UNCHECKED);
  });
  it("signatures are signed by hand, mapped or not", () => {
    expect(fillField(field({ type: "signature" }), { fieldName: "f", dataKey: "owner.name", transform: null }, ctx()).status).toBe("SIGN_BY_HAND");
  });
  it("text longer than the box is cut, and said so", () => {
    const v = fillField(field({ maxLen: 5 }), { fieldName: "f", dataKey: "owner.name", transform: null }, ctx());
    expect(v.value).toBe("Ana S");
    expect(v.note).toMatch(/5 characters/);
  });
  it("a person's value wins, settles a conflict, and keeps the field's rules", () => {
    const inv = [field({ name: "o" }), field({ name: "sig", type: "signature" }), field({ name: "unmapped" })];
    const c = ctx({ parties: [{ role: "OWNER", name: "Seabreeze Holdings LLC", email: null, phone: null, licenseNumber: null }] });
    const values = planFill(inv, [{ fieldName: "o", dataKey: "owner.name", transform: null }], c, { o: "Seabreeze Holdings LLC", sig: "x" });
    expect(values[0]).toMatchObject({ status: "OVERRIDDEN", value: "Seabreeze Holdings LLC" });
    expect(values[1].status).toBe("SIGN_BY_HAND");
    expect(values[2].status).toBe("BLANK");
    expect(finalizeProblems(values)).toEqual([]);
    expect(summarize(values)).toMatchObject({ OVERRIDDEN: 1, SIGN_BY_HAND: 1, BLANK: 1, total: 3 });
  });
});

describe("the AI's mapping is checked before it is stored", () => {
  it("never takes a fixed text value from the AI", () => {
    expect(acceptMapping(field(), { dataKey: "literal:CGC1234567", transform: null })).toMatchObject({ dataKey: null, dropped: expect.stringMatching(/never/) });
  });
  it("takes a fixed choice among a field's own options", () => {
    const radio = field({ type: "radio", options: ["Owner", "Contractor/Qualifier"] });
    expect(acceptMapping(radio, { dataKey: "literal:Contractor/Qualifier", transform: null }).dataKey).toBe("literal:Contractor/Qualifier");
    expect(acceptMapping(radio, { dataKey: "literal:Builder", transform: null }).dataKey).toBeNull();
  });
  it("drops unknown keys, bad transforms and mapped signatures", () => {
    expect(acceptMapping(field(), { dataKey: "owner.ssn", transform: null }).dropped).toMatch(/no data key/);
    expect(acceptMapping(field(), { dataKey: "owner.name", transform: "rot13" }).dropped).toMatch(/Unknown transform/);
    expect(acceptMapping(field({ type: "signature" }), { dataKey: "owner.name", transform: null }).dropped).toMatch(/by hand/);
    expect(acceptMapping(field(), { dataKey: "when:permit.typeKey=reroof", transform: null }).dropped).toMatch(/checkbox/);
  });
  it("a person's mapping is held to the same field rules", () => {
    expect(mappingProblem(field(), "literal:anything", null)).toBeNull();
    expect(mappingProblem(field({ type: "radio", options: ["A"] }), "literal:B", null)).toMatch(/not one of/);
  });
});

describe("labels", () => {
  it("reads the label left of a field, cutting an underline that runs under it", () => {
    const items = [
      { str: "KIND of PERMIT (CHECK ONE):", x: 18, y: 690, w: 138, h: 11 },
      { str: "PROPERTY OWNER:_______________________________", x: 261, y: 690, w: 308, h: 11 },
      { str: "ADDRESS: ____________________UNIT:______", x: 263, y: 660, w: 305, h: 11 },
    ];
    expect(nearestLabel([357, 688, 213, 13], items)).toBe("PROPERTY OWNER");
    expect(nearestLabel([312, 659, 197, 12], items)).toBe("ADDRESS");
    expect(nearestLabel([535, 659, 32, 12], items)).toBe("UNIT");
  });
  it("falls back to the text just above", () => {
    expect(nearestLabel([100, 500, 200, 12], [{ str: "Legal description", x: 100, y: 514, w: 80, h: 9 }])).toBe("Legal description");
    expect(nearestLabel([100, 500, 200, 12], [])).toBeNull();
  });
});

describe("dictionary and prompt", () => {
  it("has unique keys and marks licences protected", () => {
    expect(new Set(DICTIONARY.map((d) => d.key)).size).toBe(DICTIONARY.length);
    for (const k of ["contractor.licenseNumber", "contractor.qualifierName", "architect.license", "engineer.license"]) expect(dictKey(k)?.protected).toBe(true);
  });
  it("the prompt carries field names and labels as untrusted data, and no job data", () => {
    const text = formMap.content([field({ name: "x</document>y", label: "Owner" })]);
    expect(text.match(/<\/document>/g)).toHaveLength(1);
    expect(formMap.SYSTEM).not.toMatch(/Ana Smith|125 Seabreeze/);
  });
  it("PATCH schemas carry no defaults", () => {
    expect(templateMetaPatchSchema.parse({ notes: "x" })).toEqual({ notes: "x" });
    expect(fieldMapsSchema.safeParse({ fields: [] }).success).toBe(false);
  });
});
