import { dayKey } from "@/lib/time/zone";

/**
 * The data dictionary: every value a permit form can be filled with, and
 * where it comes from. Pure and client-safe. A form field is mapped to a key
 * (the AI proposes, a person confirms); the value is always read from KNU's
 * records for this permit — the model never supplies one.
 *
 * `protected` keys (licences, the qualifier) are filled from a record a
 * person entered or left blank; they are flagged on the review so nobody
 * finalises one unread. `field` names the record field a person can fill in
 * place when the value is missing.
 */
export type FormContext = {
  today: Date;
  permit: {
    permitType: string | null;
    permitTypeKey: string | null;
    scopeDescription: string | null;
    valuation: number | null;
    applicationNumber: string | null;
    permitNumber: string | null;
    municipality: string;
    jurisdiction: { name: string; county: string | null } | null;
    coordinatorName: string | null;
  };
  job: { jobNumber: string; targetStartDate: Date | null; projectManagerName: string | null };
  lead: {
    fullName: string;
    companyName: string | null;
    primaryPhone: string | null;
    email: string | null;
    propertyAddress1: string;
    propertyAddress2: string | null;
    city: string;
    state: string | null;
    zipCode: string;
    county: string | null;
    mailingAddress1: string | null;
    mailingAddress2: string | null;
    parcelNumber: string | null;
    legalDescription: string | null;
  };
  contractor: { companyName: string; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null; email: string | null; gcLicense: string | null; roofingLicense: string | null };
  parties: { role: string; name: string; email: string | null; phone: string | null; licenseNumber: string | null }[];
};

export type Resolved = { value: string | null; source: string; alternatives?: { value: string; source: string }[] };

export type DictGroup = "property" | "owner" | "contractor" | "permit" | "job" | "design" | "other";

export type DictKey = {
  key: string;
  label: string;
  group: DictGroup;
  /** An example of the format, for the mapping prompt (never real data). */
  example: string;
  protected?: boolean;
  /** The record field a person can fill in place: "lead.parcelNumber". */
  field?: "lead.parcelNumber" | "lead.legalDescription";
  resolve: (c: FormContext) => Resolved;
};

const clean = (v: string | null | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t || null;
};
const r = (value: string | null | undefined, source: string): Resolved => ({ value: clean(value), source });
const party = (c: FormContext, ...roles: string[]) => c.parties.find((p) => roles.includes(p.role)) ?? null;
const usingMailing = (c: FormContext) => !!clean(c.lead.mailingAddress1);
const name = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The licence the permit is pulled under: the qualifier a person recorded on the permit, else the company's licence for the trade. */
function contractorLicense(c: FormContext): Resolved {
  const q = party(c, "QUALIFIER");
  if (clean(q?.licenseNumber)) return r(q!.licenseNumber, "permit party: qualifier");
  if (c.permit.permitTypeKey === "reroof" && clean(c.contractor.roofingLicense)) return r(c.contractor.roofingLicense, "company: roofing licence");
  return r(c.contractor.gcLicense, "company: general contractor licence");
}

