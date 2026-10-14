import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getJobCostRows, type JobCostRow } from "@/lib/services/job-cost";
import { getBillingSummary } from "@/lib/services/progress-billing";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { endOfDayIn, startOfDayIn } from "@/lib/time/zone";
import { latestAmount } from "./bid-state";
import { DEFAULT_HEALTH_WEIGHTS, healthWeightsSchema, scoreHealth, type HealthResult, type HealthWeights } from "./health";
import { representativeQualifications } from "./qualifications";
import { bidKpis, groupBy, moneyKpis, profitPerHour, type BidRowForKpi, type JobMoneyRow, type MoneyKpis, type Window } from "./scorecard";
import { getPartnerSettings } from "./settings";
import { PARTNER_STAGES } from "./stages";
import { periodsIn, type Period, type ReportWindow } from "./windows";

/**
 * The loaders behind health, the account scorecard and the analytics page.
 * Every number comes from the pure modules (health.ts, scorecard.ts); this
 * file only gathers rows, in batches, and turns office-day windows into
 * instants.
 */

const MS_DAY = 86_400_000;
const MEETING_KINDS = ["MEETING", "LUNCH", "SITE_VISIT"] as const;
const num = (d: unknown) => (d === null || d === undefined ? 0 : Number(d));

export function instants(w: { from: string; to: string }): Window {
  return { from: startOfDayIn(w.from), to: endOfDayIn(w.to) };
}

export async function healthWeightsInForce(): Promise<{ weights: HealthWeights; version: number; preferredMinAwards: number; preferredMinMargin: number }> {
  const s = await getPartnerSettings();
  const parsed = s.healthWeights ? healthWeightsSchema.safeParse(s.healthWeights) : null;
  return { weights: parsed?.success ? parsed.data : DEFAULT_HEALTH_WEIGHTS, version: s.healthWeightsVersion, preferredMinAwards: s.preferredMinAwards, preferredMinMargin: Number(s.preferredMinMargin) };
}

type OrgJobs = { jobsByOrg: Map<string, JobCostRow[]>; orgOfJob: Map<string, string> };

async function jobsOf(orgIds: string[]): Promise<OrgJobs> {
  const where: Prisma.JobWhereInput = { lead: { organizationId: { in: orgIds } } };
  const [rows, links] = await Promise.all([getJobCostRows(where), prisma.job.findMany({ where, select: { id: true, lead: { select: { organizationId: true } } } })]);
  const orgOfJob = new Map(links.map((l) => [l.id, l.lead.organizationId!]));
  const jobsByOrg = new Map<string, JobCostRow[]>();
  for (const r of rows) {
    const o = orgOfJob.get(r.jobId);
    if (o) jobsByOrg.set(o, [...(jobsByOrg.get(o) ?? []), r]);
  }
  return { jobsByOrg, orgOfJob };
}

/** Projected margin across billable jobs that have a projection. */
function marginOf(rows: JobCostRow[] | undefined): number | null {
  const p = (rows ?? []).filter((r) => r.summary.billable && r.summary.projectedProfit !== null);
  const contract = p.reduce((s, r) => s + r.summary.revisedContract, 0);
  return p.length && contract > 0 ? p.reduce((s, r) => s + (r.summary.projectedProfit ?? 0), 0) / contract : null;
}

export type HealthFacts = { health: HealthResult; margin: number | null; awardedCount: number; jobCount: number };

