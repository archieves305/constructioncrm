import { describe, it, expect } from "vitest";
import { renderLaborContractPdf } from "./labor-contract";
import { renderContractAddendumPdf } from "./contract-addendum";
import {
  renderInteriorRenovationContractPdf,
  WEEKLY_PAYMENT_CLAUSE,
  DIRECT_PAYMENT_CLAUSE,
  VISUAL_INSPECTION_CLAUSE,
  WARRANTY_CLAUSE,
  retainageClause,
  RETAINAGE_RELEASE,
  INTERIOR_CONDITIONS,
} from "./interior-renovation-contract";
import type {
  LaborContractSnapshot,
  AddendumSnapshot,
  InteriorRenovationContractSnapshot,
  JobTypeKey,
} from "@/lib/contracts/types";

const company = {
  name: "Knu Construction",
  address: "2500 N. Federal Highway, Ft. Lauderdale, FL 33305",
  phone: "561-910-0142",
  email: "billing@knuconstruction.com",
};

const owner = {
  name: "Jane Owner",
  companyName: null,
  phone: "555-1212",
  altPhone: null,
  email: "jane@example.com",
};

const jobSite = {
  line1: "100 Main St",
  line2: null,
  city: "Fort Lauderdale",
  state: "FL",
  zip: "33305",
};

function laborSnap(jobType: JobTypeKey): LaborContractSnapshot {
  return {
    kind: "LABOR_CONTRACT",
    generatedAt: "2026-06-11T12:00:00.000Z",
    versionNumber: 1,
    company,
    job: {
      jobNumber: "J-1001",
      title: "Addition build",
      serviceType: "General Construction",
      jobType,
      jobTypeLabel: jobType,
    },
    owner,
    contractor: {
      name: "ABC Framing",
      phone: "555-9999",
      email: "abc@example.com",
      license: "CGC123456",
      insurance: "Acme Mutual GL #98765",
    },
    jobSite,
    terms: {
      contractAmount: 10000,
      scopeOfWork: "Frame and drywall the new addition per plans.",
      paymentTerms: "50% on start, balance on completion.",
      startDate: "2026-07-01T00:00:00.000Z",
      estimatedCompletionDate: "2026-08-15T00:00:00.000Z",
      exclusions: "Paint and flooring excluded.",
    },
  };
}

function addendumSnap(): AddendumSnapshot {
  return {
    kind: "CONTRACT_ADDENDUM",
    generatedAt: "2026-06-11T12:00:00.000Z",
    versionNumber: 1,
    company,
    job: {
      jobNumber: "J-1001",
      title: "Addition build",
      jobType: "FIXED_PRICE",
      jobTypeLabel: "Fixed Price",
    },
    owner,
    contractor: { name: "ABC Framing", phone: "555-9999", email: null },
    jobSite,
    originalContract: { contractAmount: 10000, scopeOfWork: "Frame and drywall." },
    originalContractVersion: 1,
    changeOrder: {
      changeNumber: 1,
      changeDate: "2026-06-10T00:00:00.000Z",
      description: "Added a bathroom rough-in.",
      scopeChange: "Add one bathroom rough-in.",
      priceAdjustment: 2500,
      timeAdjustmentDays: 3,
      updatedPaymentTerms: null,
    },
  };
}

function isPdf(buf: Buffer): boolean {
  return buf.length > 1000 && buf.subarray(0, 5).toString() === "%PDF-";
}

describe("contract PDF rendering", () => {
  it.each(["FIXED_PRICE", "OWNED_REHAB", "COST_PLUS"] as JobTypeKey[])(
    "renders a labor contract PDF for %s jobs",
    async (jobType) => {
      const buf = await renderLaborContractPdf(laborSnap(jobType));
      expect(isPdf(buf)).toBe(true);
    },
  );

  it("renders a change order addendum PDF", async () => {
    const buf = await renderContractAddendumPdf(addendumSnap());
    expect(isPdf(buf)).toBe(true);
  });
});

function interiorSnap(jobType: JobTypeKey): InteriorRenovationContractSnapshot {
  return {
    kind: "INTERIOR_RENOVATION_LABOR_CONTRACT",
    generatedAt: "2026-06-11T12:00:00.000Z",
    versionNumber: 1,
    company,
    job: {
      jobNumber: "J-2002",
      title: "Interior remodel",
      serviceType: "Interior Renovation",
      jobType,
      jobTypeLabel: jobType,
    },
    owner,
    contractor: {
      name: "ABC Interiors",
      phone: "555-9999",
      email: "abc@example.com",
      license: "CGC1500",
      insurance: "Acme GL",
    },
    jobSite,
    terms: {
      contractAmount: 25000,
      scopeOfWork: "Full interior remodel of kitchen and two bathrooms.",
      paymentTerms: null,
      startDate: "2026-07-01T00:00:00.000Z",
      estimatedCompletionDate: "2026-09-01T00:00:00.000Z",
      exclusions: "Appliances by Owner.",
      notes: "Owner on site weekdays.",
      retainagePercent: 10,
      delayDamagesPerDay: 250,
    },
    tasks: [
      {
        name: "Demolition",
        room: "Kitchen",
        description: "Remove cabinets and flooring",
        paymentAmount: 2000,
        paymentPercent: null,
        inspectionRequired: true,
        inspectionStatus: "PASSED",
        status: "COMPLETE",
        approvedBy: "PM",
        approvedDate: "2026-07-05T00:00:00.000Z",
        notes: null,
      },
      {
        name: "Tile installation",
        room: "Bathroom 1",
        description: null,
        paymentAmount: 3000,
        paymentPercent: null,
        inspectionRequired: true,
        inspectionStatus: "PENDING",
        status: "IN_PROGRESS",
        approvedBy: null,
        approvedDate: null,
        notes: null,
      },
    ],
  };
}

describe("interior renovation contract", () => {
  it.each(["FIXED_PRICE", "OWNED_REHAB", "COST_PLUS"] as JobTypeKey[])(
    "renders an interior renovation contract PDF (with task schedule) for %s jobs",
    async (jobType) => {
      const buf = await renderInteriorRenovationContractPdf(
        interiorSnap(jobType),
      );
      expect(isPdf(buf)).toBe(true);
    },
  );

  it("includes the required contractor-friendly / owner-protective language", () => {
    expect(WEEKLY_PAYMENT_CLAUSE).toContain("weekly progress payments");
    expect(WEEKLY_PAYMENT_CLAUSE).toContain("visually inspected");
    expect(DIRECT_PAYMENT_CLAUSE).toContain("pay laborers");
    expect(DIRECT_PAYMENT_CLAUSE).toContain("credited against sums");
    expect(VISUAL_INSPECTION_CLAUSE).toContain("visual inspection");
    expect(retainageClause(10)).toContain("retain 10%");
    expect(retainageClause(10)).toContain(
      "withheld from each weekly progress payment",
    );
    expect(WARRANTY_CLAUSE).toContain("two (2) years");
  });

  it("includes all retainage release conditions", () => {
    expect(RETAINAGE_RELEASE).toContain("Final lien waivers have been delivered");
    expect(RETAINAGE_RELEASE).toContain("All laborers have been paid");
    expect(RETAINAGE_RELEASE.length).toBeGreaterThanOrEqual(10);
  });

  it("includes interior-renovation-specific clauses", () => {
    const joined = INTERIOR_CONDITIONS.join(" ").toLowerCase();
    expect(joined).toContain("electrical");
    expect(joined).toContain("plumbing");
    expect(joined).toContain("structural");
    expect(joined).toContain("waterproofing");
    expect(joined).toContain("flooring");
  });
});
