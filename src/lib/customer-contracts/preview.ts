// A sample snapshot so the admin editor can preview a template version
// without a real job. Pure.

import type { EstimateBrand } from "@/lib/pdf/brand";
import { buildContractSnapshot } from "./snapshot";
import type { ContractTemplateContent, CustomerContractSnapshot } from "./types";

export function buildSampleSnapshot(
  template: { key: string; version: number; versionId: string; content: ContractTemplateContent },
  brand: EstimateBrand,
  now: Date = new Date(),
): CustomerContractSnapshot {
  return buildContractSnapshot({
    generatedAt: now,
    versionNumber: 1,
    contractNumber: "JOB-00000-C1",
    job: { jobNumber: "JOB-00000", title: "Sample project — Kitchen renovation", serviceType: "Interior Renovation" },
    lead: {
      fullName: "Sample Customer",
      companyName: null,
      primaryPhone: "(954) 555-0100",
      secondaryPhone: null,
      email: "customer@example.com",
      propertyAddress1: "123 Sample Street",
      propertyAddress2: null,
      city: "Fort Lauderdale",
      state: "FL",
      zipCode: "33301",
    },
    brand,
    source: {
      type: "ESTIMATE",
      includeOptionalItemIds: ["opt"],
      estimate: {
        id: "sample",
        estimateNumber: "EST-SAMPLE",
        name: "Sample estimate",
        validityDays: 30,
        notes: "Sample notes carried from the estimate.",
        exclusions: "Painting and fixtures supplied by owner.",
        marginPercent: 25,
        discountEnabled: false,
        discountPercent: 0,
        salesTaxPercent: 0,
        sections: [
          {
            title: "Demolition",
            items: [
              { id: "d1", description: "Remove existing cabinets and countertops", unitType: "LUMP_SUM", quantity: 1, unitPrice: 1200, isOptional: false, notes: null },
              { id: "d2", description: "Debris haul-away", unitType: "EACH", quantity: 2, unitPrice: 350, isOptional: false, notes: null },
            ],
          },
          {
            title: "Installation",
            items: [
              { id: "i1", description: "Install owner-supplied cabinets", unitType: "LINEAR_FT", quantity: 24, unitPrice: 85, isOptional: false, notes: null },
              { id: "opt", description: "Under-cabinet lighting", unitType: "LINEAR_FT", quantity: 24, unitPrice: 30, isOptional: true, notes: "Selected option" },
            ],
          },
        ],
      },
    },
    template,
  });
}