/** Health for many accounts in a fixed number of queries. */
export async function loadHealth(orgIds: string[], now: Date = new Date()): Promise<Map<string, HealthFacts>> {
  const out = new Map<string, HealthFacts>();
  if (orgIds.length === 0) return out;
  const d90 = new Date(now.getTime() - 90 * MS_DAY);
  const d365 = new Date(now.getTime() - 365 * MS_DAY);
  const [cfg, orgs, ix90, mt365, quals, bids, jobs] = await Promise.all([
    healthWeightsInForce(),
    prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, createdAt: true, lastContactAt: true, contacts: { where: { isActive: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { firstName: true, lastName: true } } } }),
    prisma.interaction.groupBy({ by: ["organizationId"], where: { organizationId: { in: orgIds }, occurredAt: { gte: d90 } }, _count: { _all: true } }),
    prisma.interaction.groupBy({ by: ["organizationId"], where: { organizationId: { in: orgIds }, occurredAt: { gte: d365 }, kind: { in: [...MEETING_KINDS] } }, _count: { _all: true } }),
    representativeQualifications(orgIds),
    prisma.bidInvitation.findMany({ where: { organizationId: { in: orgIds } }, select: { organizationId: true, invitedAt: true, submittedAt: true, outcome: true, outcomeAt: true } }),
    jobsOf(orgIds),
  ]);
  const jobIds = [...jobs.orgOfJob.keys()];
  const [invoices, payments] = await Promise.all([
    jobIds.length ? prisma.invoice.findMany({ where: { jobId: { in: jobIds }, status: { in: ["SENT", "PAID"] }, issueDate: { gte: d365 } }, select: { jobId: true, amount: true } }) : [],
    jobIds.length ? prisma.payment.findMany({ where: { jobId: { in: jobIds }, status: "RECEIVED", receivedDate: { gte: d365 }, invoiceId: { not: null } }, select: { jobId: true, receivedDate: true, invoice: { select: { issueDate: true } } } }) : [],
  ]);
  const count = (rows: { organizationId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.organizationId, r._count._all]));
  const ix = count(ix90);
  const mt = count(mt365);
  const revenue = new Map<string, number>();
  for (const i of invoices) {
    const o = jobs.orgOfJob.get(i.jobId)!;
    revenue.set(o, (revenue.get(o) ?? 0) + num(i.amount));
  }
  const lags = new Map<string, number[]>();
  for (const p of payments) {
    const o = jobs.orgOfJob.get(p.jobId)!;
    const lag = (p.receivedDate!.getTime() - p.invoice!.issueDate.getTime()) / MS_DAY;
    if (lag >= 0) lags.set(o, [...(lags.get(o) ?? []), lag]);
  }
  for (const org of orgs) {
    const mine = bids.filter((b) => b.organizationId === org.id);
    const q = quals.get(org.id);
    const l = lags.get(org.id);
    const margin = marginOf(jobs.jobsByOrg.get(org.id));
    const c = org.contacts[0];
    const health = scoreHealth(
      {
        lastContactAt: org.lastContactAt,
        createdAt: org.createdAt,
        meetings365: mt.get(org.id) ?? 0,
        interactions90: ix.get(org.id) ?? 0,
        qualification: q ? { status: q.status, expiresAt: q.expiresAt } : null,
        invitations365: mine.filter((b) => b.invitedAt && b.invitedAt >= d365).length,
        submitted365: mine.filter((b) => b.submittedAt && b.submittedAt >= d365).length,
        awards365: mine.filter((b) => b.outcome === "AWARDED" && b.outcomeAt && b.outcomeAt >= d365).length,
        revenue365: revenue.get(org.id) ?? 0,
        margin,
        // Whole days: an average of 45.0001 is "45 days", not the next band.
        daysToPay: l?.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null,
        primaryContactName: c ? `${c.firstName} ${c.lastName}`.trim() : null,
      },
      cfg.weights,
      cfg.version,
      now,
    );
    out.set(org.id, { health, margin, awardedCount: mine.filter((b) => b.outcome === "AWARDED").length, jobCount: jobs.jobsByOrg.get(org.id)?.length ?? 0 });
  }
  return out;
}

