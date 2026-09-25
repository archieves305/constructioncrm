import { format } from "date-fns";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getEmailBrand } from "@/lib/email/brand";
import { reportDelivery, type DeliveryFailure } from "@/lib/email/delivery-report";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { resolveRecipients, type Candidate, type TaskRecipient } from "@/lib/tasks/recipients";
import { renderCaseNoticeEmail, type RenderedEmail } from "./email";

/**
 * Case-level notifications. Anything that changes a *task* is mailed by
 * createTask/updateTask; this file covers only case facts — assignment,
 * an item handed to someone, an agency inspection on the calendar, the
 * agency's confirmation, closure. Best-effort and never throws: the write
 * has already committed, and a mail outage must not turn it into a 500.
 *
 * Every send also drops an in-app bell row (`NotificationEvent`, lead-scoped
 * — a case always has a lead) so the notification exists even for someone
 * who has task mail muted.
 */

const CASE_SELECT = {
  id: true, caseNumber: true, title: true, leadId: true, jurisdiction: true, caseManagerId: true, createdByUserId: true, currentDeadline: true, agencyConfirmedAt: true, agencyConfirmedByName: true, officialComplianceDate: true, closedAt: true, closureOverrideReason: true,
  lead: { select: { propertyAddress1: true, city: true } },
  job: { select: { jobNumber: true, projectManagerId: true } },
  caseManager: { select: { firstName: true, lastName: true } },
} as const;

type CaseRow = NonNullable<Awaited<ReturnType<typeof loadCase>>>;

async function loadCase(caseId: string) {
  return prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: CASE_SELECT });
}

export function caseUrl(caseId: string, tab?: string | null): string {
  return `${env.APP_BASE_URL}/violations/${caseId}${tab ? `?tab=${tab}` : ""}`;
}

function property(c: CaseRow): string {
  return `${c.lead.propertyAddress1}, ${c.lead.city}`;
}

async function actorName(actorUserId: string | null): Promise<string> {
  if (!actorUserId) return "The system";
  const u = await prisma.user.findUnique({ where: { id: actorUserId }, select: { firstName: true, lastName: true } });
  return u ? `${u.firstName} ${u.lastName}`.trim() : "Someone";
}

/** The bell row. One per recipient; the body carries the case number so it is findable. */
export async function recordCaseBell(input: { leadId: string; recipientUserId: string; recipientAddress: string; body: string }): Promise<void> {
  try {
    await prisma.notificationEvent.create({
      data: { leadId: input.leadId, recipientUserId: input.recipientUserId, channel: "IN_APP", provider: "violations", recipientAddress: input.recipientAddress, messageBody: input.body, status: "SENT", sentAt: new Date() },
    });
  } catch (err) {
    logger.exception(err, { where: "violations.notify.bell", recipientUserId: input.recipientUserId });
  }
}

async function dispatch(input: { kind: string; caseId: string; leadId: string; candidates: Candidate[]; actorUserId: string | null; bellBody: string; render: (r: TaskRecipient) => RenderedEmail }): Promise<{ sent: number; failed: number }> {
  const { recipients } = await resolveRecipients({ candidates: input.candidates, suppressUserId: input.actorUserId, channel: "task" });
  if (recipients.length === 0) return { sent: 0, failed: 0 };
  for (const r of recipients) await recordCaseBell({ leadId: input.leadId, recipientUserId: r.userId, recipientAddress: r.email, body: input.bellBody });
  if (!isEmailConfigured()) return { sent: 0, failed: 0 };
  let sent = 0;
  const failures: DeliveryFailure[] = [];
  for (const r of recipients) {
    try {
      const email = input.render(r);
      const result = await sendEmail({ to: r.email, subject: email.subject, html: email.html, text: email.text });
      if (result) sent++;
      else failures.push({ recipient: r.email, reason: "email provider not configured" });
    } catch (err) {
      failures.push({ recipient: r.email, reason: err instanceof Error ? err.message : "unknown send error" });
      logger.exception(err, { where: `violations.notify.${input.kind}`, to: r.email });
    }
  }
  await reportDelivery({ source: `violations.${input.kind}`, attempted: recipients.length, sent, failures, context: { caseId: input.caseId } });
  return { sent, failed: failures.length };
}

