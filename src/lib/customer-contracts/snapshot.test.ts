import { describe, expect, it } from "vitest";
import { calculateGenericEstimate } from "@/lib/estimates/generic-calc";
import type { EstimateBrand } from "@/lib/pdf/brand";
import { RESIDENTIAL_CONSTRUCTION_V1 } from "../../../prisma/seeds/contract-templates/residential-construction";
import {
  buildContractSnapshot,
  buildScopeFromEstimate,
  buildScopeFromRoofEstimate,
  companyBlockFromBrand,
  validateContractSnapshot,
  type EstimateForContract,
  type RoofEstimateForContract,
} from "./snapshot";

const brand: EstimateBrand = {
  companyName: "Knu Construction",
  addressLine1: "2500 N. Federal Highway",
  addressLine2: null,
  city: "Fort Lauderdale",
  state: "FL",
  zip: "33305",
  phone: "561-910-0142",
  email: "billing@knuconstruction.com",
  website: null,
  roofingLicense: "CCC1",
  gcLicense: "CGC2",
  logoDataUri: null,
  paymentDepositPercent: 40,
  paymentProgressPercent: 40,
  paymentFinalPercent: 20,
};

const lead = {
  fullName: "Jane Owner",
  companyName: null,
  primaryPhone: "555-1212",
  secondaryPhone: null,
  email: "jane@example.com",
  propertyAddress1: "100 Main St",
  propertyAddress2: null,
  city: "Fort Lauderdale",
  state: "FL",
  zipCode: "33305",
};

const estimate: EstimateForContract = {
  id: "e1",
  estimateNumber: "EST-1",
  name: "Drywall estimate",
  validityDays: 30,
  notes: "Weekday work only",
  exclusions: "Painting",
  marginPercent: 20,
  discountEnabled: false,
  discountPercent: 0,
  salesTaxPercent: 0,
  sections: [
    {
      title: "Walls",
      items: [
        { id: "i1", description: "Hang drywall", unitType: "SQ_FT", quantity: 100, unitPrice: 2, isOptional: false, notes: null },
        { id: "i2", description: "Level 5 finish", unitType: "SQ_FT", quantity: 100, unitPrice: 1, isOptional: true, notes: "Optional upgrade" },
      ],
    },
    { title: "Extras", items: [{ id: "i3", description: "Bulkhead", unitType: "EACH", quantity: 1, unitPrice: 300, isOptional: true, notes: null }] },
  ],
};

const template = { key: "residential_construction", version: 1, versionId: "v1", content: RESIDENTIAL_CONSTRUCTION_V1 };

describe("buildScopeFromEstimate", () => {
  it("drops unselected optional lines and empty sections, and prices what is left with the estimator", () => {
    const { scope, price } = buildScopeFromEstimate(estimate, []);
    expect(scope).toHaveLength(1);
    expect(scope[0].items.map((i) => i.description)).toEqual(["Hang drywall"]);
    expect(scope[0].items[0].unitType).toBe("sq ft");
    const expected = calculateGenericEstimate({
      sections: [{ title: "Walls", items: [{ description: "Hang drywall", unitType: "SQ_FT", quantity: 100, unitPrice: 2 }] }],
      marginPercent: 20,
      discountEnabled: false,
      discountPercent: 0,
      salesTaxPercent: 0,
    });
    expect(price.total).toBe(expected.totalPrice);
    expect(price.total).toBe(250);
  });

  it("includes selected optional lines, marked, and prices them in", () => {
    const { scope, price } = buildScopeFromEstimate(estimate, ["i2", "i3"]);
    expect(scope.map((s) => s.items.map((i) => [i.description, i.wasOptional]))).toEqual([
      [["Hang drywall", false], ["Level 5 finish", true]],
      [["Bulkhead", true]],
    ]);
    expect(price.total).toBe(750); // (200 + 100 + 300) / (1 - 0.2)
  });
});