export const DICTIONARY: readonly DictKey[] = [
  // the property
  { key: "property.address", label: "Property street address", group: "property", example: "100 Main St", resolve: (c) => r(c.lead.propertyAddress1, "lead: property address") },
  { key: "property.unit", label: "Property unit / suite", group: "property", example: "Unit 4", resolve: (c) => r(c.lead.propertyAddress2, "lead: property address line 2") },
  { key: "property.addressFull", label: "Property address, one line", group: "property", example: "100 Main St, Palm Beach, FL 33480", resolve: (c) => r([c.lead.propertyAddress1, c.lead.propertyAddress2, c.lead.city, [c.lead.state ?? "FL", c.lead.zipCode].join(" ")].filter((x) => clean(x)).join(", "), "lead: property address") },
  { key: "property.city", label: "Property city", group: "property", example: "Palm Beach", resolve: (c) => r(c.lead.city, "lead: city") },
  { key: "property.state", label: "Property state", group: "property", example: "FL", resolve: (c) => r(c.lead.state ?? "FL", "lead: state") },
  { key: "property.zip", label: "Property ZIP", group: "property", example: "33480", resolve: (c) => r(c.lead.zipCode, "lead: ZIP") },
  { key: "property.county", label: "Property county", group: "property", example: "Palm Beach", resolve: (c) => r(c.lead.county ?? c.permit.jurisdiction?.county, c.lead.county ? "lead: county" : "jurisdiction: county") },
  { key: "property.parcelNumber", label: "Parcel control number (PCN / folio)", group: "property", example: "50-43-43-23-05-012-0010", field: "lead.parcelNumber", resolve: (c) => r(c.lead.parcelNumber, "lead: parcel number") },
  { key: "property.legalDescription", label: "Legal description", group: "property", example: "LOT 12, BLOCK 3, EXAMPLE ADDITION, PB 10 P 45", field: "lead.legalDescription", resolve: (c) => r(c.lead.legalDescription, "lead: legal description") },

  // the owner
  {
    key: "owner.name",
    label: "Property owner name",
    group: "owner",
    example: "Jane Doe",
    resolve: (c) => {
      const p = party(c, "OWNER");
      const lead = clean(c.lead.fullName);
      if (p && lead && !name(p.name, lead)) return { value: clean(p.name), source: "permit party: owner", alternatives: [{ value: lead, source: "lead: customer name" }] };
      return p ? r(p.name, "permit party: owner") : r(c.lead.fullName, "lead: customer name");
    },
  },
  { key: "owner.company", label: "Owner company (if any)", group: "owner", example: "Example Holdings LLC", resolve: (c) => r(c.lead.companyName, "lead: company") },
  { key: "owner.phone", label: "Owner phone", group: "owner", example: "(561) 555-0100", resolve: (c) => (clean(party(c, "OWNER")?.phone) ? r(party(c, "OWNER")!.phone, "permit party: owner") : r(c.lead.primaryPhone, "lead: phone")) },
  { key: "owner.email", label: "Owner email", group: "owner", example: "owner@example.com", resolve: (c) => (clean(party(c, "OWNER")?.email) ? r(party(c, "OWNER")!.email, "permit party: owner") : r(c.lead.email, "lead: email")) },
  { key: "owner.address", label: "Owner mailing street address", group: "owner", example: "100 Main St", resolve: (c) => (usingMailing(c) ? r(c.lead.mailingAddress1, "lead: mailing address") : r(c.lead.propertyAddress1, "lead: property address")) },
  { key: "owner.unit", label: "Owner mailing unit", group: "owner", example: "Unit 4", resolve: (c) => (usingMailing(c) ? r(c.lead.mailingAddress2, "lead: mailing address line 2") : r(c.lead.propertyAddress2, "lead: property address line 2")) },
  // a separate mailing address carries no city / ZIP in the CRM: blank rather than the property's
  { key: "owner.city", label: "Owner mailing city", group: "owner", example: "Palm Beach", resolve: (c) => (usingMailing(c) ? r(null, "lead: mailing address has no city") : r(c.lead.city, "lead: city")) },
  { key: "owner.state", label: "Owner mailing state", group: "owner", example: "FL", resolve: (c) => (usingMailing(c) ? r(null, "lead: mailing address has no state") : r(c.lead.state ?? "FL", "lead: state")) },
  { key: "owner.zip", label: "Owner mailing ZIP", group: "owner", example: "33480", resolve: (c) => (usingMailing(c) ? r(null, "lead: mailing address has no ZIP") : r(c.lead.zipCode, "lead: ZIP")) },

  // the contractor (KNU)
  { key: "contractor.name", label: "Contractor company name", group: "contractor", example: "Knu Construction", resolve: (c) => r(c.contractor.companyName, "company profile") },
  { key: "contractor.address", label: "Contractor street address", group: "contractor", example: "2500 N. Federal Highway", resolve: (c) => r(c.contractor.addressLine1, "company profile") },
  { key: "contractor.unit", label: "Contractor suite", group: "contractor", example: "Ste 102", resolve: (c) => r(c.contractor.addressLine2, "company profile") },
  { key: "contractor.city", label: "Contractor city", group: "contractor", example: "Fort Lauderdale", resolve: (c) => r(c.contractor.city, "company profile") },
  { key: "contractor.state", label: "Contractor state", group: "contractor", example: "FL", resolve: (c) => r(c.contractor.state, "company profile") },
  { key: "contractor.zip", label: "Contractor ZIP", group: "contractor", example: "33305", resolve: (c) => r(c.contractor.zip, "company profile") },
  { key: "contractor.phone", label: "Contractor phone", group: "contractor", example: "(561) 555-0142", resolve: (c) => r(c.contractor.phone, "company profile") },
  { key: "contractor.email", label: "Contractor email", group: "contractor", example: "office@example.com", resolve: (c) => r(c.contractor.email, "company profile") },
  { key: "contractor.contactName", label: "Contractor contact person", group: "contractor", example: "Jane Doe", resolve: (c) => (c.permit.coordinatorName ? r(c.permit.coordinatorName, "permit: coordinator") : r(c.job.projectManagerName, "job: project manager")) },
  { key: "contractor.licenseNumber", label: "Contractor licence number (the qualifier's, else the company's for the trade)", group: "contractor", example: "CGC1234567", protected: true, resolve: contractorLicense },
  { key: "contractor.gcLicense", label: "General contractor licence number", group: "contractor", example: "CGC1234567", protected: true, resolve: (c) => r(c.contractor.gcLicense, "company: general contractor licence") },
  { key: "contractor.roofingLicense", label: "Roofing contractor licence number", group: "contractor", example: "CCC1330000", protected: true, resolve: (c) => r(c.contractor.roofingLicense, "company: roofing licence") },
  { key: "contractor.qualifierName", label: "Qualifier / certificate holder name", group: "contractor", example: "John Roe", protected: true, resolve: (c) => r(party(c, "QUALIFIER")?.name, "permit party: qualifier") },

  // the permit and the job
  { key: "permit.type", label: "Permit type, as written", group: "permit", example: "Re-Roof", resolve: (c) => r(c.permit.permitType, "permit: type") },
  { key: "permit.typeKey", label: "Permit type code (building, reroof, interior_renovation, windows_doors, electrical, plumbing, mechanical, demolition, other)", group: "permit", example: "reroof", resolve: (c) => r(c.permit.permitTypeKey, "permit: type") },
  { key: "permit.scope", label: "Scope / description of work", group: "permit", example: "Re-roof: remove tile, install standing seam metal", resolve: (c) => r(c.permit.scopeDescription, "permit: scope of work") },
  { key: "permit.valuation", label: "Value of the work", group: "permit", example: "48500", resolve: (c) => r(c.permit.valuation == null ? null : String(c.permit.valuation), "permit: valuation") },
  { key: "permit.applicationNumber", label: "Application number", group: "permit", example: "B-26-04512", resolve: (c) => r(c.permit.applicationNumber, "permit: application number") },
  { key: "permit.number", label: "Issued permit number", group: "permit", example: "BLD-26-0777", resolve: (c) => r(c.permit.permitNumber, "permit: permit number") },
  { key: "permit.jurisdiction", label: "Jurisdiction name", group: "permit", example: "Town of Palm Beach", resolve: (c) => r(c.permit.jurisdiction?.name ?? c.permit.municipality, "permit: jurisdiction") },
  { key: "job.number", label: "KNU job number", group: "job", example: "JOB-00042", resolve: (c) => r(c.job.jobNumber, "job") },
  { key: "job.startDate", label: "Planned start date", group: "job", example: "2026-11-02", resolve: (c) => r(c.job.targetStartDate ? dayKey(c.job.targetStartDate) : null, "job: target start") },

  // design professionals (from the permit's parties)
  { key: "architect.name", label: "Architect name", group: "design", example: "Coastal Architecture LLC", resolve: (c) => r(party(c, "ARCHITECT")?.name, "permit party: architect") },
  { key: "architect.license", label: "Architect licence number", group: "design", example: "AR0012345", protected: true, resolve: (c) => r(party(c, "ARCHITECT")?.licenseNumber, "permit party: architect") },
  { key: "architect.phone", label: "Architect phone", group: "design", example: "(561) 555-0110", resolve: (c) => r(party(c, "ARCHITECT")?.phone, "permit party: architect") },
  { key: "architect.email", label: "Architect email", group: "design", example: "arch@example.com", resolve: (c) => r(party(c, "ARCHITECT")?.email, "permit party: architect") },
  { key: "engineer.name", label: "Engineer of record name", group: "design", example: "Gomez Engineering", resolve: (c) => r(party(c, "ENGINEER_OF_RECORD")?.name, "permit party: engineer") },
  { key: "engineer.license", label: "Engineer licence number (PE)", group: "design", example: "PE12345", protected: true, resolve: (c) => r(party(c, "ENGINEER_OF_RECORD")?.licenseNumber, "permit party: engineer") },
  { key: "engineer.phone", label: "Engineer phone", group: "design", example: "(561) 555-0120", resolve: (c) => r(party(c, "ENGINEER_OF_RECORD")?.phone, "permit party: engineer") },
  { key: "engineer.email", label: "Engineer email", group: "design", example: "pe@example.com", resolve: (c) => r(party(c, "ENGINEER_OF_RECORD")?.email, "permit party: engineer") },

  { key: "today", label: "Today's date", group: "other", example: "2026-10-18", resolve: (c) => r(dayKey(c.today), "today") },
];

const BY_KEY = new Map(DICTIONARY.map((d) => [d.key, d]));

export function dictKey(key: string): DictKey | null {
  return BY_KEY.get(key) ?? null;
}

export const DICT_GROUP_LABEL: Record<DictGroup, string> = {
  property: "Property",
  owner: "Owner",
  contractor: "Contractor (KNU)",
  permit: "Permit",
  job: "Job",
  design: "Architect and engineer",
  other: "Other",
};