function safe(kind: string, fn: () => Promise<unknown>): Promise<void> {
  return fn()
    .then(() => undefined)
    .catch((err) => logger.exception(err, { where: `violations.notify.${kind}` }));
}

/** The case was handed to a new case manager. */
export function notifyCaseAssigned(caseId: string, newManagerId: string, actorUserId: string | null): Promise<void> {
  return safe("case_assigned", async () => {
    const c = await loadCase(caseId);
    if (!c) return;
    const brand = await getEmailBrand();
    const by = await actorName(actorUserId);
    await dispatch({
      kind: "case_assigned", caseId, leadId: c.leadId, actorUserId,
      candidates: [{ userId: newManagerId, reason: "assignee" }],
      bellBody: `${c.caseNumber} assigned to you — ${c.title}`,
      render: (r) =>
        renderCaseNoticeEmail({
          recipientFirstName: r.firstName, brand, eyebrow: "Code violation", title: "A case was assigned to you",
          intro: `${by} made you the case manager on ${c.caseNumber}.`,
          rows: [["Case", `${c.caseNumber} · ${c.title}`], ["Property", property(c)], ["Jurisdiction", c.jurisdiction ?? "—"], ["Compliance deadline", c.currentDeadline ? format(c.currentDeadline, "EEE MMM d, yyyy") : "Not set"]].map(([label, value]) => ({ label, value })),
          url: caseUrl(c.id), cta: "Open the case", subject: `Assigned to you: ${c.caseNumber} ${c.title}`,
        }),
    });
  });
}

/** A violation item was handed to someone. */
export function notifyItemAssigned(caseId: string, itemId: string, assigneeId: string, actorUserId: string | null): Promise<void> {
  return safe("item_assigned", async () => {
    const [c, item] = await Promise.all([loadCase(caseId), prisma.codeViolationItem.findUnique({ where: { id: itemId }, select: { itemNumber: true, description: true, correctiveAction: true, targetCompletionAt: true, responsibleTrade: true } })]);
    if (!c || !item) return;
    const brand = await getEmailBrand();
    const by = await actorName(actorUserId);
    await dispatch({
      kind: "item_assigned", caseId, leadId: c.leadId, actorUserId,
      candidates: [{ userId: assigneeId, reason: "assignee" }],
      bellBody: `${c.caseNumber} · Item ${item.itemNumber} assigned to you — ${item.description.slice(0, 80)}`,
      render: (r) =>
        renderCaseNoticeEmail({
          recipientFirstName: r.firstName, brand, eyebrow: "Code violation item", title: `Item ${item.itemNumber} on ${c.caseNumber} is yours`,
          intro: `${by} assigned you a violation item to correct.`,
          rows: [["Violation", item.description], ["Corrective action", item.correctiveAction ?? "—"], ["Trade", item.responsibleTrade ?? "—"], ["Target", item.targetCompletionAt ? format(item.targetCompletionAt, "EEE MMM d, yyyy") : "—"], ["Property", property(c)]].map(([label, value]) => ({ label, value })),
          url: `${caseUrl(c.id, "items")}&item=${itemId}`, cta: "Open the item", subject: `${c.caseNumber} · Item ${item.itemNumber}: ${item.description.slice(0, 60)}`,
        }),
    });
  });
}

