import type { BidDecision, BidOutcome, BidPlatform, BidStatus, Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { leadAccessWhere } from "@/lib/access/records";
import { createJobFromLead } from "@/lib/services/jobs";
import { todayKey } from "@/lib/time/zone";
import { bidWeightsSchema, DEFAULT_BID_WEIGHTS, scoreBid, type BidScore, type BidScoreInput, type Slider } from "./bid-score";
import { BID_PLATFORM_LABEL, BID_STATUS_LABEL, bidNumber, canTransition, closeRequires, latestAmount, leadStageFor } from "./bid-state";
import { PartnerError } from "./errors";
import { advanceLastContact } from "./interactions";
import { settlePartnerFollowUps } from "./follow-up-run";
import { coverage, requirementState } from "./qualification-state";
import { representativeQualifications } from "./qualifications";
import { loadHealth } from "./scorecard-load";
import { getPartnerSettings } from "./settings";

/**
 * A bid package: a Lead of kind GC_BID plus its BidInvitation. The lead is
 * written here through Prisma, not the lead form's schema, because a GC
 * package has no homeowner — the contact's name and phone (or the account's)
 * fill the person columns and the project site fills the address.
 *
 * Status is the master. The lead's stage mirrors only Won (on award, which
 * also creates the progress-billed job through the one job-creation path)
 * and Lost.
 */

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;

export const BID_SELECT = {
  id: true,
  leadId: true,
  organizationId: true,
  contactId: true,
  number: true,
  projectName: true,
  projectType: true,
  scopeSummary: true,
  invitedAt: true,
  bidDueAt: true,
  siteWalkAt: true,
  preBidMeetingAt: true,
  rfiDueAt: true,
  addendaDeadlineAt: true,
  interviewAt: true,
  expectedAwardAt: true,
  addendaCount: true,
  specsReceived: true,
  estimatorUserId: true,
  siteVisitRequired: true,
  bondRequired: true,
  prevailingWage: true,
  unionRequired: true,
  insuranceNotes: true,
  scheduleNotes: true,
  platform: true,
  platformUrl: true,
  platformRef: true,
  status: true,
  waitingOn: true,
  decision: true,
  decisionScore: true,
  decisionFactors: true,
  decisionReason: true,
  decidedAt: true,
  submittedAt: true,
  estimatingHours: true,
  outcome: true,
  lossReason: true,
  winningContractor: true,
  winningPrice: true,
  outcomeNotes: true,
  outcomeAt: true,
  awardedAmount: true,
  contractReceivedAt: true,
  needsReview: true,
  createdAt: true,
  updatedAt: true,
  estimator: PERSON,
  decidedBy: PERSON,
  createdBy: PERSON,
  contact: { select: { id: true, firstName: true, lastName: true, title: true, email: true, phone: true, mobile: true } },
  organization: { select: { id: true, name: true, stage: true, owner: PERSON } },
  lead: {
    select: {
      id: true,
      fullName: true,
      companyName: true,
      propertyAddress1: true,
      propertyAddress2: true,
      city: true,
      state: true,
      zipCode: true,
      county: true,
      estimatedJobValue: true,
      currentStage: { select: { id: true, name: true, isWon: true, isLost: true } },
      services: { select: { serviceCategory: { select: { id: true, name: true } } } },
      jobs: { select: { id: true, jobNumber: true, title: true, contractAmount: true, billingMethod: true, currentStage: { select: { name: true } } } },
      _count: { select: { estimates: true, roofEstimates: true, planSets: true, files: true } },
    },
  },
  submissions: {
    orderBy: { version: "desc" as const },
    select: { id: true, version: true, kind: true, amount: true, estimateId: true, roofEstimateId: true, snapshotTotalPrice: true, snapshotSubtotalCost: true, submittedAt: true, method: true, alternates: true, clarifications: true, exclusions: true, fileId: true, createdAt: true, submittedBy: PERSON, recipientContact: { select: { id: true, firstName: true, lastName: true } } },
  },
} satisfies Prisma.BidInvitationSelect;

export type BidRow = Prisma.BidInvitationGetPayload<{ select: typeof BID_SELECT }>;

const num = (d: Prisma.Decimal | number | string | null | undefined) => (d === null || d === undefined ? null : Number(d));

export function presentBid(b: BidRow) {
  return {
    ...b,
    estimatingHours: num(b.estimatingHours),
    winningPrice: num(b.winningPrice),
    awardedAmount: num(b.awardedAmount),
    lead: { ...b.lead, estimatedJobValue: num(b.lead.estimatedJobValue), jobs: b.lead.jobs.map((j) => ({ ...j, contractAmount: Number(j.contractAmount) })), trades: b.lead.services.map((s) => s.serviceCategory) },
    submissions: b.submissions.map((s) => ({ ...s, amount: Number(s.amount), snapshotTotalPrice: num(s.snapshotTotalPrice), snapshotSubtotalCost: num(s.snapshotSubtotalCost) })),
    latestAmount: latestAmount(b.submissions.map((s) => ({ version: s.version, amount: Number(s.amount) }))),
    statusLabel: BID_STATUS_LABEL[b.status],
  };
}
export type BidView = ReturnType<typeof presentBid>;

const whenOf = (v: string | null | undefined): Date | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00.000Z`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new PartnerError(400, "A date is not valid");
  return d;
};
const clean = (v: string | null | undefined) => v?.trim() || null;

export type BidInput = {
  contactId?: string | null;
  projectName?: string;
  projectType?: string | null;
  scopeSummary?: string | null;
  invitedAt?: string | null;
  bidDueAt?: string | null;
  siteWalkAt?: string | null;
  preBidMeetingAt?: string | null;
  rfiDueAt?: string | null;
  addendaDeadlineAt?: string | null;
  interviewAt?: string | null;
  expectedAwardAt?: string | null;
  addendaCount?: number;
  specsReceived?: boolean;
  estimatorUserId?: string | null;
  siteVisitRequired?: boolean;
  bondRequired?: boolean;
  prevailingWage?: boolean;
  unionRequired?: boolean;
  insuranceNotes?: string | null;
  scheduleNotes?: string | null;
  platform?: BidPlatform;
  platformUrl?: string | null;
  platformRef?: string | null;
  estimatedContractValue?: number | null;
  estimatingHours?: number | null;
  waitingOn?: string | null;
  contractReceivedAt?: string | null;
  tradeIds?: string[];
};

export type CreateBidInput = BidInput & {
  organizationId: string;
  projectName: string;
  status?: "TRACKING" | "INVITED";
  tradeIds: string[];
  /** Set by an intake ("email:BUILDINGCONNECTED") so the bid says where it came from. */
  signalSource?: string | null;
  site: { address1: string; address2?: string | null; city: string; state?: string; zipCode: string; county?: string | null };
};

const DATE_KEYS = ["invitedAt", "bidDueAt", "siteWalkAt", "preBidMeetingAt", "rfiDueAt", "addendaDeadlineAt", "interviewAt", "expectedAwardAt", "contractReceivedAt"] as const;
const TEXT_KEYS = ["projectType", "scopeSummary", "insuranceNotes", "scheduleNotes", "platformUrl", "platformRef", "waitingOn"] as const;
const BOOL_KEYS = ["specsReceived", "siteVisitRequired", "bondRequired", "prevailingWage", "unionRequired"] as const;

function invitationData(input: BidInput): Prisma.BidInvitationUncheckedUpdateInput {
  const data: Prisma.BidInvitationUncheckedUpdateInput = {};
  for (const k of DATE_KEYS) {
    const v = whenOf(input[k]);
    if (v !== undefined) data[k] = v;
  }
  for (const k of TEXT_KEYS) if (input[k] !== undefined) data[k] = clean(input[k]);
  for (const k of BOOL_KEYS) if (input[k] !== undefined) data[k] = input[k];
  if (input.projectName !== undefined) data.projectName = input.projectName.trim();
  if (input.addendaCount !== undefined) data.addendaCount = input.addendaCount;
  if (input.platform !== undefined) data.platform = input.platform;
  if (input.estimatingHours !== undefined) data.estimatingHours = input.estimatingHours;
  if (input.contactId !== undefined) data.contactId = input.contactId;
  if (input.estimatorUserId !== undefined) data.estimatorUserId = input.estimatorUserId;
  return data;
}

async function nextBidNumber(db: Prisma.TransactionClient): Promise<string> {
  const rows = await db.$queryRaw<{ n: bigint | number }[]>`SELECT nextval('bid_invitation_number_seq') AS n`;
  return bidNumber(Number(rows[0]?.n ?? 0));
}

export async function createBid(input: CreateBidInput, actorUserId: string) {
  const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true, name: true, phone: true, email: true, ownerUserId: true, contacts: { where: { isActive: true }, orderBy: { isPrimary: "desc" }, take: 1, select: { id: true, organizationId: true, firstName: true, lastName: true, phone: true, mobile: true, email: true } } } });
  if (!org) throw new PartnerError(404, "Account not found");
  const contact = input.contactId ? await prisma.contact.findUnique({ where: { id: input.contactId }, select: { id: true, organizationId: true, firstName: true, lastName: true, phone: true, mobile: true, email: true } }) : (org.contacts[0] ?? null);
  if (input.contactId && (!contact || contact.organizationId !== org.id)) throw new PartnerError(400, "contactId: that person is not at this account");
  const [stage, source, trades] = await Promise.all([
    prisma.leadStage.findFirst({ where: { name: "New Lead" }, select: { id: true } }),
    prisma.leadSource.findFirst({ where: { name: "GC bid invitation" }, select: { id: true } }),
    prisma.serviceCategory.findMany({ where: { id: { in: input.tradeIds }, isActive: true }, select: { id: true } }),
  ]);
  if (!stage) throw new PartnerError(500, "The 'New Lead' stage is not configured");
  if (trades.length === 0) throw new PartnerError(400, "tradeIds: pick at least one trade");
  const status = input.status ?? "INVITED";
  const assignee = input.estimatorUserId ?? org.ownerUserId ?? actorUserId;
  const firstName = contact?.firstName ?? org.name;
  const lastName = contact?.lastName ?? "";

  const created = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        kind: "GC_BID",
        organizationId: org.id,
        contactId: contact?.id ?? null,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        companyName: org.name,
        primaryPhone: contact?.mobile ?? contact?.phone ?? org.phone ?? "N/A",
        email: contact?.email ?? org.email ?? null,
        propertyAddress1: input.site.address1.trim(),
        propertyAddress2: clean(input.site.address2),
        city: input.site.city.trim(),
        state: input.site.state?.trim().toUpperCase() || "FL",
        zipCode: input.site.zipCode.trim(),
        county: clean(input.site.county),
        propertyType: "COMMERCIAL",
        sourceId: source?.id ?? null,
        sourceDetail: input.platform ? `Bid via ${BID_PLATFORM_LABEL[input.platform]}` : "Bid invitation",
        assignedUserId: assignee,
        currentStageId: stage.id,
        estimatedJobValue: input.estimatedContractValue ?? null,
        notesSummary: clean(input.scopeSummary),
        createdByUserId: actorUserId,
        services: { create: trades.map((t) => ({ serviceCategoryId: t.id })) },
      },
      select: { id: true },
    });
    await tx.leadStageHistory.create({ data: { leadId: lead.id, toStageId: stage.id, changedByUserId: actorUserId, reason: "Bid package created" } });
    await tx.activityLog.create({ data: { leadId: lead.id, activityType: "LEAD_CREATED", title: `Bid package created for ${org.name}`, description: input.projectName.trim(), createdByUserId: actorUserId } });
    const number = await nextBidNumber(tx);
    const bid = await tx.bidInvitation.create({
      data: {
        ...(invitationData(input) as Prisma.BidInvitationUncheckedCreateInput),
        leadId: lead.id,
        organizationId: org.id,
        contactId: contact?.id ?? null,
        number,
        projectName: input.projectName.trim(),
        status,
        estimatorUserId: input.estimatorUserId ?? null,
        invitedAt: status === "INVITED" ? (whenOf(input.invitedAt) ?? new Date()) : (whenOf(input.invitedAt) ?? null),
        signalSource: input.signalSource ?? null,
        createdByUserId: actorUserId,
      },
      select: BID_SELECT,
    });
    if (status === "INVITED") {
      // The invitation itself is a touch from the GC: it moves last contact and settles rule 4.
      await tx.interaction.create({ data: { organizationId: org.id, contactId: contact?.id ?? null, leadId: lead.id, userId: actorUserId, kind: "BID_DISCUSSION", direction: "INBOUND", outcome: "NOT_APPLICABLE", occurredAt: bid.invitedAt ?? new Date(), summary: `Invitation to bid: ${bid.projectName} (${bid.number})` } });
      await advanceLastContact(tx, org.id, bid.invitedAt ?? new Date());
    }
    return bid;
  });
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: created.id, action: "bid_create", after: { number: created.number, organizationId: org.id, leadId: created.leadId, projectName: created.projectName, status, tradeIds: trades.map((t) => t.id) } });
  await settlePartnerFollowUps(org.id, actorUserId, "A bid invitation arrived");
  return presentBid(created);
}

export async function updateBid(id: string, patch: BidInput, actorUserId: string) {
  const before = await prisma.bidInvitation.findUnique({ where: { id }, select: BID_SELECT });
  if (!before) throw new PartnerError(404, "Bid not found");
  if (patch.contactId) {
    const c = await prisma.contact.findUnique({ where: { id: patch.contactId }, select: { organizationId: true } });
    if (!c || c.organizationId !== before.organizationId) throw new PartnerError(400, "contactId: that person is not at this account");
  }
  const data = invitationData(patch);
  await prisma.$transaction(async (tx) => {
    await tx.bidInvitation.update({ where: { id }, data });
    const leadData: Prisma.LeadUpdateInput = {};
    if (patch.estimatedContractValue !== undefined) leadData.estimatedJobValue = patch.estimatedContractValue;
    if (patch.estimatorUserId !== undefined) leadData.assignedUser = patch.estimatorUserId ? { connect: { id: patch.estimatorUserId } } : { disconnect: true };
    if (patch.contactId !== undefined) leadData.contact = patch.contactId ? { connect: { id: patch.contactId } } : { disconnect: true };
    if (Object.keys(leadData).length) await tx.lead.update({ where: { id: before.leadId }, data: leadData });
    if (patch.tradeIds) {
      await tx.leadService.deleteMany({ where: { leadId: before.leadId } });
      await tx.leadService.createMany({ data: patch.tradeIds.map((serviceCategoryId) => ({ leadId: before.leadId, serviceCategoryId })), skipDuplicates: true });
    }
  });
  const keys = Object.keys(patch);
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: id, action: "update", before: Object.fromEntries(keys.map((k) => [k, (before as Record<string, unknown>)[k]])), after: patch });
  return presentBid((await prisma.bidInvitation.findUniqueOrThrow({ where: { id }, select: BID_SELECT })));
}

export async function setBidStatus(id: string, status: BidStatus, waitingOn: string | null | undefined, actorUserId: string) {
  const before = await prisma.bidInvitation.findUnique({ where: { id }, select: { status: true, organizationId: true, _count: { select: { submissions: true } } } });
  if (!before) throw new PartnerError(404, "Bid not found");
  if (status === "CLOSED") throw new PartnerError(400, "Close the bid with an outcome instead");
  if (before.status === "CLOSED") throw new PartnerError(409, "A closed bid is reopened, not moved");
  if (!canTransition(before.status, status)) throw new PartnerError(409, `A bid cannot go from ${BID_STATUS_LABEL[before.status]} to ${BID_STATUS_LABEL[status]}`);
  if (status === "SUBMITTED" && before._count.submissions === 0) throw new PartnerError(409, "Record the submission (the amount and when it went out) to mark the bid submitted");
  const data: Prisma.BidInvitationUpdateInput = { status };
  if (waitingOn !== undefined) data.waitingOn = clean(waitingOn);
  if (status !== "ESTIMATING" && waitingOn === undefined) data.waitingOn = null;
  if (status === "INVITED" && before.status === "TRACKING") data.invitedAt = new Date();
  const after = await prisma.bidInvitation.update({ where: { id }, data, select: BID_SELECT });
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: id, action: "bid_status", before: { status: before.status }, after: { status, waitingOn: data.waitingOn ?? null } });
  return presentBid(after);
}

/** The inputs the scorer reads from the record; the five sliders come from the person. */
export async function scoreInputsFor(bid: BidRow, manual: BidScoreInput["manual"]): Promise<BidScoreInput> {
  const settings = await getPartnerSettings();
  const tradeIds = bid.lead.services.map((s) => s.serviceCategory.id);
  const typical = (settings.typicalRange as Record<string, { min: number; max: number }> | null) ?? null;
  const range = tradeIds.map((t) => typical?.[t]).find(Boolean) ?? null;
  const today = todayKey();
  const [decided, quals, invoices] = await Promise.all([
    prisma.bidInvitation.findMany({ where: { organizationId: bid.organizationId, status: "CLOSED", outcome: { in: ["AWARDED", "LOST"] }, NOT: { id: bid.id } }, select: { outcome: true } }),
    representativeQualifications([bid.organizationId]),
    prisma.invoice.findMany({ where: { job: { lead: { organizationId: bid.organizationId } }, payments: { some: { status: "RECEIVED" } } }, select: { issueDate: true, payments: { where: { status: "RECEIVED" }, select: { receivedDate: true } } } }),
  ]);
  const lags = invoices.flatMap((i) => i.payments.filter((p) => p.receivedDate).map((p) => (p.receivedDate!.getTime() - i.issueDate.getTime()) / 86_400_000));
  const avgDaysToPay = lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : null;
  let insuranceCurrent: boolean | null = null;
  const rep = quals.get(bid.organizationId);
  if (rep) {
    const q = await prisma.qualification.findUnique({ where: { id: rep.id }, select: { requirements: { where: { required: true, documentType: { category: "insurance" } }, select: { status: true, required: true, companyDocumentId: true, companyDocument: { select: { expiresAt: true } } } } } });
    if (q && q.requirements.length) {
      const c = coverage(q.requirements, today);
      insuranceCurrent = c.missing === 0 && !q.requirements.some((r) => requirementState(r, today) === "expired");
    }
  }
  return {
    healthScore: (await loadHealth([bid.organizationId])).get(bid.organizationId)?.health.score ?? null,
    estimatedValue: num(bid.lead.estimatedJobValue),
    typicalRange: range,
    packageTradeIds: tradeIds,
    ourTradeIds: settings.ourTradeIds,
    county: bid.lead.county,
    homeCounties: settings.homeCounties,
    adjacentCounties: settings.adjacentCounties,
    daysToDue: bid.bidDueAt ? Math.floor((bid.bidDueAt.getTime() - Date.now()) / 86_400_000) : null,
    avgDaysToPay,
    decidedSubmissions: decided.length,
    awards: decided.filter((d) => d.outcome === "AWARDED").length,
    insuranceCurrent,
    bondRequired: bid.bondRequired,
    bondingCapacity: num(settings.bondingCapacity),
    manual,
  };
}

export async function weightsInForce(): Promise<{ weights: ReturnType<typeof bidWeightsSchema.parse>; version: number }> {
  const s = await getPartnerSettings();
  const parsed = s.scoreWeights ? bidWeightsSchema.safeParse(s.scoreWeights) : null;
  return { weights: parsed?.success ? parsed.data : DEFAULT_BID_WEIGHTS, version: s.scoreWeightsVersion };
}

export async function previewBidScore(id: string, manual: BidScoreInput["manual"]): Promise<BidScore & { inputs: BidScoreInput }> {
  const bid = await prisma.bidInvitation.findUnique({ where: { id }, select: BID_SELECT });
  if (!bid) throw new PartnerError(404, "Bid not found");
  const inputs = await scoreInputsFor(bid, manual);
  const { weights, version } = await weightsInForce();
  return { ...scoreBid(inputs, weights, version), inputs };
}

export async function decideBid(id: string, input: { decision: Exclude<BidDecision, "UNDECIDED">; manual: { margin: Slider; capacity: Slider; competition: Slider; complexity: Slider; plansAndTerms: Slider }; reason?: string | null }, actorUserId: string) {
  const bid = await prisma.bidInvitation.findUnique({ where: { id }, select: BID_SELECT });
  if (!bid) throw new PartnerError(404, "Bid not found");
  if (bid.status === "CLOSED") throw new PartnerError(409, "The bid is closed");
  const inputs = await scoreInputsFor(bid, input.manual);
  const { weights, version } = await weightsInForce();
  const score = scoreBid(inputs, weights, version);
  const snapshot = { weightsVersion: version, inputs, breakdown: score.breakdown, reasons: score.reasons, concerns: score.concerns, gates: score.gates, recommendation: score.recommendation };
  const now = new Date();
  if (input.decision === "NO_BID") {
    const after = await prisma.bidInvitation.update({ where: { id }, data: { decision: "NO_BID", decisionScore: score.score, decisionFactors: snapshot as Prisma.InputJsonValue, decisionReason: clean(input.reason), decidedByUserId: actorUserId, decidedAt: now, status: "CLOSED", outcome: "NO_BID", outcomeAt: now, outcomeNotes: clean(input.reason) }, select: BID_SELECT });
    await moveLeadStage(after.leadId, "lost", actorUserId, `Passed on ${after.number}`);
    await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: id, action: "bid_decision", before: { decision: bid.decision, status: bid.status }, after: { decision: "NO_BID", score: score.score, recommendation: score.recommendation, reason: input.reason ?? null } });
    return presentBid(await prisma.bidInvitation.findUniqueOrThrow({ where: { id }, select: BID_SELECT }));
  }
  const nextStatus: BidStatus = bid.status === "TRACKING" || bid.status === "INVITED" || bid.status === "DECIDING" ? "ESTIMATING" : bid.status;
  const after = await prisma.bidInvitation.update({ where: { id }, data: { decision: "BID", decisionScore: score.score, decisionFactors: snapshot as Prisma.InputJsonValue, decisionReason: clean(input.reason), decidedByUserId: actorUserId, decidedAt: now, status: nextStatus }, select: BID_SELECT });
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: id, action: "bid_decision", before: { decision: bid.decision, status: bid.status }, after: { decision: "BID", score: score.score, recommendation: score.recommendation, status: nextStatus, reason: input.reason ?? null } });
  return presentBid(after);
}

export type CloseInput = { outcome: BidOutcome; lossReason?: string | null; winningContractor?: string | null; winningPrice?: number | null; outcomeNotes?: string | null; awardedAmount?: number | null; outcomeAt?: string | null };

export async function closeBid(id: string, input: CloseInput, actorUserId: string): Promise<{ bid: BidView; job: { id: string; jobNumber: string } | null }> {
  const bid = await prisma.bidInvitation.findUnique({ where: { id }, select: BID_SELECT });
  if (!bid) throw new PartnerError(404, "Bid not found");
  if (bid.status === "CLOSED") throw new PartnerError(409, "The bid is already closed; reopen it to change the outcome");
  const needs = closeRequires(input.outcome);
  if (needs.lossReason && !input.lossReason) throw new PartnerError(400, "lossReason: say why it was lost");
  if (needs.awardedAmount && !(input.awardedAmount && input.awardedAmount > 0)) throw new PartnerError(400, "awardedAmount: the awarded amount is needed to create the job");
  const outcomeAt = whenOf(input.outcomeAt) ?? new Date();
  const after = await prisma.bidInvitation.update({
    where: { id },
    data: {
      status: "CLOSED",
      outcome: input.outcome,
      lossReason: (input.lossReason as Prisma.BidInvitationUpdateInput["lossReason"]) ?? null,
      winningContractor: clean(input.winningContractor),
      winningPrice: input.winningPrice ?? null,
      outcomeNotes: clean(input.outcomeNotes),
      outcomeAt,
      awardedAmount: input.outcome === "AWARDED" ? input.awardedAmount : null,
      decision: input.outcome === "NO_BID" && bid.decision === "UNDECIDED" ? "NO_BID" : bid.decision,
    },
    select: BID_SELECT,
  });
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: id, action: "bid_outcome", before: { status: bid.status, outcome: bid.outcome }, after: { outcome: input.outcome, lossReason: input.lossReason ?? null, winningContractor: input.winningContractor ?? null, winningPrice: input.winningPrice ?? null, awardedAmount: input.awardedAmount ?? null } });
  let job: { id: string; jobNumber: string } | null = null;
  const mirror = leadStageFor(input.outcome);
  if (mirror === "won") job = await awardBid(after, actorUserId);
  else if (mirror === "lost") await moveLeadStage(after.leadId, "lost", actorUserId, `${after.number}: ${input.outcome.toLowerCase().replace("_", " ")}`);
  await settlePartnerFollowUps(bid.organizationId, actorUserId, "A bid closed");
  return { bid: presentBid(await prisma.bidInvitation.findUniqueOrThrow({ where: { id }, select: BID_SELECT })), job };
}

/** Award → the lead is Won → the one job-creation path, with subcontract defaults. */
async function awardBid(bid: BidRow, actorUserId: string): Promise<{ id: string; jobNumber: string }> {
  const amount = Number(bid.awardedAmount);
  await prisma.lead.update({ where: { id: bid.leadId }, data: { estimatedJobValue: amount } });
  await moveLeadStage(bid.leadId, "won", actorUserId, `Awarded ${bid.number}`);
  const trades = bid.lead.services.map((s) => s.serviceCategory.name).join(", ") || "Subcontract";
  const job = await createJobFromLead(bid.leadId, actorUserId, { billingMethod: "PROGRESS", retainagePercent: 10, depositRequired: 0, skipDepositTask: true, contractAmount: amount, title: `${trades} — ${bid.projectName}` });
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: bid.id, action: "bid_award", after: { jobId: job.id, jobNumber: job.jobNumber, awardedAmount: amount } });
  return { id: job.id, jobNumber: job.jobNumber };
}

export async function reopenBid(id: string, actorUserId: string, force = false) {
  const bid = await prisma.bidInvitation.findUnique({ where: { id }, select: BID_SELECT });
  if (!bid) throw new PartnerError(404, "Bid not found");
  if (bid.status !== "CLOSED") throw new PartnerError(409, "The bid is not closed");
  if (bid.lead.jobs.length && !force) throw new PartnerError(409, "A job was created from this award; reopening leaves the job in place", { jobs: bid.lead.jobs.map((j) => j.jobNumber) });
  await prisma.bidInvitation.update({ where: { id }, data: { status: "INVITED", outcome: null, lossReason: null, winningContractor: null, winningPrice: null, outcomeAt: null, awardedAmount: null, decision: bid.decision === "NO_BID" ? "UNDECIDED" : bid.decision } });
  await moveLeadStage(bid.leadId, "open", actorUserId, `${bid.number} reopened`);
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: id, action: "bid_reopen", before: { outcome: bid.outcome }, after: { status: "INVITED", force } });
  // Read after the lead has moved, so the answer carries its new stage.
  return presentBid(await prisma.bidInvitation.findUniqueOrThrow({ where: { id }, select: BID_SELECT }));
}

/** The lead's stage follows the bid: Won, Lost, or the first open stage. Writes the history, the activity line and the audit the stage route would. */
async function moveLeadStage(leadId: string, to: "won" | "lost" | "open", actorUserId: string, reason: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { currentStageId: true } });
  if (!lead) return;
  const stage =
    to === "won"
      ? await prisma.leadStage.findFirst({ where: { isWon: true } })
      : to === "lost"
        ? await prisma.leadStage.findFirst({ where: { isLost: true } })
        : await prisma.leadStage.findFirst({ where: { isClosed: false }, orderBy: { stageOrder: "asc" } });
  if (!stage || stage.id === lead.currentStageId) return;
  await prisma.$transaction([
    prisma.lead.update({ where: { id: leadId }, data: { currentStageId: stage.id } }),
    prisma.leadStageHistory.create({ data: { leadId, fromStageId: lead.currentStageId, toStageId: stage.id, changedByUserId: actorUserId, reason } }),
    prisma.activityLog.create({ data: { leadId, activityType: "STAGE_CHANGE", title: `Stage changed to ${stage.name}`, description: reason, metadataJson: { fromStageId: lead.currentStageId, toStageId: stage.id, by: "bid" }, createdByUserId: actorUserId } }),
  ]);
  await recordAudit({ actorUserId, entityType: "Lead", entityId: leadId, action: "stage_change", before: { stageId: lead.currentStageId }, after: { stageId: stage.id, reason } });
}

export async function deleteBid(id: string, actorUserId: string) {
  const bid = await prisma.bidInvitation.findUnique({ where: { id }, select: BID_SELECT });
  if (!bid) throw new PartnerError(404, "Bid not found");
  if (!(bid.status === "TRACKING" || bid.status === "INVITED") || bid.submissions.length || bid.lead.jobs.length) throw new PartnerError(409, "Only a bid that was never worked can be deleted; close it with an outcome instead");
  if (bid.lead._count.estimates + bid.lead._count.roofEstimates + bid.lead._count.planSets + bid.lead._count.files > 0) throw new PartnerError(409, "The bid's lead already carries estimates, plans or files; close it with an outcome instead");
  await prisma.lead.delete({ where: { id: bid.leadId } });
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: id, action: "delete", before: { number: bid.number, projectName: bid.projectName, organizationId: bid.organizationId, leadId: bid.leadId } });
}

export type BidListParams = { status?: BidStatus; organizationId?: string; estimatorUserId?: string; outcome?: BidOutcome; dueFrom?: string; dueTo?: string; search?: string; includeClosed?: boolean; scope?: "mine" | "all"; page: number; pageSize: number };

export async function listBids(params: BidListParams, viewer: { id: string; role: RoleName }) {
  const and: Prisma.BidInvitationWhereInput[] = [];
  if (params.status) and.push({ status: params.status });
  else if (!params.includeClosed) and.push({ status: { not: "CLOSED" } });
  if (params.organizationId) and.push({ organizationId: params.organizationId });
  if (params.estimatorUserId) and.push({ estimatorUserId: params.estimatorUserId });
  if (params.outcome) and.push({ outcome: params.outcome });
  if (params.dueFrom) and.push({ bidDueAt: { gte: new Date(`${params.dueFrom}T00:00:00.000Z`) } });
  if (params.dueTo) and.push({ bidDueAt: { lte: new Date(`${params.dueTo}T23:59:59.999Z`) } });
  if (params.search) and.push({ OR: [{ projectName: { contains: params.search, mode: "insensitive" } }, { number: { contains: params.search, mode: "insensitive" } }, { organization: { name: { contains: params.search, mode: "insensitive" } } }, { lead: { propertyAddress1: { contains: params.search, mode: "insensitive" } } }] });
  if (params.scope === "mine") and.push({ OR: [{ estimatorUserId: viewer.id }, { organization: { ownerUserId: viewer.id } }] });
  // Only bids whose lead this person may open (an own-only role sees its own).
  and.push({ lead: leadAccessWhere(viewer) });
  const where: Prisma.BidInvitationWhereInput = and.length ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.bidInvitation.findMany({ where, orderBy: [{ bidDueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize, select: BID_SELECT }),
    prisma.bidInvitation.count({ where }),
  ]);
  return { rows: rows.map(presentBid), total };
}

export async function getBid(id: string) {
  const bid = await prisma.bidInvitation.findUnique({ where: { id }, select: BID_SELECT });
  if (!bid) throw new PartnerError(404, "Bid not found");
  return presentBid(bid);
}

export async function getBidForLead(leadId: string) {
  const bid = await prisma.bidInvitation.findUnique({ where: { leadId }, select: BID_SELECT });
  return bid ? presentBid(bid) : null;
}

/** Per account: open / total / awarded counts and the newest bid activity (for badges and the follow-up rules). */
export async function bidFactsFor(organizationIds: string[]) {
  const out = new Map<string, { openBidCount: number; bidCount: number; awardedCount: number; lastBidActivityAt: Date | null }>();
  if (organizationIds.length === 0) return out;
  const rows = await prisma.bidInvitation.findMany({ where: { organizationId: { in: organizationIds } }, select: { organizationId: true, status: true, outcome: true, invitedAt: true, submittedAt: true, outcomeAt: true, createdAt: true } });
  for (const r of rows) {
    const f = out.get(r.organizationId) ?? { openBidCount: 0, bidCount: 0, awardedCount: 0, lastBidActivityAt: null };
    f.bidCount += 1;
    if (r.status !== "CLOSED") f.openBidCount += 1;
    if (r.outcome === "AWARDED") f.awardedCount += 1;
    for (const d of [r.invitedAt, r.submittedAt, r.outcomeAt, r.createdAt]) if (d && (!f.lastBidActivityAt || d > f.lastBidActivityAt)) f.lastBidActivityAt = d;
    out.set(r.organizationId, f);
  }
  return out;
}
