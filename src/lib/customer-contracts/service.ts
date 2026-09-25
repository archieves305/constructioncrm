// Customer contracts: orchestration over Prisma. Decisions live in the pure
// modules (snapshot, schedule, state, merge); this file loads, calls them,
// renders and persists. Pattern: src/lib/contracts/generate.ts.

import { createHash, randomBytes } from "node:crypto";
import { FileCategory, GeneratedDocumentType, type Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { logger } from "@/lib/logger";
import { MissingFieldsError, NotFoundError, type LeadLike } from "@/lib/contracts/generate";
import { readFile, saveFile } from "@/lib/files/storage";
import { loadEstimateBrand } from "@/lib/pdf/brand";
import { renderCustomerContractPdf } from "@/lib/pdf/customer-contract";
import type { EstimateInput, RoofTypeLine } from "@/lib/estimates/calc";
import { getPublishedVersion } from "./templates";
import { buildContractSnapshot, validateContractSnapshot, type EstimateForContract, type RoofEstimateForContract } from "./snapshot";
import { canDelete, canRegenerate, canVoid, type ContractFailure } from "./state";
import type { CustomerContractSnapshot, PaymentScheduleItem } from "./types";

export const CONTRACT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateContractToken(): string {
  return randomBytes(32).toString("hex");
}
export function contractTokenExpiry(now = new Date()): Date {
  return new Date(now.getTime() + CONTRACT_TOKEN_TTL_MS);
}
export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}
export function contractNumberFor(jobNumber: string, n: number): string {
  return `${jobNumber}-C${n}`;
}
export function contractFileName(contractNumber: string, version: number, signed: boolean): string {
  return `${contractNumber}-v${version}${signed ? "-signed" : ""}.pdf`;
}

export class ContractError extends Error {
  constructor(
    public readonly reason: ContractFailure,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ContractError";
  }
}

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
} satisfies Prisma.LeadSelect;

