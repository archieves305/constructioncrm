import { prisma } from "@/lib/db/prisma";
import { COMPANY } from "@/lib/pdf/company";
import { saveFile } from "@/lib/files/storage";
import { renderLaborContractPdf } from "@/lib/pdf/labor-contract";
import { renderContractAddendumPdf } from "@/lib/pdf/contract-addendum";
import { renderInteriorRenovationContractPdf } from "@/lib/pdf/interior-renovation-contract";
import {
  FileCategory,
  GeneratedDocumentType,
  type Prisma,
} from "@/generated/prisma/client";
import type {
  AddendumSnapshot,
  ContractAddress,
  ContractCompany,
  ContractParty,
  ContractTaskSnapshot,
  InteriorRenovationContractSnapshot,
  JobTypeKey,
  LaborContractSnapshot,
} from "./types";

export const DEFAULT_RETAINAGE_PERCENT = 10;
export const DEFAULT_DELAY_DAMAGES_PER_DAY = 250;

export const JOB_TYPE_LABELS: Record<JobTypeKey, string> = {
  FIXED_PRICE: "Fixed Price",
  COST_PLUS: "Cost Plus",
  OWNED_REHAB: "Owner / Owned-Rehab",
};

const COMPANY_INFO: ContractCompany = {
  name: COMPANY.name,
  address: COMPANY.address,
  phone: COMPANY.phone,
  email: COMPANY.email,
};

/** Thrown when a contract cannot be generated because required data is absent. */
export class MissingFieldsError extends Error {
  fields: string[];
  constructor(fields: string[]) {
    super(`Missing required fields: ${fields.join(", ")}`);
    this.name = "MissingFieldsError";
    this.fields = fields;
  }
}

