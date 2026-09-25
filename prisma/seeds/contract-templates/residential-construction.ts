import type { ContractTemplateContent } from "../../../src/lib/customer-contracts/types";

/**
 * Default customer agreement, version 1. Sensible residential-construction
 * defaults for Richard to rewrite in Admin → Contract Templates; NOT legal
 * advice. Florida-specific statutory notices (Ch. 713 lien law, Ch. 489
 * licensing / recovery-fund disclosures) belong in that edit.
 *
 * Merge fields: see MERGE_FIELD_CATALOG in src/lib/customer-contracts/merge.ts.
 * A blank line starts a new paragraph; a line starting "- " is a bullet.
 */
export const RESIDENTIAL_CONSTRUCTION_KEY = "residential_construction";

export const RESIDENTIAL_CONSTRUCTION_META = {
  key: RESIDENTIAL_CONSTRUCTION_KEY,
  name: "Residential Construction Agreement",
  description: "Default customer agreement generated from an accepted estimate. Deposit / progress / final schedule.",
};

export const RESIDENTIAL_CONSTRUCTION_V1: ContractTemplateContent = {
  title: "Residential Construction Agreement",
  paymentSchedule: {
    items: [
      { key: "deposit", label: "Deposit", percent: 40, trigger: "Due upon signing this Agreement" },
      { key: "progress", label: "Progress payment", percent: 40, trigger: "Due upon substantial completion of rough work / first passed inspection" },
      { key: "final", label: "Final payment", percent: 20, trigger: "Due upon completion and final inspection" },
    ],
  },
  paymentScheduleText: "Owner agrees to pay the Contract Price of {{contract.total}} to {{company.name}} as follows:",
  consentText:
    "By checking this box and signing below, I agree that my electronic signature is the legal equivalent of my handwritten signature, that I intend to be bound by this Agreement, and that I consent to receive and sign this Agreement electronically under the U.S. Electronic Signatures in Global and National Commerce Act (ESIGN) and applicable state law. I confirm that I can access and retain a copy of this document.",
  articles: [
    {
      key: "parties",
      title: "Parties and Effective Date",
      body:
        "This Residential Construction Agreement (the \"Agreement\") is made between {{company.name}} (\"Contractor\"), license {{company.licenses}}, of {{company.address}}, and {{customer.name}} (\"Owner\"), for work at {{job.address}} (the \"Property\").\n\nThis Agreement becomes effective on the date Owner signs it. The Scope of Work, Contract Price and Payment Schedule set out above are part of this Agreement. Estimate {{estimate.number}} is incorporated by reference.",
    },
    {
      key: "scope",
      title: "Performance of the Work",
      body:
        "Contractor will furnish the labor, materials, equipment and supervision needed to complete the work described in the Scope of Work (the \"Work\") in a good and workmanlike manner and in accordance with applicable building codes.\n\nAnything not expressly listed in the Scope of Work is excluded. Items marked as selected options are included; unselected options are not. Owner is responsible for the accuracy of information Owner provides about the Property.",
    },
    {
      key: "price",
      title: "Price Validity and Inclusions",
      body:
        "Owner agrees to pay Contractor the Contract Price of {{contract.total}} for the Work, which includes the labor, materials, permit fees (where listed as included) and sales tax shown above.\n\nThe Contract Price is valid if this Agreement is signed on or before {{contract.offerExpiresAt}}. After that date Contractor may re-price the Work to reflect current material and labor costs.",
    },
    {
      key: "payment",
      title: "Payment Terms",
      body:
        "The deposit of {{contract.deposit}} ({{contract.depositPercent}}) is due upon signing and secures Owner's place in Contractor's schedule and the ordering of materials. Each later payment is due within three (3) days of the stated milestone.\n\nAmounts not paid when due accrue interest at 1.5% per month (18% per year) or the highest rate allowed by law, whichever is less. Contractor may suspend the Work while any payment is past due and the schedule extends by the length of the suspension. Contractor reserves all lien rights under the Florida Construction Lien Law, Chapter 713, Florida Statutes.",
    },
    {
      key: "change_orders",
      title: "Change Orders",
      body:
        "Changes to the Scope of Work, the Contract Price or the schedule require a written change order signed or electronically approved by Owner before the changed work begins. Electronic approval through Contractor's customer portal is a signed change order.\n\nConcealed or unforeseen conditions — including rot, termite damage, code deficiencies in existing construction, hazardous materials or conditions that differ materially from those reasonably assumed — are outside the Scope of Work and will be priced as a change order at Contractor's then-current rates.",
    },
    {
      key: "schedule",
      title: "Commencement, Schedule and Delays",
      body:
        "Contractor will begin the Work within a reasonable time after receipt of the deposit, issuance of any required permits and availability of materials, and will pursue it diligently to completion. Any duration given in the Scope of Work is an estimate, not a guarantee.\n\nThe schedule extends, without penalty to Contractor, for delays caused by weather, permit or inspection timing, Owner changes or late decisions, unavailability of materials, labor disputes, utility work, acts of God or any other cause beyond Contractor's reasonable control.",
    },
    {
      key: "permits",
      title: "Permits, Inspections and Codes",
      body:
        "Where the Scope of Work lists permits as included, Contractor will apply for them and schedule the required inspections. Owner will cooperate with access, homeowner-association approvals, surveys and any documents the permitting authority requires from the property owner.\n\nWork will comply with the building codes in force on the date of permit issuance. Code-required upgrades to existing conditions that are not listed in the Scope of Work are change orders.",
    },
    {
      key: "materials",
      title: "Materials and Substitutions",
      body:
        "Materials will be as specified in the Scope of Work. If a specified material is unavailable or its lead time would delay the Work, Contractor may substitute a material of equal or better quality after notifying Owner. Surplus materials remain Contractor's property.",
    },
    {
      key: "owner_duties",
      title: "Owner Responsibilities and Site Access",
      body:
        "Owner will provide safe and continuous access to the Property during working hours, water and electricity for the Work, and will remove or protect personal property, vehicles and landscaping in the work area. Owner will secure pets and disclose known hazards, private utilities, irrigation lines and septic systems. Owner is responsible for damage to unmarked private underground lines.",
    },
    {
      key: "warranty",
      title: "Warranty",
      body:
        "Contractor warrants the Work against defects in workmanship for the period stated in the Scope of Work (or, if none is stated, one year from substantial completion). Manufacturer warranties on materials are passed through to Owner.\n\nThe warranty does not cover ordinary wear, damage from misuse or lack of maintenance, work by others, settlement or movement of the structure, or acts of God. The warranty is void while any payment under this Agreement remains outstanding.",
    },
    {
      key: "insurance",
      title: "Insurance and Licensing",
      body:
        "Contractor maintains general liability insurance and workers' compensation coverage as required by Florida law and will provide certificates on request. Owner will keep homeowner's or builder's-risk insurance on the Property in force during the Work.",
    },
    {
      key: "termination",
      title: "Termination and Cancellation",
      body:
        "Owner may cancel this Agreement without penalty by written notice within three (3) business days after signing, where applicable law grants that right. After that period, if Owner cancels, Owner will pay for work performed, materials ordered or fabricated, and an administrative fee of 15% of the unperformed balance.\n\nContractor may terminate this Agreement if a payment is more than ten (10) days past due, if Owner fails to provide access, or if site conditions become unsafe, and will be paid for work performed through the date of termination.",
    },
    {
      key: "disputes",
      title: "Dispute Resolution",
      body:
        "The parties will first try in good faith to resolve any dispute by direct discussion, then by mediation in Broward County, Florida, with the mediator's fee shared equally. Any dispute not resolved by mediation may be brought in the state courts located in Broward County, Florida. This Agreement is governed by Florida law. The prevailing party in any action to enforce this Agreement is entitled to recover reasonable attorneys' fees and costs.",
    },
    {
      key: "liability",
      title: "Limitation of Liability and Indemnity",
      body:
        "Neither party is liable to the other for consequential, incidental or special damages. Contractor's total liability under this Agreement will not exceed the Contract Price. Each party will indemnify the other against third-party claims arising from its own negligence or willful misconduct.",
    },
    {
      key: "general",
      title: "Entire Agreement; Electronic Signatures",
      body:
        "This Agreement, including the Scope of Work, Contract Price, Payment Schedule and estimate {{estimate.number}}, is the entire agreement between the parties and replaces all prior proposals and discussions. It may be changed only in writing. If any provision is unenforceable, the rest remains in effect.\n\nThe parties agree that electronic signatures and electronic copies of this Agreement are valid and enforceable, and that notices may be given by email to the addresses on file with Contractor.",
    },
  ],
};

export const CONTRACT_TEMPLATE_VERSION = 1;