export const CONTRACT_LIST_SELECT = {
  id: true,
  jobId: true,
  leadId: true,
  number: true,
  contractNumber: true,
  status: true,
  contractAmount: true,
  depositAmount: true,
  paymentSchedule: true,
  snapshotVersion: true,
  estimateId: true,
  roofEstimateId: true,
  tokenExpiresAt: true,
  sentAt: true,
  sentToEmail: true,
  unsignedPdfSha256: true,
  signedAt: true,
  signerName: true,
  signerEmail: true,
  signerIp: true,
  signerUserAgent: true,
  consentAt: true,
  signedPdfSha256: true,
  moneyAppliedAt: true,
  moneyApplyNote: true,
  declinedAt: true,
  declineReason: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  updatedAt: true,
  templateVersion: { select: { id: true, version: true, title: true, template: { select: { key: true, name: true } } } },
  estimate: { select: { id: true, estimateNumber: true, name: true, status: true } },
  roofEstimate: { select: { id: true, estimateNumber: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  sentBy: { select: { id: true, firstName: true, lastName: true } },
  voidedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.CustomerContractSelect;

export type ContractListRow = Prisma.CustomerContractGetPayload<{ select: typeof CONTRACT_LIST_SELECT }>;

export async function listContractsForJob(jobId: string): Promise<ContractListRow[]> {
  return prisma.customerContract.findMany({ where: { jobId }, orderBy: { number: "desc" }, select: CONTRACT_LIST_SELECT });
}

export const CONTRACT_INCLUDE = {
  job: { select: { id: true, jobNumber: true, title: true, serviceType: true, jobType: true, billingMethod: true, leadId: true, salesRepId: true, projectManagerId: true, lead: { select: { ...LEAD_FIELDS, id: true } } } },
  templateVersion: { select: { id: true, version: true, title: true, consentText: true, template: { select: { key: true, name: true } } } },
  estimate: { select: { id: true, estimateNumber: true, name: true, status: true } },
  roofEstimate: { select: { id: true, estimateNumber: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  sentBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  documents: { orderBy: [{ documentType: "asc" }, { versionNumber: "desc" }], select: { id: true, documentType: true, versionNumber: true, fileName: true, storageKey: true, fileId: true, generatedAt: true } },
} satisfies Prisma.CustomerContractInclude;

export type ContractWithContext = Prisma.CustomerContractGetPayload<{ include: typeof CONTRACT_INCLUDE }>;

export async function getContract(id: string): Promise<ContractWithContext | null> {
  return prisma.customerContract.findUnique({ where: { id }, include: CONTRACT_INCLUDE });
}

export async function getContractByToken(token: string): Promise<ContractWithContext | null> {
  if (!token || token.length < 32) return null;
  return prisma.customerContract.findUnique({ where: { token }, include: CONTRACT_INCLUDE });
}

/** The current unsigned / signed PDF document row. */
export function currentDocument(c: ContractWithContext, kind: "unsigned" | "signed") {
  const type = kind === "signed" ? GeneratedDocumentType.CUSTOMER_CONTRACT_SIGNED : GeneratedDocumentType.CUSTOMER_CONTRACT;
  return c.documents.filter((d) => d.documentType === type).sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null;
}

export async function readContractPdf(c: ContractWithContext, kind: "unsigned" | "signed"): Promise<{ buffer: Buffer; fileName: string } | null> {
  const doc = currentDocument(c, kind);
  if (!doc) return null;
  return { buffer: await readFile(doc.storageKey), fileName: doc.fileName };
}

export function snapshotOf(c: { snapshot: unknown }): CustomerContractSnapshot {
  return c.snapshot as CustomerContractSnapshot;
}

// ─── Source loading ──────────────────────────────────────────────────────────

type Source =
  | { type: "ESTIMATE"; estimate: EstimateForContract; includeOptionalItemIds: string[] }
  | { type: "ROOF_ESTIMATE"; roofEstimate: RoofEstimateForContract };

async function loadSource(
  leadId: string,
  ref: { estimateId?: string | null; roofEstimateId?: string | null },
  includeOptionalItemIds: string[],
): Promise<Source> {
  if (ref.estimateId) {
    const e = await prisma.estimate.findFirst({
      where: { id: ref.estimateId, leadId },
      include: { sections: { orderBy: { sortOrder: "asc" }, include: { items: { orderBy: { sortOrder: "asc" } } } } },
    });
    if (!e) throw new NotFoundError("Estimate not found on this job's customer");
    return {
      type: "ESTIMATE",
      includeOptionalItemIds,
      estimate: {
        id: e.id,
        estimateNumber: e.estimateNumber,
        name: e.name,
        validityDays: e.validityDays,
        notes: e.notes,
        exclusions: e.exclusions,
        marginPercent: Number(e.marginPercent),
        discountEnabled: e.discountEnabled,
        discountPercent: Number(e.discountPercent),
        salesTaxPercent: Number(e.salesTaxPercent),
        sections: e.sections.map((s) => ({
          title: s.title,
          items: s.items.map((i) => ({ id: i.id, description: i.description, unitType: i.unitType, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), isOptional: i.isOptional, notes: i.notes })),
        })),
      },
    };
  }
  if (ref.roofEstimateId) {
    const r = await prisma.roofEstimate.findFirst({ where: { id: ref.roofEstimateId, leadId } });
    if (!r) throw new NotFoundError("Roofing estimate not found on this job's customer");
    const roofTypes = (Array.isArray(r.roofTypesJson) ? r.roofTypesJson : []) as unknown as RoofTypeLine[];
    const input: EstimateInput = {
      roofTypes: roofTypes.map((t) => ({ material: t.material, squares: Number(t.squares), laborRatePerSquare: Number(t.laborRatePerSquare) })),
      materialCost: Number(r.materialCost),
      materialSelection: r.materialSelection,
      permitFee: Number(r.permitFee),
      dumpsterFee: Number(r.dumpsterFee),
      tearOffFee: Number(r.tearOffFee),
      deckingFee: Number(r.deckingFee),
      underlaymentFee: Number(r.underlaymentFee),
      flashingVentFee: Number(r.flashingVentFee),
      skylightChimneyFee: Number(r.skylightChimneyFee),
      guttersFee: Number(r.guttersFee),
      miscLabel: r.miscLabel,
      miscFee: Number(r.miscFee),
      marginPercent: Number(r.marginPercent),
      discountEnabled: r.discountEnabled,
      discountPercent: Number(r.discountPercent),
      salesTaxPercent: Number(r.salesTaxPercent),
    };
    return {
      type: "ROOF_ESTIMATE",
      roofEstimate: {
        ...input,
        id: r.id,
        estimateNumber: r.estimateNumber,
        validityDays: r.validityDays,
        specialTerms: r.specialTerms,
        existingRoofType: r.existingRoofType,
        proposedRoofTypeOverride: r.proposedRoofTypeOverride,
        underlaymentType: r.underlaymentType,
        permitIncluded: r.permitIncluded,
        projectDurationText: r.projectDurationText,
        plywoodSheetsIncluded: r.plywoodSheetsIncluded,
        additionalPlywoodPrice: r.additionalPlywoodPrice != null ? Number(r.additionalPlywoodPrice) : null,
        workmanshipWarrantyYears: r.workmanshipWarrantyYears,
        manufacturerWarranty: r.manufacturerWarranty,
      },
    };
  }
  throw new ContractError("validation", "Provide exactly one source estimate");
}

async function loadJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, jobNumber: true, title: true, serviceType: true, jobType: true, billingMethod: true, leadId: true, lead: { select: LEAD_FIELDS } },
  });
  if (!job) throw new NotFoundError("Job not found");
  return job;
}

