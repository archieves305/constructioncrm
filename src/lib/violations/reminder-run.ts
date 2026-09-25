import { startOfDay } from "date-fns";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getEmailBrand } from "@/lib/email/brand";
import { reportDelivery, type DeliveryFailure } from "@/lib/email/delivery-report";
import { sendEmail } from "@/lib/email/send";
import { resolveRecipients, type Candidate } from "@/lib/tasks/recipients";
import { collectDeadlines, groupByRecipient, planReminders, reminderKey, type PlannedReminder } from "./deadlines";
import { renderCaseEscalationEmail, renderViolationDeadlineEmail, type DeadlineEmailItem, type EscalationEmailItem } from "./email";
import { caseEscalationAudience, parseEscalationDays, planCaseEscalations, type EscalationCase } from "./escalations";
import { fineSummaryFor } from "./fines";
import { caseUrl, recordCaseBell } from "./notify";

/**
 * The daily code-violation run: deadline reminders, then escalations.
 *
 * The reminder log is written BEFORE the send and removed when the send
 * fails, so a provider outage retries tomorrow and a cron that fires twice
 * sends nothing the second time. Each pass is one mail per person.
 */

const CASE_SELECT = {
  id: true, caseNumber: true, title: true, leadId: true, status: true, jurisdiction: true, caseManagerId: true,
  currentDeadline: true, appealDeadline: true, agencyConfirmedAt: true,
  initialFine: true, dailyFine: true, fineAccrualStartDate: true, fineAccrualStoppedAt: true, adminCosts: true, amountPaid: true, mitigationGrantedAmount: true, fineEstimateOverride: true, fineEstimateOverrideReason: true, fineEstimateOverrideAt: true, fineTermsUpdatedAt: true, officialBalance: true, officialBalanceAsOf: true,
  lead: { select: { propertyAddress1: true, city: true } },
  caseManager: { select: { firstName: true, lastName: true } },
  hearings: { where: { status: { in: ["SCHEDULED", "CONTINUED"] } }, select: { id: true, scheduledAt: true, status: true, type: true, attendeeUserId: true } },
  inspections: { where: { status: { in: ["REQUESTED", "SCHEDULED"] } }, select: { id: true, scheduledFor: true, status: true, kind: true, attendeeUserId: true } },
  job: { select: { projectManagerId: true, permits: { select: { id: true, permitNumber: true, expirationDate: true, status: true } } } },
} satisfies Prisma.CodeViolationCaseSelect;

export type ViolationReminderRunResult = { cases: number; deadlines: number; planned: number; people: number; sent: number; failures: string[] };