const BID_KPI_SELECT = {
  id: true,
  organizationId: true,
  status: true,
  decision: true,
  outcome: true,
  invitedAt: true,
  decidedAt: true,
  submittedAt: true,
  outcomeAt: true,
  lossReason: true,
  estimatingHours: true,
  awardedAmount: true,
  winningPrice: true,
  lead: { select: { estimatedJobValue: true, county: true, jobs: { select: { id: true } }, services: { select: { serviceCategory: { select: { id: true, name: true } } } } } },
  organization: { select: { id: true, name: true, markets: true, ownerUserId: true, owner: { select: { firstName: true, lastName: true } } } },
  submissions: { select: { version: true, amount: true } },
} satisfies Prisma.BidInvitationSelect;
type BidRow = Prisma.BidInvitationGetPayload<{ select: typeof BID_KPI_SELECT }>;

function kpiRow(b: BidRow): BidRowForKpi {
  return {
    status: b.status,
    decision: b.decision,
    outcome: b.outcome,
    invitedAt: b.invitedAt,
    decidedAt: b.decidedAt,
    submittedAt: b.submittedAt,
    outcomeAt: b.outcomeAt,
    estimatedValue: b.lead.estimatedJobValue === null ? null : Number(b.lead.estimatedJobValue),
    latestAmount: latestAmount(b.submissions.map((s) => ({ version: s.version, amount: Number(s.amount) }))),
    awardedAmount: b.awardedAmount === null ? null : Number(b.awardedAmount),
    lossReason: b.lossReason,
    estimatingHours: b.estimatingHours === null ? null : Number(b.estimatingHours),
  };
}

/** Median of (our price − winner) ÷ winner over losses with both prices. */
function priceGap(rows: BidRow[], w: Window): number | null {
  const gaps = rows
    .filter((b) => b.outcome === "LOST" && b.winningPrice && b.outcomeAt && b.outcomeAt >= w.from && b.outcomeAt <= w.to)
    .map((b) => {
      const ours = latestAmount(b.submissions.map((s) => ({ version: s.version, amount: Number(s.amount) })));
      const theirs = Number(b.winningPrice);
      return ours !== null && theirs > 0 ? (ours - theirs) / theirs : null;
    })
    .filter((g): g is number => g !== null)
    .sort((a, b) => a - b);
  if (!gaps.length) return null;
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}

async function moneyFor(jobRows: JobCostRow[], w: Window): Promise<MoneyKpis> {
  const jobIds = jobRows.map((r) => r.jobId);
  if (jobIds.length === 0) return moneyKpis({ jobs: [], invoices: [], payments: [], changeOrders: [] }, w);
  const [invoices, payments, changeOrders, progress] = await Promise.all([
    prisma.invoice.findMany({ where: { jobId: { in: jobIds } }, select: { jobId: true, amount: true, issueDate: true, status: true } }),
    prisma.payment.findMany({ where: { jobId: { in: jobIds } }, select: { amount: true, receivedDate: true, status: true, invoice: { select: { issueDate: true } } } }),
    prisma.changeOrder.findMany({ where: { jobId: { in: jobIds } }, select: { status: true, decidedAt: true } }),
    prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, billingMethod: true, createdAt: true } }),
  ]);
  const createdAt = new Map(progress.map((j) => [j.id, j.createdAt]));
  const retainage = new Map<string, number>();
  for (const j of progress) if (j.billingMethod === "PROGRESS") retainage.set(j.id, (await getBillingSummary(j.id))?.totals.retainageHeld ?? 0);
  const jobs: JobMoneyRow[] = jobRows.map((r) => ({ jobId: r.jobId, billable: r.summary.billable, revisedContract: r.summary.revisedContract, projectedProfit: r.summary.projectedProfit, retainageHeld: retainage.get(r.jobId) ?? 0, createdAt: createdAt.get(r.jobId) ?? new Date(0) }));
  return moneyKpis(
    {
      jobs,
      invoices: invoices.map((i) => ({ jobId: i.jobId, amount: num(i.amount), issueDate: i.issueDate, status: i.status })),
      payments: payments.map((p) => ({ amount: num(p.amount), receivedDate: p.receivedDate, status: p.status, invoiceIssueDate: p.invoice?.issueDate ?? null })),
      changeOrders,
    },
    w,
  );
}

