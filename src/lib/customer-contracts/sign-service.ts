// Send → sign / decline. The customer never touches the price: the signed
// PDF is re-rendered from the stored snapshot with the signature and a
// certificate page, and the conditional status write makes signing
// single-use under concurrent submits.

import { FileCategory, GeneratedDocumentType, type Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { logger } from "@/lib/logger";
import { NotFoundError } from "@/lib/contracts/generate";
import { saveFile } from "@/lib/files/storage";
import { renderCustomerContractPdf } from "@/lib/pdf/customer-contract";
import { recomputeJobBalance } from "@/lib/services/job-pricing";
import { closeAutoTask, ensureAutoTask, onEstimateTransition, sourceKeyFor } from "@/lib/tasks/auto-tasks";
import { createTask } from "@/lib/tasks/create";
import { runAfterResponse } from "@/lib/tasks/defer";
import { sendContractEmail, sendContractOutcomeInternalEmail, sendContractSignedCustomerEmail, signUrlFor } from "./email";
import {
  ContractError,
  contractFileName,
  contractTokenExpiry,
  generateContractToken,
  getContract,
  getContractByToken,
  readContractPdf,
  sha256,
  snapshotOf,
  type ContractWithContext,
} from "./service";
import { canResend, canSend, computeMoneyEffects, evaluateSignAttempt } from "./state";
import type { CustomerContractSnapshot } from "./types";

const MAX_SIGNATURE_BYTES = 512 * 1024;

async function issuedApplicationCount(jobId: string, tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<number> {
  return tx.invoice.count({ where: { jobId, applicationNumber: { not: null }, status: { notIn: ["DRAFT", "VOID"] } } });
}

export type SendOutcome = { ok: true; token: string; signUrl: string; emailed: boolean; sentTo: string; expiresAt: Date };

export async function sendContract(id: string, userId: string, opts: { to?: string | null; replyTo?: string | null; message?: string | null }): Promise<SendOutcome> {
  const c = await getContract(id);
  if (!c) throw new NotFoundError("Contract not found");
  const siblings = await prisma.customerContract.findMany({ where: { jobId: c.jobId }, select: { id: true, status: true } });
  const gate = canSend(c, siblings);
  if (!gate.ok) {
    const messages = {
      not_draft: `${c.contractNumber} is ${c.status.toLowerCase()} — only a draft can be sent`,
      signed_exists: "This job already has a signed contract. Void it before sending another.",
      sent_exists: "Another contract on this job is out for signature. Void it or wait for the customer.",
    } as const;
    throw new ContractError(gate.reason, messages[gate.reason]);
  }
  const to = (opts.to ?? c.job.lead.email ?? "").trim();
  if (!to) throw new ContractError("no_email", "The customer has no email address on file — add one to the lead or type one here");
  if (c.job.billingMethod === "PROGRESS" && (await issuedApplicationCount(c.jobId)) > 0) {
    throw new ContractError("applications_issued", "Payment applications have already been issued on this job; the signed price could not be applied to the schedule of values. Reconcile billing first.");
  }
  const pdf = await readContractPdf(c, "unsigned");
  if (!pdf) throw new ContractError("validation", "The contract has no PDF — regenerate it");

  const token = generateContractToken();
  const expiresAt = contractTokenExpiry();
  await prisma.customerContract.update({
    where: { id },
    data: { status: "SENT", token, tokenExpiresAt: expiresAt, sentAt: new Date(), sentToEmail: to, sentByUserId: userId, unsignedPdfSha256: sha256(pdf.buffer) },
  });

  let emailed = false;
  try {
    emailed = await sendContractEmail({ ...c, tokenExpiresAt: expiresAt }, pdf.buffer, { to, token, replyTo: opts.replyTo, message: opts.message });
  } catch (err) {
    logger.exception(err, { where: "contracts.send.email", contractId: id });
  }

  await prisma.activityLog.create({
    data: {
      leadId: c.leadId,
      activityType: "NOTE",
      title: `Contract ${c.contractNumber} sent for signature`,
      description: emailed ? `Emailed to ${to}` : `Marked sent — email not delivered; link shared manually (${to})`,
      createdByUserId: userId,
    },
  });
  await recordAudit({ actorUserId: userId, entityType: "CustomerContract", entityId: id, action: "send", after: { to, emailed, expiresAt, unsignedPdfSha256: sha256(pdf.buffer) } });
  runAfterResponse(async () => {
    await ensureAutoTask({ kind: "contract.sent", contractId: id }, userId);
  }, { where: "contracts.send.after", contractId: id });

  return { ok: true, token, signUrl: signUrlFor(token), emailed, sentTo: to, expiresAt };
}

/** Same email again with a fresh link; the old link stops working. */
export async function resendContract(id: string, userId: string, opts: { to?: string | null; replyTo?: string | null; message?: string | null }): Promise<SendOutcome> {
  const c = await getContract(id);
  if (!c) throw new NotFoundError("Contract not found");
  if (!canResend(c)) throw new ContractError("not_sent", `${c.contractNumber} is ${c.status.toLowerCase()} — only a contract out for signature can be resent`);
  const to = (opts.to ?? c.sentToEmail ?? c.job.lead.email ?? "").trim();
  if (!to) throw new ContractError("no_email", "No email address to send to");
  const pdf = await readContractPdf(c, "unsigned");
  if (!pdf) throw new ContractError("validation", "The contract has no PDF");

  const token = generateContractToken();
  const expiresAt = contractTokenExpiry();
  await prisma.customerContract.update({ where: { id }, data: { token, tokenExpiresAt: expiresAt, sentAt: new Date(), sentToEmail: to, sentByUserId: userId } });
  let emailed = false;
  try {
    emailed = await sendContractEmail({ ...c, tokenExpiresAt: expiresAt }, pdf.buffer, { to, token, replyTo: opts.replyTo, message: opts.message });
  } catch (err) {
    logger.exception(err, { where: "contracts.resend.email", contractId: id });
  }
  await prisma.activityLog.create({ data: { leadId: c.leadId, activityType: "NOTE", title: `Contract ${c.contractNumber} resent`, description: emailed ? `Emailed to ${to} with a new link` : `New link issued; email not delivered (${to})`, createdByUserId: userId } });
  await recordAudit({ actorUserId: userId, entityType: "CustomerContract", entityId: id, action: "resend", after: { to, emailed, expiresAt } });
  return { ok: true, token, signUrl: signUrlFor(token), emailed, sentTo: to, expiresAt };
}

export type SignInput = { name: string; email?: string | null; signaturePngDataUri: string; consentText?: string | null };
export type SignMeta = { ip: string | null; userAgent: string | null; now?: Date };
export type SignResult =
  | { ok: true; contractId: string; contractNumber: string; signedAt: Date }
  | { ok: false; reason: "not_found" | "expired" | "already_signed" | "already_decided" | "not_sent" | "validation"; message?: string };

function decodeSignature(dataUri: string): Buffer {
  const prefix = "data:image/png;base64,";
  if (!dataUri.startsWith(prefix)) throw new ContractError("validation", "Signature must be a PNG image");
  const buf = Buffer.from(dataUri.slice(prefix.length), "base64");
  if (buf.length < 200) throw new ContractError("validation", "Please draw your signature");
  if (buf.length > MAX_SIGNATURE_BYTES) throw new ContractError("validation", "Signature image is too large");
  // PNG magic bytes
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new ContractError("validation", "Signature must be a PNG image");
  return buf;
}

export async function signContract(token: string, input: SignInput, meta: SignMeta): Promise<SignResult> {
  const c = await getContractByToken(token);
  if (!c) return { ok: false, reason: "not_found" };
  const now = meta.now ?? new Date();
  const gate = evaluateSignAttempt(c, now);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  let png: Buffer;
  try {
    png = decodeSignature(input.signaturePngDataUri);
  } catch (err) {
    return { ok: false, reason: "validation", message: err instanceof Error ? err.message : "Invalid signature" };
  }
  const signerName = input.name.trim();
  const signerEmail = input.email?.trim() || c.sentToEmail || c.job.lead.email || null;
  const snapshot = snapshotOf(c);
  const consentText = snapshot.template.consentText;

  const sigStored = await saveFile(png, `signature-${c.contractNumber}.png`);
  const signedSnapshot: CustomerContractSnapshot = {
    ...snapshot,
    signature: {
      signerName,
      signerEmail,
      signedAt: now.toISOString(),
      consentAt: now.toISOString(),
      consentText,
      ip: meta.ip,
      userAgent: meta.userAgent,
      signatureDataUri: input.signaturePngDataUri,
      unsignedPdfSha256: c.unsignedPdfSha256 ?? "",
      tokenSha256: sha256(token),
      contractId: c.id,
      sentAt: (c.sentAt ?? now).toISOString(),
      sentToEmail: c.sentToEmail,
    },
  };
  const signedPdf = await renderCustomerContractPdf(signedSnapshot);
  const signedHash = sha256(signedPdf);
  const fileName = contractFileName(c.contractNumber, c.snapshotVersion, true);
  const pdfStored = await saveFile(signedPdf, fileName);

  let estimateFrom: string | null = null;
  let sovSkipped = false;
  let jobMeta: { projectManagerId: string | null; salesRepId: string | null } = { projectManagerId: null, salesRepId: null };

  const outcome = await prisma.$transaction(async (tx) => {
    // The single-use guard: only a SENT row flips, and only once.
    const flipped = await tx.customerContract.updateMany({
      where: { id: c.id, status: "SENT" },
      data: {
        status: "SIGNED",
        signedAt: now,
        signerName,
        signerEmail,
        signerIp: meta.ip,
        signerUserAgent: meta.userAgent ? meta.userAgent.slice(0, 1000) : null,
        consentText,
        consentAt: now,
        signatureStorageKey: sigStored.storageKey,
        signedPdfSha256: signedHash,
      },
    });
    if (flipped.count === 0) return "already_signed" as const;

    const file = await tx.file.create({
      data: { leadId: c.leadId, fileName, fileType: "application/pdf", fileSize: pdfStored.bytes, storageKey: pdfStored.storageKey, category: FileCategory.SIGNED_DOC, uploadedByUserId: c.createdByUserId },
      select: { id: true },
    });
    await tx.generatedDocument.create({
      data: {
        jobId: c.jobId,
        customerContractId: c.id,
        documentType: GeneratedDocumentType.CUSTOMER_CONTRACT_SIGNED,
        versionNumber: 1,
        fileName,
        storageKey: pdfStored.storageKey,
        fileId: file.id,
        generatedByUserId: c.createdByUserId,
        sourceDataSnapshot: signedSnapshot as unknown as Prisma.InputJsonValue,
      },
    });

    // Money.
    const job = await tx.job.findUniqueOrThrow({ where: { id: c.jobId }, select: { jobType: true, billingMethod: true, title: true, projectManagerId: true, salesRepId: true } });
    jobMeta = { projectManagerId: job.projectManagerId, salesRepId: job.salesRepId };
    const [coAgg, sovLines, issued] = await Promise.all([
      tx.changeOrder.aggregate({ _sum: { customerPrice: true }, where: { jobId: c.jobId, status: "APPROVED" } }),
      tx.sovLine.findMany({ where: { jobId: c.jobId }, select: { id: true, itemNo: true, changeOrderId: true, scheduledValue: true } }),
      issuedApplicationCount(c.jobId, tx),
    ]);
    const effect = computeMoneyEffects({
      jobType: job.jobType,
      billingMethod: job.billingMethod,
      jobTitle: job.title,
      contractTotal: Number(c.contractAmount),
      depositAmount: Number(c.depositAmount),
      approvedChangeOrderTotal: Number(coAgg._sum.customerPrice ?? 0),
      sovLines: sovLines.map((l) => ({ ...l, scheduledValue: Number(l.scheduledValue) })),
      issuedApplicationCount: issued,
    });
    await tx.job.update({
      where: { id: c.jobId },
      data: { depositRequired: effect.depositRequired, ...(effect.contractAmount != null ? { contractAmount: effect.contractAmount } : {}) },
    });
    if (effect.sov.action === "create") {
      await tx.sovLine.create({ data: { jobId: c.jobId, itemNo: effect.sov.itemNo, description: effect.sov.description, scheduledValue: effect.sov.scheduledValue, sortOrder: effect.sov.itemNo - 1 } });
    } else if (effect.sov.action === "update") {
      await tx.sovLine.update({ where: { id: effect.sov.lineId }, data: { scheduledValue: effect.sov.scheduledValue } });
    } else if (effect.sov.action === "skip") {
      sovSkipped = true;
    }
    const moneyApplied = effect.contractAmount != null || effect.sov.action === "create" || effect.sov.action === "update";
    await tx.customerContract.update({ where: { id: c.id }, data: { moneyAppliedAt: moneyApplied ? now : null, moneyApplyNote: effect.notes.join(" ") || null } });

    // The estimate it came from is, by definition, accepted.
    if (c.estimate && c.estimate.status !== "ACCEPTED") {
      estimateFrom = c.estimate.status;
      await tx.estimate.update({ where: { id: c.estimate.id }, data: { status: "ACCEPTED" } });
    }

    await tx.activityLog.create({
      data: {
        leadId: c.leadId,
        activityType: "NOTE",
        title: `Contract ${c.contractNumber} signed by ${signerName}`,
        description: `${money(Number(c.contractAmount))} · deposit ${money(Number(c.depositAmount))}${effect.notes.length ? ` · ${effect.notes.join(" ")}` : ""}`,
      },
    });
    return "signed" as const;
  });

  if (outcome === "already_signed") return { ok: false, reason: "already_signed" };

  await recomputeJobBalance(c.jobId);
  await recordAudit({
    actorUserId: null,
    entityType: "CustomerContract",
    entityId: c.id,
    action: "sign",
    after: { signerName, signerEmail, signedAt: now, unsignedPdfSha256: c.unsignedPdfSha256, signedPdfSha256: signedHash, tokenSha256: sha256(token) },
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });

  const from = estimateFrom;
  const skipped = sovSkipped;
  const notifyTo = [c.sentBy?.email, c.createdBy.email].filter((e): e is string => Boolean(e));
  runAfterResponse(async () => {
    await closeAutoTask(sourceKeyFor({ kind: "contract.sent", contractId: c.id }), { actorUserId: null, outcome: "COMPLETED", because: `signed by ${signerName}` });
    if (from && c.estimate) await onEstimateTransition(c.estimate.id, from as "DRAFT" | "SENT" | "DECLINED", "ACCEPTED", c.createdByUserId);
    if (skipped) {
      await createTask(
        {
          jobId: c.jobId,
          leadId: c.leadId,
          title: `Reconcile schedule of values with signed contract ${c.contractNumber}`,
          description: `The customer signed for ${money(Number(c.contractAmount))} but the schedule of values was left unchanged. Redistribute it on the Invoices tab.`,
          assignedUserId: jobMeta.projectManagerId ?? c.sentBy?.id ?? c.createdByUserId,
          createdByUserId: c.sentBy?.id ?? c.createdByUserId,
          dueAt: new Date(now.getTime() + 2 * 86_400_000),
          priority: "HIGH",
          source: "auto",
        },
        { actorUserId: c.sentBy?.id ?? c.createdByUserId },
      );
    }
    const fresh = await getContract(c.id);
    if (!fresh) return;
    if (signerEmail) {
      try {
        await sendContractSignedCustomerEmail(fresh, signedPdf, signerEmail);
      } catch (err) {
        logger.exception(err, { where: "contracts.sign.customerEmail", contractId: c.id });
      }
    }
    await sendContractOutcomeInternalEmail(fresh, "signed", [...new Set(notifyTo)], signedPdf);
  }, { where: "contracts.sign.after", contractId: c.id });

  return { ok: true, contractId: c.id, contractNumber: c.contractNumber, signedAt: now };
}

export async function declineContract(token: string, input: { name: string; reason?: string | null }, meta: SignMeta): Promise<{ ok: true } | { ok: false; reason: "not_found" | "expired" | "already_signed" | "already_decided" | "not_sent" }> {
  const c = await getContractByToken(token);
  if (!c) return { ok: false, reason: "not_found" };
  const now = meta.now ?? new Date();
  const gate = evaluateSignAttempt(c, now);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const name = input.name.trim();
  const reason = input.reason?.trim() || null;
  const flipped = await prisma.customerContract.updateMany({
    where: { id: c.id, status: "SENT" },
    data: { status: "DECLINED", declinedAt: now, declineReason: reason, signerName: name, signerIp: meta.ip, signerUserAgent: meta.userAgent ? meta.userAgent.slice(0, 1000) : null, token: null },
  });
  if (flipped.count === 0) return { ok: false, reason: "already_decided" };
  await prisma.activityLog.create({ data: { leadId: c.leadId, activityType: "NOTE", title: `Contract ${c.contractNumber} declined by ${name}`, description: reason ?? "No reason given" } });
  await recordAudit({ actorUserId: null, entityType: "CustomerContract", entityId: c.id, action: "decline", after: { name, reason }, ipAddress: meta.ip, userAgent: meta.userAgent });
  const notifyTo = [c.sentBy?.email, c.createdBy.email].filter((e): e is string => Boolean(e));
  runAfterResponse(async () => {
    await closeAutoTask(sourceKeyFor({ kind: "contract.sent", contractId: c.id }), { actorUserId: null, outcome: "CANCELLED", because: `declined by ${name}` });
    const fresh = await getContract(c.id);
    if (fresh) await sendContractOutcomeInternalEmail(fresh, "declined", [...new Set(notifyTo)]);
  }, { where: "contracts.decline.after", contractId: c.id });
  return { ok: true };
}

/** What the public page needs to decide what to show. Never includes the token. */
export type SigningView =
  | { kind: "not_found" }
  | { kind: "expired"; contract: PublicContractSummary }
  | { kind: "declined"; contract: PublicContractSummary; declinedAt: Date | null }
  | { kind: "signed"; contract: PublicContractSummary; signedAt: Date | null; signerName: string | null }
  | { kind: "ready"; contract: PublicContractSummary };

export type PublicContractSummary = {
  contractNumber: string;
  version: number;
  title: string;
  total: number;
  depositAmount: number;
  customer: { fullName: string; email: string | null; address: string };
  company: { name: string; licenses: string[] };
  job: { title: string; address: string };
  scopeSummary: { title: string; lineCount: number }[];
  paymentSchedule: { label: string; amount: number; trigger: string }[];
  offerExpiresAt: string;
  expiresAt: Date | null;
  consentText: string;
};

export function publicSummary(c: ContractWithContext): PublicContractSummary {
  const s = snapshotOf(c);
  const address = `${s.jobSite.line1}${s.jobSite.line2 ? `, ${s.jobSite.line2}` : ""}, ${s.jobSite.city}, ${s.jobSite.state} ${s.jobSite.zip}`;
  return {
    contractNumber: c.contractNumber,
    version: c.snapshotVersion,
    title: s.template.title,
    total: s.price.total,
    depositAmount: s.depositAmount,
    customer: { fullName: s.owner.name, email: c.sentToEmail ?? s.owner.email ?? null, address },
    company: { name: s.company.name, licenses: s.company.licenses },
    job: { title: s.job.title, address },
    scopeSummary: s.scope.sections.map((sec) => ({ title: sec.title, lineCount: sec.items.length })),
    paymentSchedule: s.paymentSchedule.map((r) => ({ label: r.label, amount: r.amount, trigger: r.trigger })),
    offerExpiresAt: s.validity.offerExpiresAt,
    expiresAt: c.tokenExpiresAt,
    consentText: s.template.consentText,
  };
}

export async function getContractForSigning(token: string, now: Date = new Date()): Promise<SigningView> {
  const c = await getContractByToken(token);
  if (!c || c.status === "VOID" || c.status === "DRAFT") return { kind: "not_found" };
  const contract = publicSummary(c);
  if (c.status === "SIGNED") return { kind: "signed", contract, signedAt: c.signedAt, signerName: c.signerName };
  if (c.status === "DECLINED") return { kind: "declined", contract, declinedAt: c.declinedAt };
  if (c.tokenExpiresAt && c.tokenExpiresAt.getTime() < now.getTime()) return { kind: "expired", contract };
  return { kind: "ready", contract };
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
