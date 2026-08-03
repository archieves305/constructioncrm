import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { recordAudit } from "@/lib/audit/record";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { getEmailBrand } from "@/lib/email/brand";
import { renderEmailLayout } from "@/lib/email/layout";

/**
 * Makes email delivery failures impossible to miss.
 *
 * Every scheduled sender in this codebase catches per-recipient errors and
 * still returns HTTP 200, so a job that delivered nothing looked identical to
 * one that delivered everything. That is how a MailerSend trial cap blocked
 * an entire staff domain for weeks: `field-log-digest` failed for all four of
 * its recipients every weekday morning and reported success each time.
 *
 * Three channels, deliberately, because they fail independently:
 *
 *   1. A structured ERROR log carrying a stable marker to grep or alert on.
 *   2. A durable AuditEvent row — survives log rotation, and is the ONLY
 *      channel that still works when email itself is the broken thing.
 *   3. A best-effort alert email to whoever runs the system.
 *
 * Channel 3 obviously cannot report "all email is down". That is exactly why
 * channels 1 and 2 exist and why this never throws: a reporting failure must
 * not take down the job it is reporting on.
 */

/** Stable, greppable. Point log alerting at this string. */
export const DELIVERY_FAILURE_MARKER = "EMAIL_DELIVERY_FAILURE";

export type DeliveryFailure = { recipient: string; reason: string };

export type DeliveryReport = {
  /** Where it happened, e.g. "cron.task-reminders". Used as the audit key. */
  source: string;
  attempted: number;
  sent: number;
  failures: DeliveryFailure[];
  context?: Record<string, unknown>;
};

/**
 * Guards against a reporting loop: the alert email is itself a send, and a
 * failing send must never trigger another alert about the alert.
 */
let reportingInProgress = false;

/** Ops recipient: explicit env var, else the first active ADMIN. */
async function resolveOpsRecipient(): Promise<string | null> {
  if (env.OPS_ALERT_EMAIL) return env.OPS_ALERT_EMAIL;
  const admin = await prisma.user.findFirst({
    where: { isActive: true, role: { name: "ADMIN" } },
    orderBy: { createdAt: "asc" },
    select: { email: true },
  });
  return admin?.email ?? null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Record and escalate the outcome of a batch of sends.
 *
 * Call this once per job run, ALWAYS — including on success, so the happy
 * path is logged in the same shape and "no news" stops being ambiguous.
 */
export async function reportDelivery(report: DeliveryReport): Promise<void> {
  const { source, attempted, sent, failures } = report;

  // Nothing was even attempted — not interesting.
  if (attempted === 0) return;

  // The silent-skip case: sends were attempted, none succeeded, and nothing
  // errored. That means sendEmail returned null for every one, i.e. the mail
  // provider is unconfigured. Previously indistinguishable from success.
  const silentlySkipped = failures.length === 0 && sent === 0;

  if (failures.length === 0 && !silentlySkipped) {
    logger.info("email delivery ok", { source, attempted, sent });
    return;
  }

  const summary = {
    source,
    attempted,
    sent,
    failed: failures.length,
    reason: silentlySkipped ? "email provider not configured" : "per-recipient failures",
    recipients: failures.map((f) => f.recipient),
    ...report.context,
  };

  // Channel 1 — loud, structured, greppable.
  logger.error(`${DELIVERY_FAILURE_MARKER} ${source}`, summary);

  // Channel 2 — durable, and the only one that survives email being down.
  await recordAudit({
    actorUserId: null,
    entityType: "EmailDelivery",
    entityId: source,
    action: "delivery_failure",
    after: { ...summary, failures },
  });

  // Channel 3 — best effort. Never recursive, never throws.
  if (reportingInProgress) return;
  if (silentlySkipped || !isEmailConfigured()) return;

  reportingInProgress = true;
  try {
    await sendOpsAlert(report, summary.reason);
  } catch (err) {
    logger.exception(err, { where: "reportDelivery.alert", source });
  } finally {
    reportingInProgress = false;
  }
}

async function sendOpsAlert(report: DeliveryReport, reason: string): Promise<void> {
  const to = await resolveOpsRecipient();
  if (!to) {
    logger.warn("no ops alert recipient — set OPS_ALERT_EMAIL or keep an active ADMIN", {
      source: report.source,
    });
    return;
  }

  const brand = await getEmailBrand();

  const rows = report.failures
    .map(
      (f) => `<tr>
      <td style="padding:6px 12px 6px 0;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827">${escapeHtml(f.recipient)}</td>
      <td style="padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:13px;color:#b91c1c">${escapeHtml(f.reason)}</td>
    </tr>`,
    )
    .join("");

  const bodyHtml = `
<div style="font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#b91c1c;margin:0 0 6px">Email delivery failure</div>
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:700;color:#111827">${escapeHtml(report.source)} could not reach ${report.failures.length} recipient${report.failures.length === 1 ? "" : "s"}</h1>
<p style="margin:0 0 16px;font-size:15px;color:#374151">
  ${report.sent} of ${report.attempted} messages were delivered. The job itself
  completed — these failures would not otherwise have surfaced anywhere.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:8px 0 16px">
  <tr>
    <th align="left" style="padding:0 12px 6px 0;border-bottom:2px solid #cbd5e1;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280">Recipient</th>
    <th align="left" style="padding:0 0 6px;border-bottom:2px solid #cbd5e1;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280">Reason</th>
  </tr>
  ${rows}
</table>
<p style="margin:0;font-size:13px;color:#6b7280">
  Cause recorded as: ${escapeHtml(reason)}. A durable record is in the audit log
  under <strong>EmailDelivery</strong>, readable at
  ${escapeHtml(env.APP_BASE_URL)}/api/admin/email-health even if email is down.
</p>`;

  const bodyText = [
    "EMAIL DELIVERY FAILURE",
    "",
    `${report.source} could not reach ${report.failures.length} recipient(s).`,
    `${report.sent} of ${report.attempted} delivered.`,
    "",
    ...report.failures.map((f) => `  - ${f.recipient}: ${f.reason}`),
    "",
    `Cause: ${reason}`,
    `Audit: ${env.APP_BASE_URL}/api/admin/email-health`,
  ].join("\n");

  const rendered = renderEmailLayout({ bodyHtml, bodyText, brand });

  await sendEmail({
    to,
    subject: `[CRM] ${report.source} failed to email ${report.failures.length} recipient${report.failures.length === 1 ? "" : "s"}`,
    html: rendered.html,
    text: rendered.text,
  });
}
