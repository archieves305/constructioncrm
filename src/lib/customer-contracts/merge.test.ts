import { describe, expect, it } from "vitest";
import { buildMergeContext, isKnownMergeField, listMergeFields, renderMergeFields } from "./merge";
import type { CustomerContractSnapshot } from "./types";

const base: Omit<CustomerContractSnapshot, "template" | "signature"> = {
  kind: "CUSTOMER_CONTRACT",
  generatedAt: "2026-09-25T15:00:00.000Z",
  versionNumber: 1,
  contractNumber: "JOB-00012-C1",
  company: { name: "Knu Construction", address: "1 Main St, Fort Lauderdale, FL 33301", phone: "954-555-0100", email: "office@knu.test", website: null, licenses: ["CGC123", "CCC456"], logoDataUri: null },
  owner: { name: "Jane Doe", companyName: null, phone: "954-555-0199", email: "jane@example.com" },
  jobSite: { line1: "2500 N Federal Hwy", line2: null, city: "Fort Lauderdale", state: "FL", zip: "33305" },
  job: { jobNumber: "JOB-00012", title: "Roofing — Jane Doe", serviceType: "Roofing" },
  source: { type: "ESTIMATE", id: "e1", estimateNumber: "EST-1", name: "Drywall estimate" },
  scope: { sections: [], summaryLines: [], exclusions: null, notes: null, specialTerms: null },
  price: { subtotal: 20000, discountAmount: 0, salesTaxAmount: 0, total: 25000.5 },
  paymentSchedule: [
    { key: "deposit", label: "Deposit", percent: 40, trigger: "", amount: 10000.2 },
    { key: "final", label: "Final", percent: 60, trigger: "", amount: 15000.3 },
  ],
  depositAmount: 10000.2,
  validity: { validityDays: 30, offerExpiresAt: "2026-10-25T15:00:00.000Z" },
};

describe("merge fields", () => {
  it("lists distinct fields in a body", () => {
    expect(listMergeFields("Hi {{customer.name}}, {{ customer.name }} owes {{contract.total}}")).toEqual(["customer.name", "contract.total"]);
  });

  it("renders known fields and leaves unknown ones in place, reported", () => {
    const ctx = buildMergeContext(base);
    const r = renderMergeFields("{{customer.name}} pays {{contract.total}} ({{contract.depositPercent}} down: {{schedule.deposit.amount}}). {{nope.field}}", ctx);
    expect(r.text).toBe("Jane Doe pays $25,000.50 (40% down: $10,000.20). {{nope.field}}");
    expect(r.unknown).toEqual(["nope.field"]);
  });

  it("does not re-render field syntax that came from data", () => {
    const ctx = buildMergeContext({ ...base, owner: { ...base.owner, name: "{{company.name}}" } });
    expect(renderMergeFields("{{customer.name}}", ctx).text).toBe("{{company.name}}");
  });

  it("formats licenses, dates and addresses", () => {
    const ctx = buildMergeContext(base);
    expect(ctx["company.licenses"]).toBe("CGC123, CCC456");
    expect(ctx["job.address"]).toBe("2500 N Federal Hwy, Fort Lauderdale, FL 33305");
    expect(ctx["contract.offerExpiresAt"]).toBe("October 25, 2026");
    expect(ctx["contract.date"]).toBe("September 25, 2026");
  });

  it("knows the catalog and schedule-shaped keys", () => {
    expect(isKnownMergeField("customer.name")).toBe(true);
    expect(isKnownMergeField("schedule.deposit.amount", ["deposit", "final"])).toBe(true);
    expect(isKnownMergeField("schedule.retainage.amount", ["deposit", "final"])).toBe(false);
    expect(isKnownMergeField("schedule.deposit.label")).toBe(false);
    expect(isKnownMergeField("bogus")).toBe(false);
  });
});
