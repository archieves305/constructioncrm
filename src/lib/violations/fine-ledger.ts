import { Prisma, type CodeViolationFineEntryType, type RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { parseDueAt } from "@/lib/tasks/dates";
import { auditCase } from "./audit";
import { ViolationError } from "./errors";
import { recordCaseEvent } from "./events";

type Actor = { id: string; role: RoleName };

/**
 * The single write path for OFFICIAL fine figures. Every change is a ledger
 * row; the case's snapshot columns are mirrored from the ledger so
 * "official balance" always has a history. The system ESTIMATE lives in
 * fines.ts and is never written.
 */
export async function recordFineEntry(
  caseId: string,
  entry: { type: CodeViolationFineEntryType; amount?: string | null; effectiveAt: string; reference?: string | null; notes?: string | null; fileId?: string | null },
  actor: Actor,
) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { id: true, initialFine: true, adminCosts: true } });
  if (!c) throw new ViolationError(404, "Case not found");
  const effectiveAt = parseDueAt(entry.effectiveAt);
  const amount = entry.amount ?? null;
  const needsAmount: CodeViolationFineEntryType[] = ["OFFICIAL_BALANCE", "FINE_IMPOSED", "ADMIN_COST", "PAYMENT", "ACCRUAL_STARTED"];
  if (needsAmount.includes(entry.type) && (amount === null || Number.isNaN(Number(amount)))) throw new ViolationError(400, "This entry needs an amount");
  const row = await prisma.codeViolationFineEntry.create({
    data: { caseId, type: entry.type, amount, effectiveAt, reference: entry.reference ?? null, notes: entry.notes ?? null, fileId: entry.fileId ?? null, createdByUserId: actor.id },
  });

  // Mirror onto the case.
  const data: Prisma.CodeViolationCaseUncheckedUpdateInput = {};
  const now = new Date();
  switch (entry.type) {
    case "OFFICIAL_BALANCE":
      data.officialBalance = amount;
      data.officialBalanceAsOf = effectiveAt;
      break;
    case "PAYMENT": {
      const paid = await prisma.codeViolationFineEntry.aggregate({ where: { caseId, type: "PAYMENT" }, _sum: { amount: true } });
      data.amountPaid = paid._sum.amount ?? 0;
      break;
    }
    case "ACCRUAL_STARTED":
      data.dailyFine = amount;
      data.fineAccrualStartDate = effectiveAt;
      data.fineAccrualStoppedAt = null;
      data.fineTermsUpdatedAt = now;
      break;
    case "ACCRUAL_STOPPED":
      data.fineAccrualStoppedAt = effectiveAt;
      data.fineTermsUpdatedAt = now;
      break;
    case "FINE_IMPOSED":
      data.initialFine = new Prisma.Decimal(c.initialFine ?? 0).add(new Prisma.Decimal(amount ?? 0)).toDecimalPlaces(2);
      data.fineTermsUpdatedAt = now;
      break;
    case "ADMIN_COST":
      data.adminCosts = new Prisma.Decimal(c.adminCosts ?? 0).add(new Prisma.Decimal(amount ?? 0)).toDecimalPlaces(2);
      break;
    case "MITIGATION_REQUESTED":
      data.mitigationStatus = "REQUESTED";
      data.mitigationRequestedAmount = amount;
      data.mitigationRequestedAt = effectiveAt;
      break;
    case "MITIGATION_DECIDED":
      data.mitigationStatus = amount === null || Number(amount) <= 0 ? "DENIED" : "GRANTED";
      data.mitigationGrantedAmount = amount;
      data.mitigationDecidedAt = effectiveAt;
      break;
    case "LIEN_RECORDED":
      data.lienStatus = "RECORDED";
      data.lienAmount = amount;
      data.lienRecordedAt = effectiveAt;
      data.lienInstrumentNumber = entry.reference ?? null;
      break;
    case "LIEN_RELEASED":
      data.lienStatus = "RELEASED";
      data.lienReleasedAt = effectiveAt;
      data.lienReleaseInstrumentNumber = entry.reference ?? null;
      break;
    case "ADJUSTMENT":
    case "NOTE":
      break;
  }
  if (Object.keys(data).length > 0) await prisma.codeViolationCase.update({ where: { id: caseId }, data });

  const label = entry.type.toLowerCase().replace(/_/g, " ");
  await recordCaseEvent(prisma, {
    caseId,
    actorUserId: actor.id,
    type: entry.type === "LIEN_RECORDED" ? "LIEN_RECORDED" : entry.type === "LIEN_RELEASED" ? "LIEN_RELEASED" : "FINE_ENTRY",
    toValue: amount,
    body: `${label}${amount ? ` $${Number(amount).toLocaleString()}` : ""}${entry.reference ? ` · ${entry.reference}` : ""}${entry.notes ? ` — ${entry.notes}` : ""}`,
  });
  await auditCase({
    actorUserId: actor.id,
    entityType: "CodeViolationFineEntry",
    entityId: row.id,
    action: entry.type === "LIEN_RECORDED" ? "violation_lien_recorded" : entry.type === "LIEN_RELEASED" ? "violation_lien_released" : "violation_fine_entry",
    after: { caseId, type: entry.type, amount, effectiveAt: effectiveAt.toISOString(), reference: entry.reference ?? null },
    reason: entry.notes ?? null,
  });
  return row;
}

