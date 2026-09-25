// Pure snapshot builders: estimate + job + lead + brand + template → the
// frozen document. No I/O, unit-testable. Totals are recomputed through the
// same calculators the estimators use, so the contract can never disagree
// with the estimate it came from.

import { calculateGenericEstimate, UNIT_LABELS } from "@/lib/estimates/generic-calc";
import { calculateEstimate, MATERIAL_LABELS, type EstimateInput, type RoofMaterialKey } from "@/lib/estimates/calc";
import type { EstimateUnitType } from "@/generated/prisma/enums";
import type { EstimateBrand } from "@/lib/pdf/brand";
import type { LeadLike } from "@/lib/contracts/generate";
import { buildMergeContext, renderMergeFields } from "./merge";
import { computePaymentSchedule, depositAmountOf, validatePaymentSchedule } from "./schedule";
import type {
  ContractCompanyBlock,
  ContractTemplateContent,
  CustomerContractSnapshot,
  PaymentScheduleItem,
  ScopeSection,
} from "./types";

export type EstimateForContract = {
  id: string;
  estimateNumber: string;
  name: string;
  validityDays: number;
  notes: string | null;
  exclusions: string | null;
  marginPercent: number;
  discountEnabled: boolean;
  discountPercent: number;
  salesTaxPercent: number;
  sections: {
    title: string;
    items: {
      id: string;
      description: string;
      unitType: EstimateUnitType;
      quantity: number;
      unitPrice: number;
      isOptional: boolean;
      notes: string | null;
    }[];
  }[];
};

export type RoofEstimateForContract = EstimateInput & {
  id: string;
  estimateNumber: string;
  validityDays: number;
  specialTerms: string | null;
  existingRoofType: string | null;
  proposedRoofTypeOverride: string | null;
  underlaymentType: string | null;
  permitIncluded: boolean;
  projectDurationText: string | null;
  plywoodSheetsIncluded: number | null;
  additionalPlywoodPrice: number | null;
  workmanshipWarrantyYears: number | null;
  manufacturerWarranty: string | null;
};

type Price = CustomerContractSnapshot["price"];

/**
 * Scope from a template estimate. Optional lines the customer selected are
 * flipped to included (and marked `wasOptional`); unselected optional lines
 * are dropped from the contract entirely. The price is recomputed on the
 * modified copy with the estimator's own function.
 */
export function buildScopeFromEstimate(
  e: EstimateForContract,
  includeOptionalItemIds: string[] = [],
): { scope: ScopeSection[]; price: Price } {
  const include = new Set(includeOptionalItemIds);
  const sections = e.sections
    .map((s) => ({
      title: s.title,
      items: s.items
        .filter((i) => !i.isOptional || include.has(i.id))
        .map((i) => ({ ...i, wasOptional: i.isOptional, isOptional: false })),
    }))
    .filter((s) => s.items.length > 0);

  const breakdown = calculateGenericEstimate({
    sections: sections.map((s) => ({
      title: s.title,
      items: s.items.map((i) => ({
        description: i.description,
        unitType: i.unitType,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        isOptional: false,
        notes: i.notes,
      })),
    })),
    marginPercent: e.marginPercent,
    discountEnabled: e.discountEnabled,
    discountPercent: e.discountPercent,
    salesTaxPercent: e.salesTaxPercent,
  });

  return {
    scope: sections.map((s) => ({
      title: s.title,
      items: s.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitType: UNIT_LABELS[i.unitType] ?? i.unitType,
        notes: i.notes,
        wasOptional: i.wasOptional,
      })),
    })),
    price: {
      subtotal: breakdown.priceWithMargin,
      discountAmount: breakdown.discountAmount,
      salesTaxAmount: breakdown.salesTaxAmount,
      total: breakdown.totalPrice,
    },
  };
}

const fee = (label: string, amount: number) => (amount > 0 ? [{ description: label, quantity: null, unitType: null, notes: null, wasOptional: false }] : []);