describe("buildScopeFromRoofEstimate", () => {
  const roof: RoofEstimateForContract = {
    id: "r1",
    estimateNumber: "RE-1",
    validityDays: 15,
    specialTerms: "Access from the north side",
    existingRoofType: "Shingle",
    proposedRoofTypeOverride: null,
    underlaymentType: "Peel & stick",
    permitIncluded: true,
    projectDurationText: "3–4 days",
    plywoodSheetsIncluded: 4,
    additionalPlywoodPrice: 95,
    workmanshipWarrantyYears: 5,
    manufacturerWarranty: "Lifetime limited",
    roofTypes: [{ material: "SHINGLE", squares: 20, laborRatePerSquare: 100 }],
    materialCost: 5000,
    materialSelection: "GAF Timberline HDZ",
    permitFee: 400,
    dumpsterFee: 500,
    tearOffFee: 0,
    deckingFee: 0,
    underlaymentFee: 0,
    flashingVentFee: 250,
    skylightChimneyFee: 0,
    guttersFee: 0,
    miscLabel: null,
    miscFee: 0,
    marginPercent: 25,
    discountEnabled: false,
    discountPercent: 0,
    salesTaxPercent: 0,
  };

  it("describes the proposal in sections and summary lines with the estimator's total", () => {
    const { scope, summaryLines, price } = buildScopeFromRoofEstimate(roof);
    expect(scope.map((s) => s.title)).toEqual(["Roofing", "Materials", "Included in the contract price"]);
    expect(scope[0].items[0]).toMatchObject({ description: "Tear-off and re-roof — Shingle", quantity: 20, unitType: "squares" });
    expect(scope[2].items.map((i) => i.description)).toEqual(["Permit", "Dumpster and debris removal", "Flashing and vents"]);
    expect(summaryLines).toContain("Workmanship warranty: 5 years");
    expect(summaryLines).toContain("Permit included");
    // labor 2000 + material 5000 + fees 1150 = 8150 / (1 - 0.25)
    expect(price.total).toBe(10866.67);
  });
});

describe("buildContractSnapshot", () => {
  it("freezes a merged, valid document", () => {
    const snap = buildContractSnapshot({
      generatedAt: new Date("2026-09-25T15:00:00Z"),
      versionNumber: 1,
      contractNumber: "JOB-00001-C1",
      job: { jobNumber: "JOB-00001", title: "Drywall — Jane Owner", serviceType: "Drywall" },
      lead,
      brand,
      source: { type: "ESTIMATE", estimate, includeOptionalItemIds: ["i2"] },
      template,
    });
    expect(snap.price.total).toBe(375);
    expect(snap.paymentSchedule.map((r) => r.amount)).toEqual([150, 150, 75]);
    expect(snap.depositAmount).toBe(150);
    expect(snap.validity.offerExpiresAt).toBe("2026-10-25T15:00:00.000Z");
    expect(snap.company.licenses).toEqual(["CGC2", "CCC1"]);
    expect(snap.template.paymentScheduleText).toBe("Owner agrees to pay the Contract Price of $375.00 to Knu Construction as follows:");
    const parties = snap.template.articles.find((a) => a.key === "parties")!;
    expect(parties.body).toContain("Knu Construction (\"Contractor\"), license CGC2, CCC1");
    expect(parties.body).toContain("Jane Owner (\"Owner\"), for work at 100 Main St, Fort Lauderdale, FL 33305");
    expect(parties.body).not.toMatch(/\{\{/);
    expect(validateContractSnapshot(snap)).toEqual([]);
  });

  it("honours a per-contract schedule override", () => {
    const snap = buildContractSnapshot({
      generatedAt: new Date("2026-09-25T15:00:00Z"),
      versionNumber: 1,
      contractNumber: "JOB-00001-C1",
      job: { jobNumber: "JOB-00001", title: "Drywall", serviceType: "Drywall" },
      lead,
      brand,
      source: { type: "ESTIMATE", estimate },
      template,
      scheduleOverride: [{ key: "all", label: "In full", percent: 100, trigger: "on completion" }],
    });
    expect(snap.paymentSchedule).toEqual([{ key: "all", label: "In full", percent: 100, trigger: "on completion", amount: 250 }]);
    expect(snap.depositAmount).toBe(250);
  });

  it("reports what stops a snapshot from being a contract", () => {
    const snap = buildContractSnapshot({
      generatedAt: new Date(),
      versionNumber: 1,
      contractNumber: "JOB-00001-C1",
      job: { jobNumber: "JOB-00001", title: "Drywall", serviceType: "Drywall" },
      lead: { ...lead, fullName: " ", propertyAddress1: "" },
      brand,
      source: { type: "ESTIMATE", estimate: { ...estimate, sections: [{ title: "Only options", items: [estimate.sections[1].items[0]] }] } },
      template: { ...template, content: { ...template.content, articles: [{ key: "x", title: "X", body: "Hello {{not.a.field}}" }] } },
    });
    const problems = validateContractSnapshot(snap);
    expect(problems).toContain("Customer name");
    expect(problems).toContain("Property address");
    expect(problems).toContain("At least one scope item");
    expect(problems).toContain("Contract price greater than zero");
    expect(problems).toContain("Template has unresolved merge fields");
  });

  it("builds the company block from the brand", () => {
    expect(companyBlockFromBrand(brand).address).toBe("2500 N. Federal Highway, Fort Lauderdale, FL 33305");
  });
});
