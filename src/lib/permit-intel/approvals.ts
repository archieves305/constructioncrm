import { createHash } from "node:crypto";
import { Prisma, type RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { runAiCall } from "@/lib/ai/calls";
import { AI_NOT_CONFIGURED, AiError, defaultModel, isAiConfigured } from "@/lib/ai/client";
import { fileExists, readFile, saveFile } from "@/lib/files/storage";
import { readPdfText } from "@/lib/files/pdf-text";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { logger } from "@/lib/logger";
import { assigneeFor } from "@/lib/permits/alert-run";
import { closeAutoTask } from "@/lib/tasks/auto-tasks";
import { createTask } from "@/lib/tasks/create";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { dayKey, pinAllDay } from "@/lib/time/zone";
import { approvalAlert, approvalFromExtraction, AUTHORITY_LABEL, checkProduct, normalizeNumber, type ApprovalData } from "./approvals-plan";
import * as extract from "./prompts/approval-extract";
import { PermitIntelError } from "./service";

/**
 * The product approval repository: FL Product Approvals and Miami-Dade NOAs,
 * each read once from its document (the AI proposes the fields with their
 * page and quote; a person checks them), linked to roofing materials and to
 * the permits that use them. On a permit the approval is checked against the
 * jurisdiction and the engineer's required pressures — advisory only — and
 * its document can be copied among the permit's documents for the package.
 */
type Actor = { id: string; role: RoleName };

const audit = (actor: { id: string } | null, id: string, action: string, before?: unknown, after?: unknown) =>
  recordAudit({ actorUserId: actor?.id ?? null, entityType: "ProductApproval", entityId: id, action, before, after });

const READ_STALE_MS = 5 * 60 * 1000;
const MAX_READS = 3;
/** The API takes a request of 32 MB; base64 grows a file by a third. */
const MAX_BYTES = 22 * 1024 * 1024;

export const approvalLabel = (a: { approvalNumber: string | null; revision: string | null; productName: string | null; manufacturer: string | null; authority: keyof typeof AUTHORITY_LABEL }) =>
  [a.approvalNumber ? `${a.approvalNumber}${a.revision ? ` ${a.revision}` : ""}` : AUTHORITY_LABEL[a.authority], a.productName, a.manufacturer ? `(${a.manufacturer})` : null].filter(Boolean).join(" ");

export async function createApproval(file: { name: string; bytes: Buffer }, actor: Actor) {
  if (file.bytes.subarray(0, 5).toString() !== "%PDF-") throw new PermitIntelError(400, "Upload the approval as a PDF");
  if (file.bytes.length > MAX_BYTES) throw new PermitIntelError(400, "The document is over 22 MB; upload the approval without its drawings appendix");
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const same = await prisma.productApproval.findFirst({ where: { sha256, isActive: true }, select: { id: true, approvalNumber: true, productName: true } });
  if (same) throw new PermitIntelError(409, `This document is already in the repository${same.approvalNumber ? ` (${same.approvalNumber}${same.productName ? `, ${same.productName}` : ""})` : ""}.`);
  const stored = await saveFile(file.bytes, file.name);
  const ai = isAiConfigured();
  const a = await prisma.productApproval.create({
    data: { fileName: file.name, storageKey: stored.storageKey, sha256, sizeBytes: stored.bytes, readState: ai ? "EXTRACTING" : "FAILED", readError: ai ? null : `${AI_NOT_CONFIGURED}. Fill in the fields by hand.`, createdByUserId: actor.id },
  });
  await audit(actor, a.id, "create", undefined, { fileName: file.name, sha256 });
  return a;
}

/** The AI reads the document (after the answer). Claimed first; never throws. */
export async function runApprovalRead(id: string, userId: string | null): Promise<void> {
  const now = new Date();
  const claim = await prisma.productApproval.updateMany({
    where: { id, readState: "EXTRACTING", attempts: { lt: MAX_READS }, OR: [{ readStartedAt: null }, { readStartedAt: { lt: new Date(now.getTime() - READ_STALE_MS) } }] },
    data: { readStartedAt: now, attempts: { increment: 1 } },
  });
  if (!claim.count) return;
  const fail = (message: string) => prisma.productApproval.update({ where: { id }, data: { readState: "FAILED", readError: message.slice(0, 500) } });
  try {
    const a = await prisma.productApproval.findUniqueOrThrow({ where: { id }, select: { storageKey: true, fileName: true, sha256: true } });
    let bytes: Buffer;
    try {
      bytes = await readFile(a.storageKey);
    } catch {
      return void (await fail("The document is missing from the store. Upload it again."));
    }
    const text = await readPdfText(bytes, 1);
    const r = await runAiCall({
      subjectType: "product_approval",
      subjectId: id,
      purpose: extract.PURPOSE,
      promptVersion: extract.PROMPT_VERSION,
      schema: extract.schema,
      inputs: { sha256: a.sha256 },
      system: extract.SYSTEM,
      content: extract.content(bytes.toString("base64"), a.fileName),
      model: defaultModel(),
      effort: "medium",
      maxTokens: 24_000,
      userId,
    });
    if (!r.output.isApproval) return void (await fail("This does not look like a product approval, NOA or evaluation report. Check the file, or fill in the fields by hand."));
    const d = approvalFromExtraction(r.output, text?.pageCount ?? null);
    await prisma.productApproval.update({ where: { id }, data: { ...dataOf(d), readState: "REVIEW", readError: null, aiCallId: r.callId } });
  } catch (err) {
    if (!(err instanceof AiError)) logger.exception(err, { where: "approvals.runApprovalRead", approvalId: id });
    await fail(err instanceof AiError ? err.message : "The document could not be read. Read it again, or fill in the fields by hand.").catch(() => undefined);
  }
}

function dataOf(d: Partial<ApprovalData>): Prisma.ProductApprovalUncheckedUpdateInput {
  const out: Prisma.ProductApprovalUncheckedUpdateInput = { ...d } as Prisma.ProductApprovalUncheckedUpdateInput;
  if (d.configurations !== undefined) out.configurations = d.configurations ? (d.configurations as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
  if (d.evidence !== undefined) out.evidence = d.evidence as unknown as Prisma.InputJsonValue;
  return out;
}

export async function requestReread(id: string, actor: Actor) {
  const a = await prisma.productApproval.findUnique({ where: { id }, select: { readState: true } });
  if (!a) throw new PermitIntelError(404, "Approval not found");
  if (a.readState === "EXTRACTING") throw new PermitIntelError(409, "The document is being read now");
  if (a.readState === "VERIFIED") throw new PermitIntelError(409, "A checked approval is not read again; edit its fields instead");
  if (!isAiConfigured()) throw new AiError(AI_NOT_CONFIGURED, 503, "not_configured");
  await prisma.productApproval.update({ where: { id }, data: { readState: "EXTRACTING", readError: null, readStartedAt: null, attempts: 0 } });
  await audit(actor, id, "reread");
}

export function readIsStale(a: { readState: string; readStartedAt: Date | null; attempts: number }): boolean {
  return a.readState === "EXTRACTING" && a.attempts < MAX_READS && (!a.readStartedAt || Date.now() - a.readStartedAt.getTime() > READ_STALE_MS);
}

/** A person's corrections. An approval that was checked stays checked: the person editing it is checking it. */
export async function updateApproval(id: string, patch: Partial<ApprovalData> & { notes?: string | null; isActive?: boolean }, actor: Actor) {
  const before = await prisma.productApproval.findUnique({ where: { id }, select: { readState: true, expiresAt: true, approvalNumber: true } });
  if (!before) throw new PermitIntelError(404, "Approval not found");
  if (before.readState === "EXTRACTING") throw new PermitIntelError(409, "The document is being read now");
  // a pressure is stored as the document states it: positive up, uplift negative, whatever sign was typed
  if (patch.designPressurePos != null) patch = { ...patch, designPressurePos: Math.abs(patch.designPressurePos) };
  if (patch.designPressureNeg != null) patch = { ...patch, designPressureNeg: -Math.abs(patch.designPressureNeg) };
  const a = await prisma.productApproval.update({ where: { id }, data: dataOf(patch) });
  await audit(actor, id, "update", { expiresAt: before.expiresAt, approvalNumber: before.approvalNumber }, { fields: Object.keys(patch) });
  if (patch.expiresAt !== undefined || patch.isActive !== undefined) await settleApprovalAlerts(id, actor.id);
  return a;
}

export async function verifyApproval(id: string, actor: Actor) {
  const a = await prisma.productApproval.findUnique({ where: { id }, select: { readState: true, approvalNumber: true, productName: true, manufacturer: true } });
  if (!a) throw new PermitIntelError(404, "Approval not found");
  if (a.readState === "EXTRACTING") throw new PermitIntelError(409, "The document is being read now");
  if (!a.approvalNumber || !(a.productName || a.manufacturer)) throw new PermitIntelError(400, "An approval needs its number and the product or manufacturer before it is marked checked");
  const u = await prisma.productApproval.update({ where: { id }, data: { readState: "VERIFIED", verifiedByUserId: actor.id, verifiedAt: new Date(), readError: null } });
  await audit(actor, id, "verify");
  return u;
}

export async function setMaterials(id: string, itemIds: string[], actor: Actor) {
  const ids = [...new Set(itemIds)];
  if (ids.length && (await prisma.roofMaterialItem.count({ where: { id: { in: ids } } })) !== ids.length) throw new PermitIntelError(400, "One of the materials does not exist");
  await prisma.$transaction([prisma.productApprovalMaterial.deleteMany({ where: { approvalId: id } }), prisma.productApprovalMaterial.createMany({ data: ids.map((roofMaterialItemId) => ({ approvalId: id, roofMaterialItemId })) })]);
  await audit(actor, id, "materials", undefined, { itemIds: ids });
}

export type ApprovalQuery = { q?: string | null; category?: string | null; authority?: string | null; hvhz?: boolean; expiring?: boolean; includeInactive?: boolean };

export async function listApprovals(query: ApprovalQuery) {
  const q = query.q?.trim();
  // a model name matches in part and in any case ("polystick" finds "Polystick XFR"); Prisma's array filters match whole names only
  const byModel = q ? (await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM product_approvals WHERE EXISTS (SELECT 1 FROM unnest(models) m WHERE m ILIKE ${`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}) LIMIT 300`)).map((r) => r.id) : [];
  const where: Prisma.ProductApprovalWhereInput = {
    ...(query.includeInactive ? {} : { isActive: true }),
    ...(query.category ? { category: query.category as never } : {}),
    ...(query.authority ? { authority: query.authority as never } : {}),
    ...(query.hvhz ? { hvhzApproved: true } : {}),
    ...(query.expiring ? { expiresAt: { not: null, lte: new Date(Date.now() + 60 * 86_400_000) } } : {}),
    ...(q
      ? {
          OR: [
            { approvalNumber: { contains: q, mode: "insensitive" } },
            { approvalNumber: { contains: normalizeNumber(q), mode: "insensitive" } },
            { manufacturer: { contains: q, mode: "insensitive" } },
            { productName: { contains: q, mode: "insensitive" } },
            ...(byModel.length ? [{ id: { in: byModel } }] : []),
            { fileName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  return prisma.productApproval.findMany({
    where,
    orderBy: [{ readState: "asc" }, { manufacturer: "asc" }, { productName: "asc" }],
    take: 300,
    select: { id: true, authority: true, approvalNumber: true, revision: true, manufacturer: true, productName: true, category: true, hvhzApproved: true, designPressurePos: true, designPressureNeg: true, expiresAt: true, readState: true, isActive: true, fileName: true, _count: { select: { permits: true, materials: true } } },
  });
}

export async function loadApproval(id: string) {
  const a = await prisma.productApproval.findUnique({
    where: { id },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      verifiedBy: { select: { firstName: true, lastName: true } },
      materials: { select: { item: { select: { id: true, name: true, category: true } } } },
      permits: { orderBy: { createdAt: "desc" }, select: { id: true, usedAs: true, permit: { select: { id: true, permitType: true, municipality: true, status: true, job: { select: JOB_LABEL_SELECT } } } } },
    },
  });
  if (!a) return null;
  const { storageKey: _k, ...rest } = a;
  void _k;
  const call = a.aiCallId ? await prisma.aiCall.findUnique({ where: { id: a.aiCallId }, select: { costUsd: true, model: true } }) : null;
  return { ...rest, aiCall: call };
}

export async function approvalBytes(id: string) {
  const a = await prisma.productApproval.findUnique({ where: { id }, select: { storageKey: true, fileName: true } });
  if (!a) throw new PermitIntelError(404, "Approval not found");
  try {
    return { bytes: await readFile(a.storageKey), fileName: a.fileName };
  } catch {
    throw new PermitIntelError(404, "The approval document is missing from the store");
  }
}

// ─── On a permit ────────────────────────────────────────────────────────────

const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

export async function listPermitProducts(permitId: string, today: Date = new Date()) {
  const permit = await prisma.jobPermit.findUnique({ where: { id: permitId }, select: { expectedApprovalDate: true, jurisdiction: { select: { hvhz: true } } } });
  if (!permit) throw new PermitIntelError(404, "Permit not found");
  const rows = await prisma.permitProduct.findMany({
    where: { permitId },
    orderBy: { createdAt: "asc" },
    include: {
      approval: { select: { id: true, authority: true, approvalNumber: true, revision: true, manufacturer: true, productName: true, category: true, hvhzApproved: true, designPressurePos: true, designPressureNeg: true, expiresAt: true, readState: true, isActive: true } },
      documentFile: { select: { id: true, fileName: true, storageKey: true } },
    },
  });
  return Promise.all(
    rows.map(async (r) => {
      const inPackage = !!r.documentFile && (await fileExists(r.documentFile.storageKey));
      const flags = checkProduct({
        approval: { ...r.approval, designPressurePos: num(r.approval.designPressurePos), designPressureNeg: num(r.approval.designPressureNeg) },
        use: { requiredPressurePos: num(r.requiredPressurePos), requiredPressureNeg: num(r.requiredPressureNeg) },
        permit: { hvhz: !!permit.jurisdiction?.hvhz, expectedApprovalDate: permit.expectedApprovalDate },
        inPackage,
        today,
      });
      const { documentFile, ...rest } = r;
      return { ...rest, documentFile: documentFile ? { id: documentFile.id, fileName: documentFile.fileName } : null, inPackage, flags, label: approvalLabel(r.approval) };
    }),
  );
}

export type PermitProductInput = { approvalId: string; usedAs?: string; requiredPressurePos?: number | null; requiredPressureNeg?: number | null; notes?: string | null };

export async function addPermitProduct(permitId: string, input: PermitProductInput, actor: Actor) {
  const a = await prisma.productApproval.findUnique({ where: { id: input.approvalId }, select: { id: true, isActive: true } });
  if (!a) throw new PermitIntelError(400, "That approval does not exist");
  try {
    const p = await prisma.permitProduct.create({
      data: { permitId, approvalId: a.id, usedAs: input.usedAs?.trim() ?? "", requiredPressurePos: input.requiredPressurePos ?? null, requiredPressureNeg: input.requiredPressureNeg == null ? null : -Math.abs(input.requiredPressureNeg), notes: input.notes ?? null },
    });
    await recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: permitId, action: "permit_product_add", after: { permitProductId: p.id, approvalId: a.id, usedAs: p.usedAs } });
    await raiseApprovalAlerts(new Date(), { permitId });
    return p;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new PermitIntelError(409, "This product is already on the permit for that use");
    throw err;
  }
}

export async function updatePermitProduct(id: string, patch: Omit<Partial<PermitProductInput>, "approvalId">, actor: Actor) {
  const before = await prisma.permitProduct.findUnique({ where: { id }, select: { permitId: true } });
  if (!before) throw new PermitIntelError(404, "Product not found on the permit");
  const data: Prisma.PermitProductUncheckedUpdateInput = {};
  if (patch.usedAs !== undefined) data.usedAs = patch.usedAs.trim();
  if (patch.requiredPressurePos !== undefined) data.requiredPressurePos = patch.requiredPressurePos;
  if (patch.requiredPressureNeg !== undefined) data.requiredPressureNeg = patch.requiredPressureNeg == null ? null : -Math.abs(patch.requiredPressureNeg);
  if (patch.notes !== undefined) data.notes = patch.notes;
  const p = await prisma.permitProduct.update({ where: { id }, data });
  await recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: before.permitId, action: "permit_product_update", after: { permitProductId: id, fields: Object.keys(patch) } });
  return p;
}

export async function removePermitProduct(id: string, actor: Actor) {
  const p = await prisma.permitProduct.findUnique({ where: { id }, select: { permitId: true, approvalId: true } });
  if (!p) throw new PermitIntelError(404, "Product not found on the permit");
  await prisma.permitProduct.delete({ where: { id } });
  await recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: p.permitId, action: "permit_product_remove", before: { permitProductId: id, approvalId: p.approvalId } });
  await closeOpen(`approval:${p.approvalId}:${p.permitId}:`, new Set(), actor.id, "The product was removed from the permit");
}

/** Copy the approval document among the permit's documents, where a submission can include it. */
export async function attachApprovalDocument(permitProductId: string, actor: Actor) {
  const pp = await prisma.permitProduct.findUnique({
    where: { id: permitProductId },
    select: { id: true, permitId: true, documentFileId: true, approval: { select: { id: true, fileName: true, storageKey: true, approvalNumber: true, revision: true, productName: true, manufacturer: true, authority: true } }, permit: { select: { jobId: true, job: { select: { leadId: true } } } } },
  });
  if (!pp) throw new PermitIntelError(404, "Product not found on the permit");
  if (pp.documentFileId) {
    const f = await prisma.file.findUnique({ where: { id: pp.documentFileId }, select: { storageKey: true } });
    if (f && (await fileExists(f.storageKey))) throw new PermitIntelError(409, "The approval document is already among the permit's documents");
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(pp.approval.storageKey);
  } catch {
    throw new PermitIntelError(409, "The approval document is missing from the store");
  }
  const name = `${approvalLabel(pp.approval).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 140)}.pdf`;
  const stored = await saveFile(bytes, name);
  const file = await prisma.file.create({
    data: { leadId: pp.permit.job.leadId, jobId: pp.permit.jobId, permitId: pp.permitId, permitDocType: "product_approval", category: "PERMIT", fileName: name, fileType: "application/pdf", fileSize: stored.bytes, storageKey: stored.storageKey, uploadedByUserId: actor.id },
    select: { id: true, fileName: true },
  });
  await prisma.permitProduct.update({ where: { id: pp.id }, data: { documentFileId: file.id } });
  await recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: pp.permitId, action: "permit_product_document", after: { permitProductId: pp.id, fileId: file.id, approvalId: pp.approval.id } });
  return file;
}