// ─── Generation ─────────────────────────────────────────────────────────────

/**
 * Build + validate + render + persist one unsigned document version. Shared
 * by create and regenerate. Returns everything the caller writes to the row.
 */
async function generateUnsigned(input: {
  job: Awaited<ReturnType<typeof loadJob>>;
  source: Source;
  templateKey?: string | null;
  scheduleOverride?: PaymentScheduleItem[] | null;
  contractNumber: string;
  versionNumber: number;
  now: Date;
}) {
  const [{ template, version, content }, brand] = await Promise.all([getPublishedVersion(input.templateKey), loadEstimateBrand()]);
  const snapshot = buildContractSnapshot({
    generatedAt: input.now,
    versionNumber: input.versionNumber,
    contractNumber: input.contractNumber,
    job: { jobNumber: input.job.jobNumber, title: input.job.title, serviceType: input.job.serviceType },
    lead: input.job.lead as LeadLike,
    brand,
    source: input.source,
    template: { key: template.key, version: version.version, versionId: version.id, content },
    scheduleOverride: input.scheduleOverride ?? null,
  });
  const problems = validateContractSnapshot(snapshot);
  if (problems.length > 0) throw new MissingFieldsError(problems);

  const pdf = await renderCustomerContractPdf(snapshot);
  const fileName = contractFileName(input.contractNumber, input.versionNumber, false);
  const stored = await saveFile(pdf, fileName);
  return { snapshot, pdf, fileName, stored, templateVersionId: version.id };
}

export type CreateContractInput = {
  jobId: string;
  userId: string;
  source: { estimateId?: string | null; roofEstimateId?: string | null; includeOptionalItemIds?: string[] };
  templateKey?: string | null;
  paymentSchedule?: PaymentScheduleItem[] | null;
};