/** One account over a window: bid KPIs, money KPIs, relationship activity, health. */
export async function loadOrgScorecard(orgId: string, rw: ReportWindow) {
  const w = instants(rw);
  const [bids, jobs, interactions, health] = await Promise.all([
    prisma.bidInvitation.findMany({ where: { organizationId: orgId }, select: BID_KPI_SELECT }),
    jobsOf([orgId]),
    prisma.interaction.findMany({ where: { organizationId: orgId, occurredAt: { gte: w.from, lte: w.to } }, select: { kind: true, direction: true, outcome: true } }),
    loadHealth([orgId]),
  ]);
  const jobRows = jobs.jobsByOrg.get(orgId) ?? [];
  const money = await moneyFor(jobRows, w);
  const bidsK = bidKpis(bids.map(kpiRow), w);
  const awardedJobIds = new Set(bids.filter((b) => b.outcome === "AWARDED" && b.outcomeAt && b.outcomeAt >= w.from && b.outcomeAt <= w.to).flatMap((b) => b.lead.jobs.map((j) => j.id)));
  const awardRows = jobRows.filter((r) => awardedJobIds.has(r.jobId) && r.summary.projectedProfit !== null);
  const gpOfAwards = awardRows.length ? awardRows.reduce((s, r) => s + (r.summary.projectedProfit ?? 0), 0) : null;
  const hoursOnAwards = bids.filter((b) => b.outcome === "AWARDED" && b.outcomeAt && b.outcomeAt >= w.from && b.outcomeAt <= w.to).reduce((s, b) => s + num(b.estimatingHours), 0);
  return {
    window: rw,
    bids: { ...bidsK, priceGap: priceGap(bids, w), ...profitPerHour(gpOfAwards, hoursOnAwards, bidsK.estimatingHours) },
    money,
    activity: {
      interactions: interactions.length,
      meetings: interactions.filter((i) => (MEETING_KINDS as readonly string[]).includes(i.kind)).length,
      outbound: interactions.filter((i) => i.direction === "OUTBOUND").length,
      responses: interactions.filter((i) => i.direction === "INBOUND" || i.outcome === "REPLIED" || i.outcome === "SPOKE" || i.outcome === "MEETING_HELD").length,
    },
    health: health.get(orgId)?.health ?? null,
  };
}

export type AnalyticsGroupBy = "org" | "trade" | "market" | "owner";
export type AnalyticsFilters = { stage?: string | null; market?: string | null };

