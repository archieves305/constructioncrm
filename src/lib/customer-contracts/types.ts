// Shapes shared by the contract services, the PDF renderer and the UI.
//
// `CustomerContractSnapshot` is the frozen, fully-merged document persisted
// on the contract row and on every GeneratedDocument. Because it is frozen at
// generation time, the signed PDF re-rendered from it cannot pick up a later
// change to the estimate, the lead or the template.

import type { ContractAddress, ContractParty } from "@/lib/contracts/types";

export type ContractArticle = { key: string; title: string; body: string };

export type PaymentScheduleItem = {
  key: string;
  label: string;
  percent: number;
  /** When it falls due, in the customer's words: "upon signing". */
  trigger: string;
};

export type PaymentScheduleRow = PaymentScheduleItem & { amount: number };

/** Everything an admin edits on a template version. */
export type ContractTemplateContent = {
  title: string;
  articles: ContractArticle[];
  paymentSchedule: { items: PaymentScheduleItem[] };
  paymentScheduleText: string;
  consentText: string;
};

export type ScopeItem = {
  description: string;
  quantity: number | null;
  unitType: string | null;
  notes: string | null;
  /** An optional estimate line the customer chose to include. */
  wasOptional: boolean;
};

export type ScopeSection = { title: string; items: ScopeItem[] };

export type ContractSourceType = "ESTIMATE" | "ROOF_ESTIMATE";

export type ContractCompanyBlock = {
  name: string;
  address: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  licenses: string[];
  logoDataUri: string | null;
};

export type ContractSignatureBlock = {
  signerName: string;
  signerEmail: string | null;
  signedAt: string;
  consentAt: string;
  consentText: string;
  ip: string | null;
  userAgent: string | null;
  signatureDataUri: string;
  unsignedPdfSha256: string;
  tokenSha256: string;
  contractId: string;
  sentAt: string;
  sentToEmail: string | null;
};

export type CustomerContractSnapshot = {
  kind: "CUSTOMER_CONTRACT";
  generatedAt: string;
  /** Unsigned document version (1 on first generation). */
  versionNumber: number;
  contractNumber: string;
  company: ContractCompanyBlock;
  owner: ContractParty;
  jobSite: ContractAddress;
  job: { jobNumber: string; title: string; serviceType: string };
  source: {
    type: ContractSourceType;
    id: string;
    estimateNumber: string;
    name: string;
    /** Optional estimate lines the customer chose (template estimates only); kept so regenerate can repeat the choice. */
    includeOptionalItemIds?: string[];
  };
  scope: {
    sections: ScopeSection[];
    /** Proposal lines that are not priced items (roofing: existing roof, warranty…). */
    summaryLines: string[];
    exclusions: string | null;
    notes: string | null;
    specialTerms: string | null;
  };
  price: { subtotal: number; discountAmount: number; salesTaxAmount: number; total: number };
  paymentSchedule: PaymentScheduleRow[];
  depositAmount: number;
  validity: { validityDays: number; offerExpiresAt: string };
  /** Articles are stored ALREADY merged so re-rendering is deterministic. */
  template: {
    key: string;
    version: number;
    versionId: string;
    title: string;
    articles: ContractArticle[];
    paymentScheduleText: string;
    consentText: string;
  };
  /** Present only on the signed rendering. */
  signature?: ContractSignatureBlock;
};

export type CustomerContractStatusValue = "DRAFT" | "SENT" | "SIGNED" | "DECLINED" | "VOID";