export async function runViolationReminders(now: Date = new Date()): Promise<ViolationReminderRunResult> {
  const cases = await prisma.codeViolationCase.findMany({ where: { status: { notIn: ["CLOSED", "CANCELLED"] } }, select: CASE_SELECT });
  const refs = cases.flatMap((c) => collectDeadlines(c, now));
  const zero = { cases: cases.length, deadlines: refs.length, planned: 0, people: 0, sent: 0, failures: [] as string[] };
  if (refs.length === 0) return zero;

  const logged = await prisma.codeViolationReminderLog.findMany({ where: { caseId: { in: cases.map((c) => c.id) } }, select: { caseId: true, kind: true, entityId: true, offsetKey: true } });
  const sentKeys = new Set(logged.map(reminderKey));
  const planned = planReminders(refs, now, sentKeys);
  if (planned.length === 0) return zero;

  const byRecipient = groupByRecipient(planned);
  const candidates: Candidate[] = [...byRecipient.keys()].map((userId) => ({ userId, reason: "assignee" as const }));
  const { recipients } = await resolveRecipients({ candidates, channel: "reminder" });
  const brand = await getEmailBrand();
  const byCase = new Map(cases.map((c) => [c.id, c]));

  let sent = 0;
  const failures: DeliveryFailure[] = [];
  for (const r of recipients) {
    const mine = byRecipient.get(r.userId) ?? [];
    if (mine.length === 0) continue;
    const toItem = (p: PlannedReminder): DeadlineEmailItem => {
      const c = byCase.get(p.ref.caseId)!;
      return { caseNumber: c.caseNumber, caseTitle: c.title, property: `${c.lead.propertyAddress1}, ${c.lead.city}`, label: p.ref.label, at: p.ref.at, daysRemaining: p.daysRemaining, url: caseUrl(c.id, p.ref.tab) };
    };
    const items = mine.map(toItem);
    const email = renderViolationDeadlineEmail({
      recipientFirstName: r.firstName,
      overdue: items.filter((i) => i.daysRemaining < 0),
      dueToday: items.filter((i) => i.daysRemaining === 0),
      upcoming: items.filter((i) => i.daysRemaining > 0),
      brand,
    });
    // Log first: a second run today must find these and send nothing.
    await prisma.codeViolationReminderLog.createMany({ data: mine.map((p) => ({ caseId: p.ref.caseId, kind: p.ref.kind, entityId: p.ref.entityId, offsetKey: p.offsetKey, recipientUserIds: [r.userId], channel: "email" })), skipDuplicates: true });
    try {
      const result = await sendEmail({ to: r.email, subject: email.subject, html: email.html, text: email.text });
      if (!result) throw new Error("email provider not configured");
      sent++;
      for (const p of mine) await recordCaseBell({ leadId: p.ref.leadId, recipientUserId: r.userId, recipientAddress: r.email, body: `${p.ref.caseNumber} — ${p.ref.label} ${p.daysRemaining < 0 ? `${-p.daysRemaining}d overdue` : p.daysRemaining === 0 ? "today" : `in ${p.daysRemaining}d`}` });
    } catch (err) {
      failures.push({ recipient: r.email, reason: err instanceof Error ? err.message : "unknown send error" });
      logger.exception(err, { where: "cron.violation-reminders", to: r.email });
      await prisma.codeViolationReminderLog.deleteMany({ where: { OR: mine.map((p) => ({ caseId: p.ref.caseId, kind: p.ref.kind, entityId: p.ref.entityId, offsetKey: p.offsetKey })) } });
    }
  }
  // Reminders whose recipient is muted or inactive are logged as sent-nowhere so they do not re-plan daily.
  const heard = new Set(recipients.map((r) => r.userId));
  const silent = planned.filter((p) => !heard.has(p.ref.recipientUserId!));
  if (silent.length > 0) {
    await prisma.codeViolationReminderLog.createMany({ data: silent.map((p) => ({ caseId: p.ref.caseId, kind: p.ref.kind, entityId: p.ref.entityId, offsetKey: p.offsetKey, recipientUserIds: [], channel: "none" })), skipDuplicates: true });
  }

  await reportDelivery({ source: "cron.violation-reminders", attempted: recipients.length, sent, failures, context: { cases: cases.length, deadlines: refs.length, planned: planned.length } });
  return { cases: cases.length, deadlines: refs.length, planned: planned.length, people: recipients.length, sent, failures: failures.map((f) => f.recipient) };
}

export type ViolationEscalationRunResult = { enabled: boolean; cases: number; escalated: number; people: number; sent: number; failures: string[] };