/** Scope from a roofing estimate: one priced proposal, described in sections. */
export function buildScopeFromRoofEstimate(r: RoofEstimateForContract): {
  scope: ScopeSection[];
  summaryLines: string[];
  price: Price;
} {
  const breakdown = calculateEstimate(r);
  const roofing: ScopeSection = {
    title: "Roofing",
    items: r.roofTypes.map((t) => ({
      description: `Tear-off and re-roof — ${MATERIAL_LABELS[t.material as RoofMaterialKey] ?? t.material}`,
      quantity: t.squares,
      unitType: "squares",
      notes: null,
      wasOptional: false,
    })),
  };
  const materials: ScopeSection = {
    title: "Materials",
    items: [
      ...(r.materialSelection ? [{ description: r.materialSelection, quantity: null, unitType: null, notes: null, wasOptional: false }] : []),
      ...(r.underlaymentType ? [{ description: `Underlayment: ${r.underlaymentType}`, quantity: null, unitType: null, notes: null, wasOptional: false }] : []),
      ...(r.plywoodSheetsIncluded != null
        ? [{
            description: `Plywood: ${r.plywoodSheetsIncluded} sheets included${r.additionalPlywoodPrice != null ? ` (additional sheets at $${r.additionalPlywoodPrice.toFixed(2)} each)` : ""}`,
            quantity: null,
            unitType: null,
            notes: null,
            wasOptional: false,
          }]
        : []),
    ],
  };
  const included: ScopeSection = {
    title: "Included in the contract price",
    items: [
      ...(r.permitIncluded ? fee("Permit", Math.max(r.permitFee, 0.01)) : []),
      ...fee("Dumpster and debris removal", r.dumpsterFee),
      ...fee("Tear-off", r.tearOffFee),
      ...fee("Decking repair allowance", r.deckingFee),
      ...fee("Underlayment", r.underlaymentFee),
      ...fee("Flashing and vents", r.flashingVentFee),
      ...fee("Skylight / chimney flashing", r.skylightChimneyFee),
      ...fee("Gutters", r.guttersFee),
      ...fee(r.miscLabel || "Miscellaneous", r.miscFee),
    ],
  };
  const summaryLines = [
    r.existingRoofType ? `Existing roof: ${r.existingRoofType}` : null,
    r.proposedRoofTypeOverride ? `Proposed roof: ${r.proposedRoofTypeOverride}` : null,
    r.projectDurationText ? `Estimated duration: ${r.projectDurationText}` : null,
    r.workmanshipWarrantyYears != null ? `Workmanship warranty: ${r.workmanshipWarrantyYears} year${r.workmanshipWarrantyYears === 1 ? "" : "s"}` : null,
    r.manufacturerWarranty ? `Manufacturer warranty: ${r.manufacturerWarranty}` : null,
    r.permitIncluded ? "Permit included" : "Permit not included",
  ].filter((l): l is string => Boolean(l));

  return {
    scope: [roofing, materials, included].filter((s) => s.items.length > 0),
    summaryLines,
    price: {
      subtotal: breakdown.priceWithMargin,
      discountAmount: breakdown.discountAmount,
      salesTaxAmount: breakdown.salesTaxAmount,
      total: breakdown.totalPrice,
    },
  };
}

