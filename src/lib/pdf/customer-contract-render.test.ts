import { describe, expect, it } from "vitest";
import { renderCustomerContractPdf } from "./customer-contract";
import type { CustomerContractSnapshot } from "@/lib/customer-contracts/types";
import { RESIDENTIAL_CONSTRUCTION_V1 } from "../../../prisma/seeds/contract-templates/residential-construction";

// 1×1 transparent PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function snap(signed: boolean): CustomerContractSnapshot {
  const base: CustomerContractSnapshot = {
    kind: "CUSTOMER_CONTRACT",
    generatedAt: "2026-09-25T15:00:00.000Z",
    versionNumber: 2,
    contractNumber: "JOB-00001-C1",
    company: { name: "Knu Construction", address: "2500 N. Federal Highway, Fort Lauderdale, FL 33305", phone: "561-910-0142", email: "billing@knu.test", website: null, licenses: ["CGC2"], logoDataUri: null },
    owner: { name: "Jane Owner", companyName: null, phone: "555-1212", altPhone: null, email: "jane@example.com" },
    jobSite: { line1: "100 Main St", line2: null, city: "Fort Lauderdale", state: "FL", zip: "33305" },
    job: { jobNumber: "JOB-00001", title: "Drywall — Jane Owner", serviceType: "Drywall" },
    source: { type: "ESTIMATE", id: "e1", estimateNumber: "EST-1", name: "Drywall estimate" },
    scope: {
      sections: [
        { title: "Walls", items: [{ description: "Hang drywall", quantity: 100, unitType: "sq ft", notes: null, wasOptional: false }, { description: "Level 5 finish", quantity: 100, unitType: "sq ft", notes: "Upgrade", wasOptional: true }] },
      ],
      summaryLines: ["Estimated duration: 3 days"],
      exclusions: "Painting",
      notes: null,
      specialTerms: null,
    },
    price: { subtotal: 360, discountAmount: 0, salesTaxAmount: 0, total: 360 },
    paymentSchedule: [
      { key: "deposit", label: "Deposit", percent: 40, trigger: "Due upon signing", amount: 144 },
      { key: "progress", label: "Progress", percent: 40, trigger: "At rough-in", amount: 144 },
      { key: "final", label: "Final", percent: 20, trigger: "On completion", amount: 72 },
    ],
    depositAmount: 144,
    validity: { validityDays: 30, offerExpiresAt: "2026-10-25T15:00:00.000Z" },
    template: { key: "residential_construction", version: 1, versionId: "v1", title: "Residential Construction Agreement", articles: RESIDENTIAL_CONSTRUCTION_V1.articles, paymentScheduleText: "Owner agrees to pay $360.00 as follows:", consentText: RESIDENTIAL_CONSTRUCTION_V1.consentText },
  };
  if (!signed) return base;
  return {
    ...base,
    signature: {
      signerName: "Jane Owner",
      signerEmail: "jane@example.com",
      signedAt: "2026-09-26T14:03:11.000Z",
      consentAt: "2026-09-26T14:03:05.000Z",
      consentText: RESIDENTIAL_CONSTRUCTION_V1.consentText,
      ip: "203.0.113.5",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari/605.1",
      signatureDataUri: PNG,
      unsignedPdfSha256: "a".repeat(64),
      tokenSha256: "b".repeat(64),
      contractId: "cm_contract_1",
      sentAt: "2026-09-25T16:00:00.000Z",
      sentToEmail: "jane@example.com",
    },
  };
}

describe("renderCustomerContractPdf", () => {
  it("renders the unsigned agreement", async () => {
    const buf = await renderCustomerContractPdf(snap(false));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(8_000);
  });

  it("renders the signed agreement with its certificate page (larger, has the image)", async () => {
    const unsigned = await renderCustomerContractPdf(snap(false));
    const signed = await renderCustomerContractPdf(snap(true));
    expect(signed.subarray(0, 5).toString()).toBe("%PDF-");
    expect(signed.length).toBeGreaterThan(unsigned.length);
  });
});