/** Direct edit of the fine terms (from intake corrections); every change stamps fineTermsUpdatedAt. */
export async function updateFineTerms(
  caseId: string,
  body: Partial<{ initialFine: string | null; dailyFine: string | null; accrualStartDate: string | null; accrualStoppedAt: string | null; adminCosts: string | null; mitigationStatus: Prisma.CodeViolationCaseUpdateInput["mitigationStatus"]; mitigationRequestedAmount: string | null; mitigationGrantedAmount: string | null; fineResolvedAt: string | null }>,
  actor: Actor,
) {
  const before = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { initialFine: true, dailyFine: true, fineAccrualStartDate: true, fineAccrualStoppedAt: true, adminCosts: true, mitigationStatus: true, mitigationRequestedAmount: true, mitigationGrantedAmount: true, fineResolvedAt: true } });
  if (!before) throw new ViolationError(404, "Case not found");
  const data: Prisma.CodeViolationCaseUncheckedUpdateInput = { fineTermsUpdatedAt: new Date() };
  if (body.initialFine !== undefined) data.initialFine = body.initialFine;
  if (body.dailyFine !== undefined) data.dailyFine = body.dailyFine;
  if (body.accrualStartDate !== undefined) data.fineAccrualStartDate = body.accrualStartDate ? parseDueAt(body.accrualStartDate) : null;
  if (body.accrualStoppedAt !== undefined) data.fineAccrualStoppedAt = body.accrualStoppedAt ? parseDueAt(body.accrualStoppedAt) : null;
  if (body.adminCosts !== undefined) data.adminCosts = body.adminCosts ?? 0;
  if (body.mitigationStatus !== undefined) data.mitigationStatus = body.mitigationStatus as never;
  if (body.mitigationRequestedAmount !== undefined) data.mitigationRequestedAmount = body.mitigationRequestedAmount;
  if (body.mitigationGrantedAmount !== undefined) data.mitigationGrantedAmount = body.mitigationGrantedAmount;
  if (body.fineResolvedAt !== undefined) data.fineResolvedAt = body.fineResolvedAt ? parseDueAt(body.fineResolvedAt) : null;
  const updated = await prisma.codeViolationCase.update({ where: { id: caseId }, data });
  await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "FINE_ENTRY", body: "Fine terms edited" });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCase", entityId: caseId, action: "violation_fine_terms_change", before, after: { ...body } });
  return updated;
}

/** ADMIN/MANAGER only (route): replace the system estimate with a figure and a reason. `null` clears it. */
export async function setFineOverride(caseId: string, amount: string | null, reason: string, actor: Actor) {
  const before = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { fineEstimateOverride: true, fineEstimateOverrideReason: true } });
  if (!before) throw new ViolationError(404, "Case not found");
  const updated = await prisma.codeViolationCase.update({
    where: { id: caseId },
    data: { fineEstimateOverride: amount, fineEstimateOverrideReason: amount === null ? null : reason, fineEstimateOverrideAt: amount === null ? null : new Date() },
  });
  await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "FINE_ENTRY", toValue: amount, body: amount === null ? `Estimate override cleared — ${reason}` : `Estimate overridden to $${Number(amount).toLocaleString()} — ${reason}` });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCase", entityId: caseId, action: "violation_fine_override", before: { amount: before.fineEstimateOverride?.toString() ?? null }, after: { amount, actorRole: actor.role }, reason });
  return updated;
}

export async function recordLien(caseId: string, body: { amount?: string | null; recordedAt: string; instrumentNumber?: string | null; bookPage?: string | null; fileId?: string | null; notes?: string | null }, actor: Actor) {
  const row = await recordFineEntry(caseId, { type: "LIEN_RECORDED", amount: body.amount ?? null, effectiveAt: body.recordedAt, reference: body.instrumentNumber ?? null, notes: body.notes ?? null, fileId: body.fileId ?? null }, actor);
  if (body.bookPage !== undefined) await prisma.codeViolationCase.update({ where: { id: caseId }, data: { lienBookPage: body.bookPage ?? null } });
  return row;
}

export async function releaseLien(caseId: string, body: { releasedAt: string; releaseInstrumentNumber?: string | null; fileId?: string | null; notes?: string | null }, actor: Actor) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { lienStatus: true } });
  if (!c) throw new ViolationError(404, "Case not found");
  if (c.lienStatus !== "RECORDED") throw new ViolationError(409, "No recorded lien to release");
  return recordFineEntry(caseId, { type: "LIEN_RELEASED", effectiveAt: body.releasedAt, reference: body.releaseInstrumentNumber ?? null, notes: body.notes ?? null, fileId: body.fileId ?? null }, actor);
}