/** Thrown when the referenced job / contract / change order cannot be found. */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function slug(s: string, fallback: string): string {
  const out = (s || "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return out || fallback;
}

export function laborContractFileName(
  jobRef: string,
  contractorName: string,
  version: number,
): string {
  return `labor-contract-${slug(jobRef, "job")}-${slug(
    contractorName,
    "contractor",
  )}-v${version}.pdf`;
}

export function interiorRenovationFileName(
  jobRef: string,
  contractorName: string,
  version: number,
): string {
  return `interior-renovation-labor-contract-${slug(jobRef, "job")}-${slug(
    contractorName,
    "contractor",
  )}-v${version}.pdf`;
}

export function addendumFileName(
  jobRef: string,
  changeNumber: number,
  version: number,
): string {
  return `contract-addendum-${slug(jobRef, "job")}-change-order-${changeNumber}-v${version}.pdf`;
}

// ─── Pure snapshot builders (no I/O, unit-testable) ───────────────────────────

export type LeadLike = {
  fullName: string;
  companyName: string | null;
  primaryPhone: string | null;
  secondaryPhone: string | null;
  email: string | null;
  propertyAddress1: string;
  propertyAddress2: string | null;
  city: string;
  state: string;
  zipCode: string;
};

function ownerParty(lead: LeadLike): ContractParty {
  return {
    name: lead.fullName,
    companyName: lead.companyName,
    phone: lead.primaryPhone,
    altPhone: lead.secondaryPhone,
    email: lead.email,
  };
}

function jobSiteAddress(lead: LeadLike): ContractAddress {
  return {
    line1: lead.propertyAddress1,
    line2: lead.propertyAddress2,
    city: lead.city,
    state: lead.state,
    zip: lead.zipCode,
  };
}

export type LaborContractLike = {
  contractAmount: number;
  description: string | null;
  paymentTerms: string | null;
  startDate: Date | string | null;
  estimatedCompletionDate: Date | string | null;
  contractorLicense: string | null;
  contractorInsurance: string | null;
  exclusions: string | null;
};

export type JobLike = {
  jobNumber: string;
  title: string;
  serviceType: string;
  jobType: JobTypeKey;
};

export function buildLaborContractSnapshot(input: {
  versionNumber: number;
  generatedAt: Date;
  job: JobLike;
  lead: LeadLike;
  contractorName: string;
  contractor: Pick<ContractParty, "phone" | "email">;
  contract: LaborContractLike;
}): LaborContractSnapshot {
  const { contract } = input;
  return {
    kind: "LABOR_CONTRACT",
    generatedAt: input.generatedAt.toISOString(),
    versionNumber: input.versionNumber,
    company: COMPANY_INFO,
    job: {
      jobNumber: input.job.jobNumber,
      title: input.job.title,
      serviceType: input.job.serviceType,
      jobType: input.job.jobType,
      jobTypeLabel: JOB_TYPE_LABELS[input.job.jobType] ?? input.job.jobType,
    },
    owner: ownerParty(input.lead),
    contractor: {
      name: input.contractorName,
      phone: input.contractor.phone ?? null,
      email: input.contractor.email ?? null,
      license: contract.contractorLicense,
      insurance: contract.contractorInsurance,
    },
    jobSite: jobSiteAddress(input.lead),
    terms: {
      contractAmount: contract.contractAmount,
      scopeOfWork: (contract.description ?? "").trim(),
      paymentTerms: contract.paymentTerms,
      startDate: toIso(contract.startDate),
      estimatedCompletionDate: toIso(contract.estimatedCompletionDate),
      exclusions: contract.exclusions,
    },
  };
}

export type ContractTaskLike = {
  name: string;
  room: string | null;
  description: string | null;
  paymentAmount: number | null;
  paymentPercent: number | null;
  inspectionRequired: boolean;
  inspectionStatus: string;
  status: string;
  approvedBy: string | null;
  approvedDate: Date | string | null;
};

function taskSnapshot(task: ContractTaskLike): ContractTaskSnapshot {
  return {
    name: task.name,
    room: task.room,
    description: task.description,
    paymentAmount: task.paymentAmount,
    paymentPercent: task.paymentPercent,
    inspectionRequired: task.inspectionRequired,
    inspectionStatus: task.inspectionStatus,
    status: task.status,
    approvedBy: task.approvedBy,
    approvedDate: toIso(task.approvedDate),
  };
}

export function buildInteriorRenovationSnapshot(input: {
  versionNumber: number;
  generatedAt: Date;
  job: JobLike;
  lead: LeadLike;
  contractorName: string;
  contractor: Pick<ContractParty, "phone" | "email">;
  contract: LaborContractLike & {
    notes: string | null;
    retainagePercent: number | null;
    delayDamagesPerDay: number | null;
  };
  tasks: ContractTaskLike[];
}): InteriorRenovationContractSnapshot {
  const { contract } = input;
  return {
    kind: "INTERIOR_RENOVATION_LABOR_CONTRACT",
    generatedAt: input.generatedAt.toISOString(),
    versionNumber: input.versionNumber,
    company: COMPANY_INFO,
    job: {
      jobNumber: input.job.jobNumber,
      title: input.job.title,
      serviceType: input.job.serviceType,
      jobType: input.job.jobType,
      jobTypeLabel: JOB_TYPE_LABELS[input.job.jobType] ?? input.job.jobType,
    },
    owner: ownerParty(input.lead),
    contractor: {
      name: input.contractorName,
      phone: input.contractor.phone ?? null,
      email: input.contractor.email ?? null,
      license: contract.contractorLicense,
      insurance: contract.contractorInsurance,
    },
    jobSite: jobSiteAddress(input.lead),
    terms: {
      contractAmount: contract.contractAmount,
      scopeOfWork: (contract.description ?? "").trim(),
      paymentTerms: contract.paymentTerms,
      startDate: toIso(contract.startDate),
      estimatedCompletionDate: toIso(contract.estimatedCompletionDate),
      exclusions: contract.exclusions,
      notes: contract.notes,
      retainagePercent: contract.retainagePercent ?? DEFAULT_RETAINAGE_PERCENT,
      delayDamagesPerDay:
        contract.delayDamagesPerDay ?? DEFAULT_DELAY_DAMAGES_PER_DAY,
    },
    tasks: input.tasks.map(taskSnapshot),
  };
}

export type ChangeOrderLike = {
  changeNumber: number;
  changeDate: Date | string;
  reason: string | null;
  scopeChange: string | null;
  addedScope: string | null;
  removedScope: string | null;
  amount: number;
  timeAdjustmentDays: number | null;
  updatedPaymentTerms: string | null;
  paymentImpact: string | null;
  retainageImpact: string | null;
};

export function buildAddendumSnapshot(input: {
  versionNumber: number;
  generatedAt: Date;
  job: Pick<JobLike, "jobNumber" | "title" | "jobType">;
  lead: LeadLike;
  contractorName: string;
  contractor: Pick<ContractParty, "phone" | "email">;
  originalContract: { contractAmount: number; scopeOfWork: string | null } | null;
  originalContractVersion: number | null;
  changeOrder: ChangeOrderLike;
}): AddendumSnapshot {
  const co = input.changeOrder;
  return {
    kind: "CONTRACT_ADDENDUM",
    generatedAt: input.generatedAt.toISOString(),
    versionNumber: input.versionNumber,
    company: COMPANY_INFO,
    job: {
      jobNumber: input.job.jobNumber,
      title: input.job.title,
      jobType: input.job.jobType,
      jobTypeLabel: JOB_TYPE_LABELS[input.job.jobType] ?? input.job.jobType,
    },
    owner: ownerParty(input.lead),
    contractor: {
      name: input.contractorName,
      phone: input.contractor.phone ?? null,
      email: input.contractor.email ?? null,
    },
    jobSite: jobSiteAddress(input.lead),
    originalContract: input.originalContract,
    originalContractVersion: input.originalContractVersion,
    changeOrder: {
      changeNumber: co.changeNumber,
      changeDate: toIso(co.changeDate) ?? new Date(0).toISOString(),
      description: co.reason,
      scopeChange: co.scopeChange,
      addedScope: co.addedScope,
      removedScope: co.removedScope,
      priceAdjustment: co.amount,
      timeAdjustmentDays: co.timeAdjustmentDays,
      updatedPaymentTerms: co.updatedPaymentTerms,
      paymentImpact: co.paymentImpact,
      retainageImpact: co.retainageImpact,
    },
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** Returns the list of human-readable missing required fields (empty = valid). */
export function validateLaborContractFields(
  snapshot: LaborContractSnapshot,
): string[] {
  const missing: string[] = [];
  if (!snapshot.owner.name?.trim()) missing.push("Job owner / customer");
  if (!snapshot.jobSite.line1?.trim()) missing.push("Job site address");
  if (!snapshot.contractor.name?.trim())
    missing.push("Labor contractor name");
  if (!snapshot.terms.scopeOfWork?.trim())
    missing.push("Scope / description");
  return missing;
}

/** Interior renovation contracts also require pricing and a start date. */
export function validateInteriorRenovationFields(
  snapshot: InteriorRenovationContractSnapshot,
): string[] {
  const missing: string[] = [];
  if (!snapshot.owner.name?.trim()) missing.push("Job owner / customer");
  if (!snapshot.jobSite.line1?.trim()) missing.push("Job site address");
  if (!snapshot.contractor.name?.trim())
    missing.push("Labor contractor name");
  if (!snapshot.terms.scopeOfWork?.trim())
    missing.push("Scope / description");
  if (
    !(snapshot.terms.contractAmount > 0) &&
    !snapshot.terms.paymentTerms?.trim()
  )
    missing.push("Contract amount or payment terms");
  if (!snapshot.terms.startDate) missing.push("Start date");
  return missing;
}

/** Addendum needs the contracting parties and a job site to be present. */
export function validateAddendumFields(snapshot: AddendumSnapshot): string[] {
  const missing: string[] = [];
  if (!snapshot.owner.name?.trim()) missing.push("Job owner / customer");
  if (!snapshot.jobSite.line1?.trim()) missing.push("Job site address");
  if (!snapshot.contractor.name?.trim())
    missing.push("Labor contractor name");
  return missing;
}

const LEAD_SELECT = {
  leadId: true,
} as const;

const LEAD_FIELDS = {
  fullName: true,
  companyName: true,
  primaryPhone: true,
  secondaryPhone: true,
  email: true,
  propertyAddress1: true,
  propertyAddress2: true,
  city: true,
  state: true,
  zipCode: true,
} as const;

// ─── DB orchestration ─────────────────────────────────────────────────────────

export async function generateLaborContractPdf(
  jobId: string,
  laborContractId: string,
  userId: string,
) {
  const lc = await prisma.laborContract.findFirst({
    where: { id: laborContractId, jobId },
    include: {
      crew: { select: { name: true, phone: true, email: true } },
      job: {
        select: {
          ...LEAD_SELECT,
          jobNumber: true,
          title: true,
          serviceType: true,
          jobType: true,
          lead: { select: LEAD_FIELDS },
        },
      },
    },
  });
  if (!lc) throw new NotFoundError("Labor contract not found");

  const job = lc.job;
  const lead = job.lead;
  const contractorName = (lc.crew?.name ?? lc.label ?? "").trim();

  const priorCount = await prisma.generatedDocument.count({
    where: {
      laborContractId,
      documentType: GeneratedDocumentType.LABOR_CONTRACT,
    },
  });
  const versionNumber = priorCount + 1;

  const snapshot = buildLaborContractSnapshot({
    versionNumber,
    generatedAt: new Date(),
    job: {
      jobNumber: job.jobNumber,
      title: job.title,
      serviceType: job.serviceType,
      jobType: job.jobType as JobTypeKey,
    },
    lead,
    contractorName,
    contractor: { phone: lc.crew?.phone ?? null, email: lc.crew?.email ?? null },
    contract: {
      contractAmount: Number(lc.contractAmount),
      description: lc.description,
      paymentTerms: lc.paymentTerms,
      startDate: lc.startDate,
      estimatedCompletionDate: lc.estimatedCompletionDate,
      contractorLicense: lc.contractorLicense,
      contractorInsurance: lc.contractorInsurance,
      exclusions: lc.exclusions,
    },
  });

  const missing = validateLaborContractFields(snapshot);
  if (missing.length > 0) throw new MissingFieldsError(missing);

  const fileName = laborContractFileName(
    job.jobNumber,
    contractorName,
    versionNumber,
  );
  const pdf = await renderLaborContractPdf(snapshot);
  const stored = await saveFile(pdf, fileName);

  const file = await prisma.file.create({
    data: {
      leadId: job.leadId,
      fileName,
      fileType: "application/pdf",
      fileSize: stored.bytes,
      storageKey: stored.storageKey,
      category: FileCategory.LABOR_CONTRACT,
      uploadedByUserId: userId,
    },
    select: { id: true },
  });

  return prisma.generatedDocument.create({
    data: {
      jobId,
      laborContractId,
      documentType: GeneratedDocumentType.LABOR_CONTRACT,
      versionNumber,
      fileName,
      storageKey: stored.storageKey,
      fileId: file.id,
      generatedByUserId: userId,
      sourceDataSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function generateInteriorRenovationLaborContractPdf(
  jobId: string,
  laborContractId: string,
  userId: string,
) {
  const lc = await prisma.laborContract.findFirst({
    where: { id: laborContractId, jobId },
    include: {
      crew: { select: { name: true, phone: true, email: true } },
      tasks: { orderBy: { sortOrder: "asc" } },
      job: {
        select: {
          ...LEAD_SELECT,
          jobNumber: true,
          title: true,
          serviceType: true,
          jobType: true,
          lead: { select: LEAD_FIELDS },
        },
      },
    },
  });
  if (!lc) throw new NotFoundError("Labor contract not found");

  const job = lc.job;
  const lead = job.lead;
  const contractorName = (lc.crew?.name ?? lc.label ?? "").trim();

  const priorCount = await prisma.generatedDocument.count({
    where: {
      laborContractId,
      documentType: GeneratedDocumentType.INTERIOR_RENOVATION_LABOR_CONTRACT,
    },
  });
  const versionNumber = priorCount + 1;

  const snapshot = buildInteriorRenovationSnapshot({
    versionNumber,
    generatedAt: new Date(),
    job: {
      jobNumber: job.jobNumber,
      title: job.title,
      serviceType: job.serviceType,
      jobType: job.jobType as JobTypeKey,
    },
    lead,
    contractorName,
    contractor: { phone: lc.crew?.phone ?? null, email: lc.crew?.email ?? null },
    contract: {
      contractAmount: Number(lc.contractAmount),
      description: lc.description,
      paymentTerms: lc.paymentTerms,
      startDate: lc.startDate,
      estimatedCompletionDate: lc.estimatedCompletionDate,
      contractorLicense: lc.contractorLicense,
      contractorInsurance: lc.contractorInsurance,
      exclusions: lc.exclusions,
      notes: lc.notes,
      retainagePercent:
        lc.retainagePercent != null ? Number(lc.retainagePercent) : null,
      delayDamagesPerDay:
        lc.delayDamagesPerDay != null ? Number(lc.delayDamagesPerDay) : null,
    },
    tasks: lc.tasks.map((task) => ({
      name: task.name,
      room: task.room,
      description: task.description,
      paymentAmount:
        task.paymentAmount != null ? Number(task.paymentAmount) : null,
      paymentPercent:
        task.paymentPercent != null ? Number(task.paymentPercent) : null,
      inspectionRequired: task.inspectionRequired,
      inspectionStatus: task.inspectionStatus,
      status: task.status,
      approvedBy: task.approvedBy,
      approvedDate: task.approvedDate,
    })),
  });

  const missing = validateInteriorRenovationFields(snapshot);
  if (missing.length > 0) throw new MissingFieldsError(missing);

  const fileName = interiorRenovationFileName(
    job.jobNumber,
    contractorName,
    versionNumber,
  );
  const pdf = await renderInteriorRenovationContractPdf(snapshot);
  const stored = await saveFile(pdf, fileName);

  const file = await prisma.file.create({
    data: {
      leadId: job.leadId,
      fileName,
      fileType: "application/pdf",
      fileSize: stored.bytes,
      storageKey: stored.storageKey,
      category: FileCategory.INTERIOR_RENOVATION_LABOR_CONTRACT,
      uploadedByUserId: userId,
    },
    select: { id: true },
  });

  return prisma.generatedDocument.create({
    data: {
      jobId,
      laborContractId,
      documentType: GeneratedDocumentType.INTERIOR_RENOVATION_LABOR_CONTRACT,
      versionNumber,
      fileName,
      storageKey: stored.storageKey,
      fileId: file.id,
      generatedByUserId: userId,
      sourceDataSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function generateChangeOrderAddendumPdf(
  jobId: string,
  changeOrderId: string,
  userId: string,
  laborContractId?: string | null,
  contractDocumentVersionId?: string | null,
) {
  const co = await prisma.laborChangeOrder.findUnique({
    where: { id: changeOrderId },
    include: {
      laborContract: {
        select: {
          id: true,
          contractAmount: true,
          description: true,
          label: true,
          crew: { select: { name: true, phone: true, email: true } },
          job: {
            select: {
              ...LEAD_SELECT,
              id: true,
              jobNumber: true,
              title: true,
              serviceType: true,
              jobType: true,
              lead: { select: LEAD_FIELDS },
            },
          },
        },
      },
    },
  });
  // The change order must exist and belong to the supplied job.
  if (!co || co.laborContract.job.id !== jobId) {
    throw new NotFoundError("Change order not found");
  }

  const lc = co.laborContract;
  const job = lc.job;

  const lead = job.lead;
  const contractorName = (lc.crew?.name ?? lc.label ?? "").trim();
  const effectiveLaborContractId = laborContractId ?? lc.id;

  // Determine the change order number: stored value, else its 1-based position.
  let changeNumber = co.changeNumber ?? 0;
  if (!changeNumber) {
    const siblings = await prisma.laborChangeOrder.findMany({
      where: { laborContractId: lc.id },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const idx = siblings.findIndex((s) => s.id === co.id);
    changeNumber = idx >= 0 ? idx + 1 : 1;
  }

  // Resolve the referenced original-contract version, if one was selected.
  let originalContractVersion: number | null = null;
  if (contractDocumentVersionId) {
    const ref = await prisma.generatedDocument.findUnique({
      where: { id: contractDocumentVersionId },
      select: { versionNumber: true },
    });
    originalContractVersion = ref?.versionNumber ?? null;
  }

  const priorCount = await prisma.generatedDocument.count({
    where: {
      changeOrderId,
      documentType: GeneratedDocumentType.CONTRACT_ADDENDUM,
    },
  });
  const versionNumber = priorCount + 1;

  const snapshot = buildAddendumSnapshot({
    versionNumber,
    generatedAt: new Date(),
    job: {
      jobNumber: job.jobNumber,
      title: job.title,
      jobType: job.jobType as JobTypeKey,
    },
    lead,
    contractorName,
    contractor: { phone: lc.crew?.phone ?? null, email: lc.crew?.email ?? null },
    originalContract: {
      contractAmount: Number(lc.contractAmount),
      scopeOfWork: lc.description,
    },
    originalContractVersion,
    changeOrder: {
      changeNumber,
      changeDate: co.changeDate,
      reason: co.reason,
      scopeChange: co.scopeChange,
      addedScope: co.addedScope,
      removedScope: co.removedScope,
      amount: Number(co.amount),
      timeAdjustmentDays: co.timeAdjustmentDays,
      updatedPaymentTerms: co.updatedPaymentTerms,
      paymentImpact: co.paymentImpact,
      retainageImpact: co.retainageImpact,
    },
  });

  const missing = validateAddendumFields(snapshot);
  if (missing.length > 0) throw new MissingFieldsError(missing);

  const fileName = addendumFileName(job.jobNumber, changeNumber, versionNumber);
  const pdf = await renderContractAddendumPdf(snapshot);
  const stored = await saveFile(pdf, fileName);

  const file = await prisma.file.create({
    data: {
      leadId: job.leadId,
      fileName,
      fileType: "application/pdf",
      fileSize: stored.bytes,
      storageKey: stored.storageKey,
      category: FileCategory.CONTRACT_ADDENDUM,
      uploadedByUserId: userId,
    },
    select: { id: true },
  });

  return prisma.generatedDocument.create({
    data: {
      jobId,
      changeOrderId,
      laborContractId: effectiveLaborContractId,
      documentType: GeneratedDocumentType.CONTRACT_ADDENDUM,
      versionNumber,
      fileName,
      storageKey: stored.storageKey,
      fileId: file.id,
      generatedByUserId: userId,
      sourceDataSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });
}
