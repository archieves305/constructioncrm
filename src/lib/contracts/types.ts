// Shared data shapes for generated construction-contract documents.
//
// These types describe the immutable `sourceDataSnapshot` that is persisted
// with every GeneratedDocument row. Because the snapshot is frozen at
// generation time, regenerating (or later editing the underlying records)
// never alters a previously generated PDF.

export type ContractCompany = {
  name: string;
  address: string;
  phone: string;
  email: string;
};

export type ContractParty = {
  /** Display name (owner full name, or crew / ad-hoc labor name). */
  name: string;
  companyName?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  email?: string | null;
  /** License #, when known (contractor only). */
  license?: string | null;
  /** Free-text insurance description, when known (contractor only). */
  insurance?: string | null;
};

export type ContractAddress = {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
};

export type JobTypeKey = "FIXED_PRICE" | "COST_PLUS" | "OWNED_REHAB";

export type LaborContractSnapshot = {
  kind: "LABOR_CONTRACT";
  generatedAt: string; // ISO timestamp
  versionNumber: number;
  company: ContractCompany;
  job: {
    jobNumber: string;
    title: string;
    serviceType: string;
    jobType: JobTypeKey;
    jobTypeLabel: string;
  };
  owner: ContractParty;
  contractor: ContractParty;
  jobSite: ContractAddress;
  terms: {
    contractAmount: number;
    scopeOfWork: string;
    paymentTerms?: string | null;
    startDate?: string | null; // ISO date
    estimatedCompletionDate?: string | null; // ISO date
    exclusions?: string | null;
  };
};

export type ContractTaskSnapshot = {
  name: string;
  room?: string | null;
  description?: string | null;
  paymentAmount?: number | null;
  paymentPercent?: number | null;
  inspectionRequired: boolean;
  inspectionStatus: string;
  status: string;
  approvedBy?: string | null;
  approvedDate?: string | null; // ISO date
  notes?: string | null;
};

export type InteriorRenovationContractSnapshot = {
  kind: "INTERIOR_RENOVATION_LABOR_CONTRACT";
  generatedAt: string; // ISO timestamp (also the contract date)
  versionNumber: number;
  company: ContractCompany;
  job: {
    jobNumber: string;
    title: string;
    serviceType: string;
    jobType: JobTypeKey;
    jobTypeLabel: string;
  };
  owner: ContractParty;
  contractor: ContractParty;
  jobSite: ContractAddress;
  terms: {
    contractAmount: number;
    scopeOfWork: string;
    paymentTerms?: string | null;
    startDate?: string | null; // ISO date
    estimatedCompletionDate?: string | null; // ISO date
    exclusions?: string | null;
    notes?: string | null;
    retainagePercent: number;
    delayDamagesPerDay: number;
  };
  tasks: ContractTaskSnapshot[];
};

export type AddendumSnapshot = {
  kind: "CONTRACT_ADDENDUM";
  generatedAt: string; // ISO timestamp
  versionNumber: number;
  company: ContractCompany;
  job: {
    jobNumber: string;
    title: string;
    jobType: JobTypeKey;
    jobTypeLabel: string;
  };
  owner: ContractParty;
  contractor: ContractParty;
  jobSite: ContractAddress;
  /** Original labor-contract figures, when a labor contract is linked. */
  originalContract: {
    contractAmount: number;
    scopeOfWork?: string | null;
  } | null;
  /** Version number of the referenced original contract PDF, if one was chosen. */
  originalContractVersion: number | null;
  changeOrder: {
    changeNumber: number;
    changeDate: string; // ISO date
    description?: string | null;
    scopeChange?: string | null;
    addedScope?: string | null;
    removedScope?: string | null;
    priceAdjustment: number; // signed
    timeAdjustmentDays?: number | null;
    updatedPaymentTerms?: string | null;
    paymentImpact?: string | null;
    retainageImpact?: string | null;
  };
};