export function companyBlockFromBrand(brand: EstimateBrand): ContractCompanyBlock {
  const cityLine = [brand.city, [brand.state, brand.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = [brand.addressLine1, brand.addressLine2, cityLine].filter(Boolean).join(", ");
  return {
    name: brand.companyName,
    address,
    phone: brand.phone,
    email: brand.email,
    website: brand.website,
    licenses: [brand.gcLicense, brand.roofingLicense].filter((l): l is string => Boolean(l)),
    logoDataUri: brand.logoDataUri,
  };
}

export type BuildSnapshotInput = {
  generatedAt: Date;
  versionNumber: number;
  contractNumber: string;
  job: { jobNumber: string; title: string; serviceType: string };
  lead: LeadLike;
  brand: EstimateBrand;
  source:
    | { type: "ESTIMATE"; estimate: EstimateForContract; includeOptionalItemIds?: string[] }
    | { type: "ROOF_ESTIMATE"; roofEstimate: RoofEstimateForContract };
  template: { key: string; version: number; versionId: string; content: ContractTemplateContent };
  scheduleOverride?: PaymentScheduleItem[] | null;
};

export function buildContractSnapshot(input: BuildSnapshotInput): CustomerContractSnapshot {
  const { source } = input;
  const built =
    source.type === "ESTIMATE"
      ? { ...buildScopeFromEstimate(source.estimate, source.includeOptionalItemIds ?? []), summaryLines: [] as string[] }
      : buildScopeFromRoofEstimate(source.roofEstimate);

  const scheduleItems = input.scheduleOverride ?? input.template.content.paymentSchedule.items;
  const paymentSchedule = computePaymentSchedule(built.price.total, scheduleItems);
  const validityDays = source.type === "ESTIMATE" ? source.estimate.validityDays : source.roofEstimate.validityDays;
  const offerExpiresAt = new Date(input.generatedAt.getTime() + validityDays * 86_400_000).toISOString();

  const base: Omit<CustomerContractSnapshot, "template" | "signature"> = {
    kind: "CUSTOMER_CONTRACT",
    generatedAt: input.generatedAt.toISOString(),
    versionNumber: input.versionNumber,
    contractNumber: input.contractNumber,
    company: companyBlockFromBrand(input.brand),
    owner: {
      name: input.lead.fullName,
      companyName: input.lead.companyName,
      phone: input.lead.primaryPhone,
      altPhone: input.lead.secondaryPhone,
      email: input.lead.email,
    },
    jobSite: {
      line1: input.lead.propertyAddress1,
      line2: input.lead.propertyAddress2,
      city: input.lead.city,
      state: input.lead.state,
      zip: input.lead.zipCode,
    },
    job: input.job,
    source:
      source.type === "ESTIMATE"
        ? { type: "ESTIMATE", id: source.estimate.id, estimateNumber: source.estimate.estimateNumber, name: source.estimate.name, includeOptionalItemIds: source.includeOptionalItemIds ?? [] }
        : { type: "ROOF_ESTIMATE", id: source.roofEstimate.id, estimateNumber: source.roofEstimate.estimateNumber, name: "Roofing proposal" },
    scope: {
      sections: built.scope,
      summaryLines: built.summaryLines,
      exclusions: source.type === "ESTIMATE" ? source.estimate.exclusions : null,
      notes: source.type === "ESTIMATE" ? source.estimate.notes : null,
      specialTerms: source.type === "ROOF_ESTIMATE" ? source.roofEstimate.specialTerms : null,
    },
    price: built.price,
    paymentSchedule,
    depositAmount: depositAmountOf(paymentSchedule),
    validity: { validityDays, offerExpiresAt },
  };

  const ctx = buildMergeContext(base);
  const c = input.template.content;
  return {
    ...base,
    template: {
      key: input.template.key,
      version: input.template.version,
      versionId: input.template.versionId,
      title: renderMergeFields(c.title, ctx).text,
      articles: c.articles.map((a) => ({ ...a, body: renderMergeFields(a.body, ctx).text, title: renderMergeFields(a.title, ctx).text })),
      paymentScheduleText: renderMergeFields(c.paymentScheduleText, ctx).text,
      consentText: renderMergeFields(c.consentText, ctx).text,
    },
  };
}

const UNRESOLVED_RE = /\{\{\s*[a-zA-Z][a-zA-Z0-9_.]*\s*\}\}/;

/** Human-readable reasons the snapshot cannot be sent as a contract. */
export function validateContractSnapshot(s: CustomerContractSnapshot): string[] {
  const problems: string[] = [];
  if (!s.owner.name?.trim()) problems.push("Customer name");
  if (!s.jobSite.line1?.trim() || !s.jobSite.city?.trim() || !s.jobSite.zip?.trim()) problems.push("Property address");
  if (!s.company.name?.trim()) problems.push("Company name");
  if (s.scope.sections.every((sec) => sec.items.length === 0)) problems.push("At least one scope item");
  if (!(s.price.total > 0)) problems.push("Contract price greater than zero");
  const scheduleErrors = validatePaymentSchedule(s.paymentSchedule);
  problems.push(...scheduleErrors.map((e) => `Payment schedule: ${e}`));
  const sum = Math.round(s.paymentSchedule.reduce((a, r) => a + r.amount, 0) * 100) / 100;
  if (s.paymentSchedule.length > 0 && Math.abs(sum - s.price.total) > 0.005) problems.push("Payment schedule must add up to the contract price");
  if (s.template.articles.length === 0) problems.push("Template has no articles");
  if (!s.template.consentText.trim()) problems.push("Template consent text");
  const unresolved = [s.template.title, s.template.paymentScheduleText, s.template.consentText, ...s.template.articles.flatMap((a) => [a.title, a.body])].filter((t) => UNRESOLVED_RE.test(t));
  if (unresolved.length > 0) problems.push("Template has unresolved merge fields");
  return problems;
}