/** Every account over a window, grouped; the BD activity counts; the pipeline by stage. */
export async function loadAnalytics(rw: ReportWindow, by: AnalyticsGroupBy, filters: AnalyticsFilters, period: Period) {
  const w = instants(rw);
  const orgWhere: Prisma.OrganizationWhereInput = { isActive: true, ...(filters.stage ? { stage: filters.stage as Prisma.OrganizationWhereInput["stage"] } : {}), ...(filters.market ? { markets: { has: filters.market } } : {}) };
  const orgs = await prisma.organization.findMany({ where: orgWhere, select: { id: true, name: true, stage: true, markets: true, ownerUserId: true, owner: { select: { firstName: true, lastName: true } }, trades: { select: { serviceCategory: { select: { id: true, name: true } } } } } });
  const orgIds = orgs.map((o) => o.id);
  const [bids, jobs, byStage] = await Promise.all([
    prisma.bidInvitation.findMany({ where: { organizationId: { in: orgIds } }, select: BID_KPI_SELECT }),
    jobsOf(orgIds),
    prisma.organization.groupBy({ by: ["stage"], where: { isActive: true }, _count: { _all: true } }),
  ]);
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const keysOfOrg = (orgId: string, trades: { id: string; name: string }[]): { key: string; label: string }[] => {
    const o = orgById.get(orgId)!;
    if (by === "org") return [{ key: o.id, label: o.name }];
    if (by === "owner") return [{ key: o.ownerUserId ?? "none", label: o.owner ? `${o.owner.firstName} ${o.owner.lastName}` : "No owner" }];
    if (by === "market") return o.markets.length ? o.markets.map((m) => ({ key: m, label: m })) : [{ key: "none", label: "No market" }];
    return trades.length ? trades.map((t) => ({ key: t.id, label: t.name })) : [{ key: "none", label: "No trade" }];
  };
  // A bid's trades are its package's; a job's are its bid's, else the account's.
  const tradesOfBid = (b: BidRow) => b.lead.services.map((s) => s.serviceCategory);
  const tradesOfJob = new Map<string, { id: string; name: string }[]>();
  for (const b of bids) for (const j of b.lead.jobs) tradesOfJob.set(j.id, tradesOfBid(b));
  const jobItems = [...jobs.jobsByOrg.entries()].flatMap(([orgId, rows]) => rows.map((r) => ({ orgId, row: r, trades: tradesOfJob.get(r.jobId) ?? orgById.get(orgId)!.trades.map((t) => t.serviceCategory) })));
  const bidItems = bids.map((b) => ({ orgId: b.organizationId, row: b, trades: tradesOfBid(b) }));

  const bidGroups = groupBy(bidItems, (i) => keysOfOrg(i.orgId, i.trades));
  const jobGroups = new Map(groupBy(jobItems, (i) => keysOfOrg(i.orgId, i.trades)).map((g) => [g.key, g]));
  const allKeys = new Map<string, string>();
  for (const g of bidGroups) allKeys.set(g.key, g.label);
  for (const g of jobGroups.values()) allKeys.set(g.key, g.label);
  const groups = [];
  for (const [key, label] of allKeys) {
    const bg = bidGroups.find((g) => g.key === key);
    const jg = jobGroups.get(key);
    const money = await moneyFor((jg?.rows ?? []).map((i) => i.row), w);
    const bk = bidKpis((bg?.rows ?? []).map((i) => kpiRow(i.row)), w);
    // A group with nothing in the window is left out, so an empty window reads as empty.
    const active = bk.invitations + bk.decided + bk.submitted + bk.awarded + bk.lost + bk.open + money.jobs + money.billed + money.collected > 0;
    if (active) groups.push({ key, label, kpis: { ...bk, ...money } });
  }
  groups.sort((a, b) => b.kpis.billed - a.kpis.billed || b.kpis.awardedValue - a.kpis.awardedValue || a.label.localeCompare(b.label));

  const allBidK = bidKpis(bids.map(kpiRow), w);
  const allMoney = await moneyFor(jobItems.map((i) => i.row), w);
  return {
    window: rw,
    groupBy: by,
    totals: { ...allBidK, ...allMoney, priceGap: priceGap(bids, w) },
    groups,
    pipeline: { byStage: PARTNER_STAGES.map((s) => ({ stage: s.key, label: s.name, count: byStage.find((r) => r.stage === s.key)?._count._all ?? 0 })) },
    bdKpis: await loadBdKpis(rw, period),
  };
}