/** An agency inspection is on the calendar; tell the attendee. */
export function notifyInspectionScheduled(caseId: string, inspectionId: string, actorUserId: string | null): Promise<void> {
  return safe("inspection_scheduled", async () => {
    const [c, i] = await Promise.all([loadCase(caseId), prisma.codeViolationInspection.findUnique({ where: { id: inspectionId }, select: { kind: true, scheduledFor: true, attendeeUserId: true, inspectorName: true, notes: true } })]);
    if (!c || !i || !i.scheduledFor) return;
    const at = i.scheduledFor;
    const attendee = i.attendeeUserId ?? c.caseManagerId;
    if (!attendee) return;
    const brand = await getEmailBrand();
    await dispatch({
      kind: "inspection_scheduled", caseId, leadId: c.leadId, actorUserId,
      candidates: [{ userId: attendee, reason: "assignee" }],
      bellBody: `${c.caseNumber} — agency ${i.kind.toLowerCase()} ${format(at, "EEE MMM d · h:mm a")}`,
      render: (r) =>
        renderCaseNoticeEmail({
          recipientFirstName: r.firstName, brand, eyebrow: "Agency inspection", title: `Agency ${i.kind.toLowerCase()} scheduled on ${c.caseNumber}`,
          intro: i.attendeeUserId === r.userId ? "You are down to attend." : "No attendee is set yet — you are the case manager.",
          rows: [["When", format(at, "EEE MMM d, yyyy · h:mm a")], ["Property", property(c)], ["Inspector", i.inspectorName ?? "—"], ["Notes", i.notes ?? "—"]].map(([label, value]) => ({ label, value })),
          url: caseUrl(c.id, "inspections"), cta: "Open inspections", subject: `${c.caseNumber}: agency ${i.kind.toLowerCase()} ${format(at, "MMM d, h:mm a")}`,
        }),
    });
  });
}

/** The agency confirmed compliance — the case manager, the linked job's PM and the creator hear it. */
export function notifyAgencyConfirmation(caseId: string, actorUserId: string | null): Promise<void> {
  return safe("agency_confirmed", async () => {
    const c = await loadCase(caseId);
    if (!c) return;
    const brand = await getEmailBrand();
    await dispatch({
      kind: "agency_confirmed", caseId, leadId: c.leadId, actorUserId,
      candidates: [{ userId: c.caseManagerId, reason: "assignee" }, { userId: c.job?.projectManagerId, reason: "watcher" }, { userId: c.createdByUserId, reason: "assignor" }],
      bellBody: `${c.caseNumber} — the agency confirmed compliance`,
      render: (r) =>
        renderCaseNoticeEmail({
          recipientFirstName: r.firstName, brand, eyebrow: "Compliance confirmed", title: `${c.caseNumber} is in compliance`,
          intro: "The issuing agency's confirmation is on the case. Fines and liens still need to be resolved before it closes.",
          rows: [["Case", `${c.caseNumber} · ${c.title}`], ["Property", property(c)], ["Confirmed", `${c.agencyConfirmedAt ? format(c.agencyConfirmedAt, "MMM d, yyyy") : "—"}${c.agencyConfirmedByName ? ` by ${c.agencyConfirmedByName}` : ""}`], ["Official compliance date", c.officialComplianceDate ? format(c.officialComplianceDate, "MMM d, yyyy") : "—"]].map(([label, value]) => ({ label, value })),
          url: caseUrl(c.id), cta: "Open the case", subject: `Compliance confirmed: ${c.caseNumber} ${c.title}`,
        }),
    });
  });
}

export function notifyCaseClosed(caseId: string, actorUserId: string | null): Promise<void> {
  return safe("case_closed", async () => {
    const c = await loadCase(caseId);
    if (!c) return;
    const brand = await getEmailBrand();
    const by = await actorName(actorUserId);
    await dispatch({
      kind: "case_closed", caseId, leadId: c.leadId, actorUserId,
      candidates: [{ userId: c.caseManagerId, reason: "assignee" }, { userId: c.job?.projectManagerId, reason: "watcher" }, { userId: c.createdByUserId, reason: "assignor" }],
      bellBody: `${c.caseNumber} closed${c.closureOverrideReason ? " (with override)" : ""}`,
      render: (r) =>
        renderCaseNoticeEmail({
          recipientFirstName: r.firstName, brand, eyebrow: "Case closed", title: `${c.caseNumber} was closed`,
          intro: `${by} closed the case${c.closureOverrideReason ? " with an override — not every closure condition was met" : ""}.`,
          rows: [["Case", `${c.caseNumber} · ${c.title}`], ["Property", property(c)], ["Closed", c.closedAt ? format(c.closedAt, "MMM d, yyyy") : "—"], ...(c.closureOverrideReason ? [["Override reason", c.closureOverrideReason]] : [])].map(([label, value]) => ({ label, value })),
          url: caseUrl(c.id), cta: "Open the case", subject: `Closed: ${c.caseNumber} ${c.title}`,
        }),
    });
  });
}