export async function createContractDraft(input: CreateContractInput): Promise<{ contractId: string; contractNumber: string; documentId: string }> {
  const job = await loadJob(input.jobId);
  const source = await loadSource(job.leadId, input.source, input.source.includeOptionalItemIds ?? []);
  const now = new Date();

  // Number inside the transaction; the (jobId, number) unique index backstops a race.
  return prisma.$transaction(async (tx) => {
    const last = await tx.customerContract.findFirst({ where: { jobId: job.id }, orderBy: { number: "desc" }, select: { number: true } });
    const number = (last?.number ?? 0) + 1;
    const contractNumber = contractNumberFor(job.jobNumber, number);
    const gen = await generateUnsigned({ job, source, templateKey: input.templateKey, scheduleOverride: input.paymentSchedule, contractNumber, versionNumber: 1, now });

    const file = await tx.file.create({
      data: { leadId: job.leadId, fileName: gen.fileName, fileType: "application/pdf", fileSize: gen.stored.bytes, storageKey: gen.stored.storageKey, category: FileCategory.CUSTOMER_CONTRACT, uploadedByUserId: input.userId },
      select: { id: true },
    });
    const contract = await tx.customerContract.create({
      data: {
        jobId: job.id,
        leadId: job.leadId,
        number,
        contractNumber,
        templateVersionId: gen.templateVersionId,
        estimateId: source.type === "ESTIMATE" ? source.estimate.id : null,
        roofEstimateId: source.type === "ROOF_ESTIMATE" ? source.roofEstimate.id : null,
        contractAmount: gen.snapshot.price.total,
        depositAmount: gen.snapshot.depositAmount,
        paymentSchedule: gen.snapshot.paymentSchedule as unknown as Prisma.InputJsonValue,
        snapshot: gen.snapshot as unknown as Prisma.InputJsonValue,
        snapshotVersion: 1,
        createdByUserId: input.userId,
      },
      select: { id: true },
    });
    const doc = await tx.generatedDocument.create({
      data: {
        jobId: job.id,
        customerContractId: contract.id,
        documentType: GeneratedDocumentType.CUSTOMER_CONTRACT,
        versionNumber: 1,
        fileName: gen.fileName,
        storageKey: gen.stored.storageKey,
        fileId: file.id,
        generatedByUserId: input.userId,
        sourceDataSnapshot: gen.snapshot as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await tx.activityLog.create({
      data: {
        leadId: job.leadId,
        activityType: "NOTE",
        title: `Contract ${contractNumber} drafted from ${gen.snapshot.source.estimateNumber}`,
        description: `Contract price $${gen.snapshot.price.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        createdByUserId: input.userId,
      },
    });
    await recordAudit({ actorUserId: input.userId, entityType: "CustomerContract", entityId: contract.id, action: "create", after: { contractNumber, total: gen.snapshot.price.total, source: gen.snapshot.source } });
    return { contractId: contract.id, contractNumber, documentId: doc.id };
  });
}

export async function regenerateContract(
  id: string,
  userId: string,
  opts: { includeOptionalItemIds?: string[]; templateKey?: string | null; paymentSchedule?: PaymentScheduleItem[] | null } = {},
): Promise<{ documentId: string; versionNumber: number }> {
  const c = await getContract(id);
  if (!c) throw new NotFoundError("Contract not found");
  if (!canRegenerate(c)) throw new ContractError("not_draft", "Only a draft can be regenerated — void it and create a new one instead");
  const job = await loadJob(c.jobId);
  const prev = snapshotOf(c);
  const includeOptional = opts.includeOptionalItemIds ?? prev.source.includeOptionalItemIds ?? [];
  const source = await loadSource(job.leadId, { estimateId: c.estimateId, roofEstimateId: c.roofEstimateId }, includeOptional);
  const versionNumber = c.documents.filter((d) => d.documentType === GeneratedDocumentType.CUSTOMER_CONTRACT).length + 1;
  const gen = await generateUnsigned({
    job,
    source,
    templateKey: opts.templateKey ?? c.templateVersion.template.key,
    scheduleOverride: opts.paymentSchedule === undefined ? (prev.paymentSchedule as PaymentScheduleItem[]) : opts.paymentSchedule,
    contractNumber: c.contractNumber,
    versionNumber,
    now: new Date(),
  });

  return prisma.$transaction(async (tx) => {
    const file = await tx.file.create({
      data: { leadId: c.leadId, fileName: gen.fileName, fileType: "application/pdf", fileSize: gen.stored.bytes, storageKey: gen.stored.storageKey, category: FileCategory.CUSTOMER_CONTRACT, uploadedByUserId: userId },
      select: { id: true },
    });
    const doc = await tx.generatedDocument.create({
      data: {
        jobId: c.jobId,
        customerContractId: c.id,
        documentType: GeneratedDocumentType.CUSTOMER_CONTRACT,
        versionNumber,
        fileName: gen.fileName,
        storageKey: gen.stored.storageKey,
        fileId: file.id,
        generatedByUserId: userId,
        sourceDataSnapshot: gen.snapshot as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await tx.customerContract.update({
      where: { id: c.id },
      data: {
        templateVersionId: gen.templateVersionId,
        contractAmount: gen.snapshot.price.total,
        depositAmount: gen.snapshot.depositAmount,
        paymentSchedule: gen.snapshot.paymentSchedule as unknown as Prisma.InputJsonValue,
        snapshot: gen.snapshot as unknown as Prisma.InputJsonValue,
        snapshotVersion: versionNumber,
      },
    });
    await recordAudit({ actorUserId: userId, entityType: "CustomerContract", entityId: c.id, action: "regenerate", before: { total: Number(c.contractAmount), version: c.snapshotVersion }, after: { total: gen.snapshot.price.total, version: versionNumber } });
    return { documentId: doc.id, versionNumber };
  });
}

export async function deleteDraftContract(id: string, userId: string): Promise<void> {
  const c = await prisma.customerContract.findUnique({ where: { id }, select: { id: true, status: true, contractNumber: true, leadId: true, contractAmount: true } });
  if (!c) throw new NotFoundError("Contract not found");
  if (!canDelete(c)) throw new ContractError("not_draft", "Only a draft can be deleted — void it instead");
  await prisma.customerContract.delete({ where: { id } }); // documents SetNull; the PDFs stay in Files
  await recordAudit({ actorUserId: userId, entityType: "CustomerContract", entityId: id, action: "delete", before: { contractNumber: c.contractNumber, total: Number(c.contractAmount) } });
}

/**
 * Void a DRAFT or SENT contract: the link dies immediately. Voiding a SIGNED
 * contract (Stage 3) additionally reverses the money it applied.
 */
export async function voidContract(id: string, userId: string, reason: string): Promise<{ ok: true; reversedMoney: boolean } | { ok: false; reason: "already_void" | "not_found" }> {
  const c = await prisma.customerContract.findUnique({ where: { id }, select: { id: true, status: true, contractNumber: true, leadId: true, token: true } });
  if (!c) return { ok: false, reason: "not_found" };
  if (c.status === "VOID") return { ok: false, reason: "already_void" };
  if (!canVoid(c)) throw new ContractError("validation", `A ${c.status.toLowerCase()} contract cannot be voided`);
  if (c.status === "SIGNED") throw new ContractError("validation", "Voiding a signed contract is not available yet");

  await prisma.$transaction(async (tx) => {
    await tx.customerContract.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidedByUserId: userId, voidReason: reason, token: null, tokenExpiresAt: null } });
    await tx.activityLog.create({ data: { leadId: c.leadId, activityType: "NOTE", title: `Contract ${c.contractNumber} voided`, description: reason, createdByUserId: userId } });
  });
  await recordAudit({ actorUserId: userId, entityType: "CustomerContract", entityId: id, action: "void", before: { status: c.status }, after: { reason } });
  logger.info("customer contract voided", { contractId: id, from: c.status });
  return { ok: true, reversedMoney: false };
}
