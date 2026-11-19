import type { BidAwardKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { createJobFromLead } from "@/lib/services/jobs";
import { PartnerError } from "@/lib/partners/errors";
import { AWARD_KIND_LABEL, isConfirmedAward, scopeStatusForAward } from "./states";
import { raiseActionTask } from "./events";
import { syncOpportunity } from "./project";
import { addWorkingDays } from "@/lib/time/working-days";
import { atLocalTime, todayKey } from "@/lib/time/zone";
import { loadHolidays } from "./holidays";

/**
 * An award event: the scopes a GC gave KNU together.
 *
 * - VERBAL: the scopes read "verbal selection". No job, no revenue; an
 *   urgent task asks for it in writing.
 * - WRITTEN / EXECUTED (confirmed): one job through the one job-creation
 *   path, keyed by the award, so a retry or a double click returns the same
 *   job. A later award on the same GC gets its own job.
 *
 * A verbal award is confirmed in place (`confirmAward`), which then makes
 * its job.
 */

export type AwardInput = { kind: BidAwardKind; scopeIds: string[]; amount: number; awardedAt?: string | null; evidenceFileId?: string | null; notes?: string | null };

const whenOf = (v: string | null | undefined) => (v ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00.000Z` : v) : new Date());

export async function recordAward(bidId: string, input: AwardInput, actorUserId: string) {
  const bid = await prisma.bidInvitation.findUnique({ where: { id: bidId }, select: { id: true, bidProjectId: true, leadId: true, scopes: { select: { id: true, scopeId: true, status: true } } } });
  if (!bid?.bidProjectId) throw new PartnerError(404, "Opportunity not found");
  if (!(input.amount > 0)) throw new PartnerError(400, "amount: the awarded amount is needed");
  if (input.scopeIds.length === 0) throw new PartnerError(400, "scopeIds: which scopes were awarded?");
  const rows = bid.scopes.filter((s) => input.scopeIds.includes(s.scopeId));
  if (rows.length !== input.scopeIds.length) throw new PartnerError(400, "scopeIds: this GC is not bidding one of those scopes");
  if (rows.some((s) => s.status !== "PENDING")) throw new PartnerError(409, "A scope already has a decision; a verbal selection is confirmed from its award");
  if (isConfirmedAward(input.kind) && !input.evidenceFileId) throw new PartnerError(400, "evidenceFileId: attach the award letter, LOI or signed subcontract");
  if (input.evidenceFileId) await assertEvidence(input.evidenceFileId, bid.leadId, bid.bidProjectId);
  const awardedAt = whenOf(input.awardedAt);
  if (Number.isNaN(awardedAt.getTime())) throw new PartnerError(400, "awardedAt: not a date");
  const award = await prisma.$transaction(async (tx) => {
    const a = await tx.bidAward.create({ data: { bidInvitationId: bidId, kind: input.kind, amount: input.amount, awardedAt, evidenceFileId: input.evidenceFileId ?? null, notes: input.notes?.trim() || null, createdByUserId: actorUserId }, select: { id: true } });
    await tx.bidOpportunityScope.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: scopeStatusForAward(input.kind), awardId: a.id, decidedAt: awardedAt, lossReason: null } });
    return a;
  });
  await recordAudit({ actorUserId, entityType: "BidAward", entityId: award.id, action: "bid_award", after: { bidId, kind: input.kind, amount: input.amount, scopeIds: input.scopeIds, evidenceFileId: input.evidenceFileId ?? null } });
  return afterAward(award.id, actorUserId);
}

/** A verbal selection put in writing (or signed): same award, same scopes, now with its job. */
export async function confirmAward(awardId: string, input: { kind: "WRITTEN" | "EXECUTED"; amount?: number; evidenceFileId: string; awardedAt?: string | null }, actorUserId: string) {
  const a = await prisma.bidAward.findUnique({ where: { id: awardId }, select: { id: true, kind: true, amount: true, bidInvitation: { select: { leadId: true, bidProjectId: true } } } });
  if (!a?.bidInvitation.bidProjectId) throw new PartnerError(404, "Award not found");
  if (a.kind === "EXECUTED") throw new PartnerError(409, "The subcontract is already signed");
  if (a.kind === "WRITTEN" && input.kind === "WRITTEN") throw new PartnerError(409, "The award is already in writing");
  await assertEvidence(input.evidenceFileId, a.bidInvitation.leadId, a.bidInvitation.bidProjectId);
  await prisma.$transaction([
    prisma.bidAward.update({ where: { id: awardId }, data: { kind: input.kind, amount: input.amount ?? a.amount, evidenceFileId: input.evidenceFileId, ...(input.awardedAt ? { awardedAt: whenOf(input.awardedAt) } : {}) } }),
    prisma.bidOpportunityScope.updateMany({ where: { awardId }, data: { status: scopeStatusForAward(input.kind) } }),
  ]);
  await recordAudit({ actorUserId, entityType: "BidAward", entityId: awardId, action: "bid_award_confirm", before: { kind: a.kind, amount: Number(a.amount) }, after: { kind: input.kind, amount: input.amount ?? Number(a.amount), evidenceFileId: input.evidenceFileId } });
  return afterAward(awardId, actorUserId);
}

/** The evidence must be a file already on this GC's lead or on the project. */
async function assertEvidence(fileId: string, leadId: string, projectId: string) {
  const f = await prisma.file.findUnique({ where: { id: fileId }, select: { leadId: true, bidProjectId: true } });
  if (!f || (f.leadId !== leadId && f.bidProjectId !== projectId)) throw new PartnerError(400, "evidenceFileId: not a file on this bid or its project");
}

/** Job (when confirmed) or the get-it-in-writing task (when verbal), then the opportunity and project follow. */
async function afterAward(awardId: string, actorUserId: string): Promise<{ awardId: string; job: { id: string; jobNumber: string } | null }> {
  const a = await prisma.bidAward.findUniqueOrThrow({
    where: { id: awardId },
    select: {
      id: true, kind: true, amount: true, evidenceFileId: true,
      scopes: { select: { scope: { select: { label: true } } } },
      bidInvitation: { select: { id: true, leadId: true, number: true, projectName: true, organization: { select: { name: true } }, bidProject: { select: { id: true, timeZone: true } }, pmUserId: true, submissions: { orderBy: { version: "desc" }, take: 1, select: { estimateId: true, roofEstimateId: true, snapshotSubtotalCost: true, proposalVersion: { select: { fileId: true } } } } } },
    },
  });
  const bid = a.bidInvitation;
  let job: { id: string; jobNumber: string } | null = null;
  if (isConfirmedAward(a.kind)) {
    const latest = bid.submissions[0];
    const fromEstimate = latest?.estimateId ? ({ kind: "GENERIC", id: latest.estimateId } as const) : latest?.roofEstimateId ? ({ kind: "ROOF", id: latest.roofEstimateId } as const) : null;
    const scopes = a.scopes.map((s) => s.scope.label).join(", ") || "Subcontract";
    const opts = { bidAwardId: a.id, billingMethod: "PROGRESS" as const, retainagePercent: 10, depositRequired: 0, skipDepositTask: true, contractAmount: Number(a.amount), title: `${scopes} — ${bid.projectName}`, fromEstimate, estimatedCost: latest?.snapshotSubtotalCost != null ? Number(latest.snapshotSubtotalCost) : undefined };
    let made;
    try {
      made = await createJobFromLead(bid.leadId, actorUserId, opts);
    } catch (e) {
      // Two confirmations at once: the unique award key lets only one job in; read the one that won.
      if ((e as { code?: string }).code !== "P2002") throw e;
      made = await prisma.job.findFirstOrThrow({ where: { sourceBidAwardId: a.id } });
    }
    job = { id: made.id, jobNumber: made.jobNumber };
    if (bid.pmUserId) await prisma.job.updateMany({ where: { id: made.id, projectManagerId: null }, data: { projectManagerId: bid.pmUserId } });
    // The documents behind the award go with the job.
    const fileIds = [a.evidenceFileId, latest?.proposalVersion?.fileId].filter((x): x is string => Boolean(x));
    if (fileIds.length) await prisma.file.updateMany({ where: { id: { in: fileIds }, jobId: null }, data: { jobId: made.id } });
    await recordAudit({ actorUserId, entityType: "BidAward", entityId: a.id, action: "bid_award_job", after: { jobId: made.id, jobNumber: made.jobNumber, amount: Number(a.amount) } });
  } else {
    const holidays = await loadHolidays();
    const today = todayKey();
    await raiseActionTask({
      bidId: bid.id,
      slotKey: `verbal:${a.id}`,
      kind: "URGENT_CALL",
      reason: "verbal_award",
      dueAt: atLocalTime(addWorkingDays(today, 1, holidays), 9, 0, bid.bidProject?.timeZone),
      title: `Get ${bid.organization.name}'s award for ${bid.projectName} in writing`,
      description: `${AWARD_KIND_LABEL.VERBAL} recorded on ${bid.number}. Ask for the award letter, LOI or subcontract; when it arrives, confirm the award on the project page — that creates the job.`,
      priority: "HIGH",
      actorUserId,
      planInputs: { rule: "verbal_award", awardId: a.id },
    });
  }
  await syncOpportunity(bid.id, actorUserId);
  return { awardId: a.id, job };
}