/** Business-development activity per period: what the team did, not what it earned. */
export async function loadBdKpis(rw: ReportWindow, period: Period) {
  const buckets = periodsIn(rw, period);
  const w = instants(rw);
  const [orgs, contacts, interactions, quals, bids] = await Promise.all([
    prisma.organization.findMany({ where: { createdAt: { gte: w.from, lte: w.to } }, select: { createdAt: true } }),
    prisma.contact.findMany({ where: { createdAt: { gte: w.from, lte: w.to } }, select: { createdAt: true } }),
    prisma.interaction.findMany({ where: { occurredAt: { gte: w.from, lte: w.to } }, select: { occurredAt: true, kind: true, direction: true, outcome: true } }),
    prisma.qualification.findMany({ where: { OR: [{ createdAt: { gte: w.from, lte: w.to } }, { submittedAt: { gte: w.from, lte: w.to } }, { approvedAt: { gte: w.from, lte: w.to } }] }, select: { createdAt: true, submittedAt: true, approvedAt: true } }),
    prisma.bidInvitation.findMany({ where: { OR: [{ invitedAt: { gte: w.from, lte: w.to } }, { submittedAt: { gte: w.from, lte: w.to } }, { outcomeAt: { gte: w.from, lte: w.to } }] }, select: { invitedAt: true, submittedAt: true, outcome: true, outcomeAt: true, awardedAmount: true, lead: { select: { jobs: { select: { id: true } } } } } }),
  ]);
  const awardJobIds = bids.filter((b) => b.outcome === "AWARDED").flatMap((b) => b.lead.jobs.map((j) => j.id));
  const gpByJob = new Map((awardJobIds.length ? await getJobCostRows({ id: { in: awardJobIds } }) : []).map((r) => [r.jobId, r.summary.projectedProfit]));
  return buckets.map((p) => {
    const pw = instants(p);
    const inP = (d: Date | null) => Boolean(d && d >= pw.from && d <= pw.to);
    const awards = bids.filter((b) => b.outcome === "AWARDED" && inP(b.outcomeAt));
    const gp = awards.flatMap((b) => b.lead.jobs.map((j) => gpByJob.get(j.id))).filter((g): g is number => g != null);
    return {
      key: p.key,
      label: p.label,
      newOrgs: orgs.filter((o) => inP(o.createdAt)).length,
      contactsAdded: contacts.filter((c) => inP(c.createdAt)).length,
      outreach: interactions.filter((i) => inP(i.occurredAt) && i.direction === "OUTBOUND").length,
      responses: interactions.filter((i) => inP(i.occurredAt) && (i.direction === "INBOUND" || i.outcome === "REPLIED")).length,
      meetings: interactions.filter((i) => inP(i.occurredAt) && (MEETING_KINDS as readonly string[]).includes(i.kind)).length,
      qualsStarted: quals.filter((q) => inP(q.createdAt)).length,
      qualsSubmitted: quals.filter((q) => inP(q.submittedAt)).length,
      qualsApproved: quals.filter((q) => inP(q.approvedAt)).length,
      invitations: bids.filter((b) => inP(b.invitedAt)).length,
      submitted: bids.filter((b) => inP(b.submittedAt)).length,
      awards: awards.length,
      awardedRevenue: awards.reduce((s, b) => s + num(b.awardedAmount), 0),
      awardedGp: gp.length ? gp.reduce((a, b) => a + b, 0) : null,
    };
  });
}

/** The dashboard strip: what is in play right now. */
export async function loadBdSummary(now: Date = new Date()) {
  const soon = new Date(now.getTime() + 7 * MS_DAY);
  const [open, due, followUps] = await Promise.all([
    prisma.bidInvitation.findMany({ where: { status: { not: "CLOSED" } }, select: { lead: { select: { estimatedJobValue: true } }, submissions: { select: { version: true, amount: true } } } }),
    prisma.bidInvitation.count({ where: { status: { in: ["TRACKING", "INVITED", "DECIDING", "ESTIMATING"] }, bidDueAt: { lte: soon } } }),
    prisma.task.count({ where: { organizationId: { not: null }, sourceKey: { startsWith: "org:" }, status: { in: [...OPEN_TASK_STATUSES] }, activatedAt: { not: null }, dueAt: { lt: now } } }),
  ]);
  const value = open.reduce((s, b) => s + (latestAmount(b.submissions.map((x) => ({ version: x.version, amount: Number(x.amount) }))) ?? num(b.lead.estimatedJobValue)), 0);
  return { openBids: open.length, openBidValue: Math.round(value), bidsDueThisWeek: due, overdueFollowUps: followUps };
}