// ─── Expiry tasks ───────────────────────────────────────────────────────────

const OPEN_PERMIT = { status: { notIn: ["FINAL", "EXPIRED", "DENIED"] }, job: { currentStage: { isClosed: false } } } satisfies Prisma.JobPermitWhereInput;

async function closeOpen(prefix: string, live: Set<string>, actorUserId: string | null, because: string) {
  const open = await prisma.task.findMany({ where: { sourceKey: { startsWith: prefix }, status: { in: [...OPEN_TASK_STATUSES] } }, select: { sourceKey: true } });
  for (const key of new Set(open.map((t) => t.sourceKey as string))) if (!live.has(key)) await closeAutoTask(key, { actorUserId, outcome: "COMPLETED", because });
}

/**
 * Daily (from the permit-aging cron) and whenever a product is added to a
 * permit: an approval expiring within 30 days, or lapsed, on an open permit
 * becomes a task for the permit's coordinator — once per approval, permit and
 * expiry date.
 */
export async function raiseApprovalAlerts(today: Date = new Date(), only?: { permitId?: string }): Promise<{ raised: number }> {
  let raised = 0;
  const rows = await prisma.permitProduct.findMany({
    where: { ...(only?.permitId ? { permitId: only.permitId } : {}), permit: OPEN_PERMIT, approval: { isActive: true, expiresAt: { not: null, lte: new Date(today.getTime() + 31 * 86_400_000) } } },
    select: { permitId: true, usedAs: true, approval: { select: { id: true, expiresAt: true, approvalNumber: true, revision: true, productName: true, manufacturer: true, authority: true } }, permit: { select: { id: true, jobId: true, assignedUserId: true, job: { select: { projectManagerId: true } } } } },
  });
  for (const r of rows) {
    try {
      const plan = approvalAlert({ id: r.approval.id, expiresAt: r.approval.expiresAt, label: approvalLabel(r.approval) }, r.permitId, today);
      if (!plan || (await prisma.task.findFirst({ where: { sourceKey: plan.sourceKey }, select: { id: true } }))) continue;
      const assignee = await assigneeFor("coordinator", { jobId: r.permit.jobId, permitId: r.permit.id, assignedUserId: r.permit.assignedUserId, projectManagerId: r.permit.job.projectManagerId });
      if (!assignee) continue;
      await createTask(
        {
          title: plan.title,
          description: `${r.usedAs ? `Used as ${r.usedAs} on this permit. ` : ""}Get the renewed approval from the manufacturer or supplier and add it to the product repository, or choose another product before the permit goes in.`,
          priority: plan.priority,
          dueAt: pinAllDay(plan.dueDay),
          allDay: true,
          assignedUserId: assignee,
          createdByUserId: assignee,
          jobId: r.permit.jobId,
          permitId: r.permit.id,
          source: "auto",
          sourceKey: plan.sourceKey,
        },
        { actorUserId: null, notify: "inline" },
      );
      raised++;
    } catch (err) {
      logger.exception(err, { where: "approvals.raiseApprovalAlerts", permitId: r.permitId, approvalId: r.approval.id });
    }
  }
  return { raised };
}

/** The expiry moved or the approval was set aside: tasks for another date close. Never throws. */
export async function settleApprovalAlerts(approvalId: string, actorUserId: string | null): Promise<void> {
  try {
    const a = await prisma.productApproval.findUnique({ where: { id: approvalId }, select: { expiresAt: true, isActive: true, permits: { select: { permitId: true } } } });
    const live = new Set<string>();
    if (a?.isActive && a.expiresAt) {
      const exp = dayKey(a.expiresAt);
      for (const p of a.permits) live.add(`approval:${approvalId}:${p.permitId}:expiring@${exp}`);
    }
    await closeOpen(`approval:${approvalId}:`, live, actorUserId, a?.isActive === false ? "The approval was set aside" : "The approval's expiration date changed");
  } catch (err) {
    logger.exception(err, { where: "approvals.settleApprovalAlerts", approvalId });
  }
}
