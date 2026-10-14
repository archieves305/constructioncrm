import type { BidSubmissionKind, BidSubmissionMethod, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { BID_SELECT, presentBid } from "./bids";
import { PartnerError } from "./errors";
import { advanceLastContact } from "./interactions";

/**
 * A bid as it went out: append-only. Each row snapshots the linked estimate's
 * price and cost so the expected margin at submission survives later edits
 * to the estimate. The first submission moves an ESTIMATING bid to SUBMITTED.
 */
export type SubmissionInput = {
  kind?: BidSubmissionKind;
  amount: number;
  estimateId?: string | null;
  roofEstimateId?: string | null;
  submittedAt?: string | null;
  method?: BidSubmissionMethod;
  recipientContactId?: string | null;
  alternates?: string | null;
  clarifications?: string | null;
  exclusions?: string | null;
  fileId?: string | null;
  /** Hours spent on this bid, recorded with the submission. */
  estimatingHours?: number | null;
};

const clean = (v: string | null | undefined) => v?.trim() || null;

export async function addSubmission(bidId: string, input: SubmissionInput, actorUserId: string) {
  const bid = await prisma.bidInvitation.findUnique({ where: { id: bidId }, select: { id: true, leadId: true, organizationId: true, status: true, number: true, submissions: { select: { version: true }, orderBy: { version: "desc" }, take: 1 } } });
  if (!bid) throw new PartnerError(404, "Bid not found");
  if (bid.status === "CLOSED") throw new PartnerError(409, "The bid is closed; reopen it to record another submission");
  if (input.estimateId && input.roofEstimateId) throw new PartnerError(400, "A submission links one estimate, not two");
  let snapshot: { snapshotTotalPrice: number | null; snapshotSubtotalCost: number | null } = { snapshotTotalPrice: null, snapshotSubtotalCost: null };
  if (input.estimateId) {
    const e = await prisma.estimate.findUnique({ where: { id: input.estimateId }, select: { leadId: true, totalPrice: true, subtotalCost: true } });
    if (!e || e.leadId !== bid.leadId) throw new PartnerError(400, "estimateId: not an estimate on this bid");
    snapshot = { snapshotTotalPrice: Number(e.totalPrice), snapshotSubtotalCost: Number(e.subtotalCost) };
  }
  if (input.roofEstimateId) {
    const e = await prisma.roofEstimate.findUnique({ where: { id: input.roofEstimateId }, select: { leadId: true, totalPrice: true, subtotalCost: true } });
    if (!e || e.leadId !== bid.leadId) throw new PartnerError(400, "roofEstimateId: not a roofing estimate on this bid");
    snapshot = { snapshotTotalPrice: Number(e.totalPrice), snapshotSubtotalCost: Number(e.subtotalCost) };
  }
  if (input.recipientContactId) {
    const c = await prisma.contact.findUnique({ where: { id: input.recipientContactId }, select: { organizationId: true } });
    if (!c || c.organizationId !== bid.organizationId) throw new PartnerError(400, "recipientContactId: that person is not at this account");
  }
  if (input.fileId) {
    const f = await prisma.file.findUnique({ where: { id: input.fileId }, select: { leadId: true } });
    if (!f || f.leadId !== bid.leadId) throw new PartnerError(400, "fileId: not a file on this bid");
  }
  const version = (bid.submissions[0]?.version ?? 0) + 1;
  const submittedAt = input.submittedAt ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(input.submittedAt) ? `${input.submittedAt}T12:00:00.000Z` : input.submittedAt) : new Date();
  if (Number.isNaN(submittedAt.getTime())) throw new PartnerError(400, "submittedAt: not a date");
  const created = await prisma.$transaction(async (tx) => {
    const s = await tx.bidSubmission.create({
      data: {
        bidInvitationId: bidId,
        version,
        kind: input.kind ?? (version === 1 ? "ORIGINAL" : "REVISED"),
        amount: input.amount,
        estimateId: input.estimateId ?? null,
        roofEstimateId: input.roofEstimateId ?? null,
        ...snapshot,
        submittedAt,
        method: input.method ?? "PLATFORM",
        recipientContactId: input.recipientContactId ?? null,
        alternates: clean(input.alternates),
        clarifications: clean(input.clarifications),
        exclusions: clean(input.exclusions),
        fileId: input.fileId ?? null,
        submittedByUserId: actorUserId,
      },
      select: { id: true },
    });
    const data: Prisma.BidInvitationUpdateInput = { submittedAt: version === 1 ? submittedAt : undefined };
    if (bid.status === "ESTIMATING" || bid.status === "INVITED" || bid.status === "DECIDING" || bid.status === "TRACKING") data.status = "SUBMITTED";
    if (bid.status === "SHORTLISTED") data.status = "SUBMITTED";
    if (input.estimatingHours !== undefined && input.estimatingHours !== null) data.estimatingHours = input.estimatingHours;
    await tx.bidInvitation.update({ where: { id: bidId }, data });
    await tx.interaction.create({ data: { organizationId: bid.organizationId, contactId: input.recipientContactId ?? null, leadId: bid.leadId, userId: actorUserId, kind: "BID_DISCUSSION", direction: "OUTBOUND", outcome: "SENT", occurredAt: submittedAt, summary: `Bid ${bid.number} v${version} submitted: ${input.amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}` } });
    await advanceLastContact(tx, bid.organizationId, submittedAt);
    return s;
  });
  await recordAudit({ actorUserId, entityType: "BidSubmission", entityId: created.id, action: version === 1 ? "bid_submitted" : "bid_revised", after: { bidId, version, amount: input.amount, estimateId: input.estimateId ?? null, roofEstimateId: input.roofEstimateId ?? null, method: input.method ?? "PLATFORM" } });
  return presentBid(await prisma.bidInvitation.findUniqueOrThrow({ where: { id: bidId }, select: BID_SELECT }));
}

/** Only a manager, only within a day of recording it — a submission is a record. */
export async function deleteSubmission(bidId: string, submissionId: string, actorUserId: string) {
  const s = await prisma.bidSubmission.findUnique({ where: { id: submissionId }, select: { id: true, bidInvitationId: true, version: true, amount: true, createdAt: true } });
  if (!s || s.bidInvitationId !== bidId) throw new PartnerError(404, "Submission not found");
  if (Date.now() - s.createdAt.getTime() > 24 * 3_600_000) throw new PartnerError(409, "A submission older than a day stays on the record");
  await prisma.bidSubmission.delete({ where: { id: submissionId } });
  await recordAudit({ actorUserId, entityType: "BidSubmission", entityId: submissionId, action: "delete", before: { bidId, version: s.version, amount: Number(s.amount) } });
  return presentBid(await prisma.bidInvitation.findUniqueOrThrow({ where: { id: bidId }, select: BID_SELECT }));
}