export async function runViolationEscalations(now: Date = new Date()): Promise<ViolationEscalationRunResult> {
  const zero: ViolationEscalationRunResult = { enabled: true, cases: 0, escalated: 0, people: 0, sent: 0, failures: [] };
  if (env.VIOLATION_ESCALATIONS_ENABLED !== "1") return { ...zero, enabled: false };
  const thresholds = parseEscalationDays(env.VIOLATION_ESCALATION_DAYS);
  if (thresholds.length === 0) return zero;
  const today = startOfDay(now);

  const cases = await prisma.codeViolationCase.findMany({
    where: { status: { notIn: ["CLOSED", "CANCELLED", "ON_HOLD"] }, agencyConfirmedAt: null, currentDeadline: { lt: today } },
    select: CASE_SELECT,
  });
  if (cases.length === 0) return zero;
  const entityFor = (c: (typeof cases)[number]) => `deadline@${c.currentDeadline!.toISOString().slice(0, 10)}`;
  const logged = await prisma.codeViolationReminderLog.findMany({ where: { caseId: { in: cases.map((c) => c.id) }, kind: "COMPLIANCE", offsetKey: { startsWith: "esc:" } }, select: { caseId: true, entityId: true, offsetKey: true } });
  const levelBy = new Map<string, number>();
  for (const l of logged) levelBy.set(`${l.caseId}|${l.entityId}`, Math.max(levelBy.get(`${l.caseId}|${l.entityId}`) ?? 0, parseInt(l.offsetKey.slice(4), 10) || 0));
  const plannable: EscalationCase[] = cases.map((c) => ({ id: c.id, caseNumber: c.caseNumber, leadId: c.leadId, caseManagerId: c.caseManagerId, currentDeadline: c.currentDeadline!, currentLevel: levelBy.get(`${c.id}|${entityFor(c)}`) ?? 0 }));
  const plans = planCaseEscalations(plannable, thresholds, now);
  if (plans.length === 0) return { ...zero, cases: cases.length };

  const [managers, admins] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, role: { name: "MANAGER" } }, select: { id: true } }),
    prisma.user.findMany({ where: { isActive: true, role: { name: "ADMIN" } }, select: { id: true } }),
  ]);
  const byCase = new Map(cases.map((c) => [c.id, c]));
  const perUser = new Map<string, { plan: (typeof plans)[number]; reason: "case_manager" | "manager" | "admin" }[]>();
  const candidates: Candidate[] = [];
  for (const plan of plans) {
    const c = byCase.get(plan.caseId)!;
    for (const m of caseEscalationAudience(plan, c, managers.map((u) => u.id), admins.map((u) => u.id))) {
      candidates.push({ userId: m.userId, reason: m.reason === "case_manager" ? "assignee" : "manager" });
      perUser.set(m.userId, [...(perUser.get(m.userId) ?? []), { plan, reason: m.reason }]);
    }
  }
  const { recipients } = await resolveRecipients({ candidates, channel: "escalation" });
  const brand = await getEmailBrand();

  let sent = 0;
  const failures: DeliveryFailure[] = [];
  const succeeded = new Set<string>();
  for (const r of recipients) {
    const mine = perUser.get(r.userId) ?? [];
    if (mine.length === 0) continue;
    const items: EscalationEmailItem[] = mine.map(({ plan }) => {
      const c = byCase.get(plan.caseId)!;
      const fines = fineSummaryFor(c, now);
      return { caseNumber: c.caseNumber, caseTitle: c.title, property: `${c.lead.propertyAddress1}, ${c.lead.city}`, jurisdiction: c.jurisdiction, deadline: c.currentDeadline!, daysOverdue: plan.daysOverdue, level: plan.toLevel, caseManagerName: c.caseManager ? `${c.caseManager.firstName} ${c.caseManager.lastName}` : "No case manager", exposure: Number(fines.exposure) > 0 ? `$${Number(fines.exposure).toLocaleString("en-US")}` : null, url: caseUrl(c.id) };
    });
    const strongest = mine.some((m) => m.reason === "case_manager") ? "case_manager" : mine.some((m) => m.reason === "manager") ? "manager" : "admin";
    const email = renderCaseEscalationEmail({ recipientFirstName: r.firstName, recipientReason: strongest, items, brand });
    try {
      const result = await sendEmail({ to: r.email, subject: email.subject, html: email.html, text: email.text });
      if (!result) throw new Error("email provider not configured");
      sent++;
      for (const { plan } of mine) {
        succeeded.add(plan.caseId);
        const c = byCase.get(plan.caseId)!;
        await recordCaseBell({ leadId: c.leadId, recipientUserId: r.userId, recipientAddress: r.email, body: `${c.caseNumber} — ${plan.daysOverdue}d past the compliance deadline (escalation level ${plan.toLevel})` });
      }
    } catch (err) {
      failures.push({ recipient: r.email, reason: err instanceof Error ? err.message : "unknown send error" });
      logger.exception(err, { where: "cron.violation-escalations", to: r.email });
    }
  }
  // Advance the ledger only for cases somebody actually heard about.
  for (const plan of plans) {
    if (!succeeded.has(plan.caseId)) continue;
    const c = byCase.get(plan.caseId)!;
    await prisma.codeViolationReminderLog.createMany({ data: [{ caseId: c.id, kind: "COMPLIANCE", entityId: entityFor(c), offsetKey: `esc:${plan.toLevel}`, recipientUserIds: recipients.filter((r) => (perUser.get(r.userId) ?? []).some((m) => m.plan.caseId === c.id)).map((r) => r.userId), channel: "email" }], skipDuplicates: true });
  }
  await reportDelivery({ source: "cron.violation-escalations", attempted: recipients.length, sent, failures, context: { cases: cases.length, plans: plans.length } });
  return { enabled: true, cases: cases.length, escalated: succeeded.size, people: recipients.length, sent, failures: failures.map((f) => f.recipient) };
}
