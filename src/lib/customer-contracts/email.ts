// Customer-contract emails. Every dynamic string goes through escapeHtml and
// the branded shell (renderEmailLayout); the PDF rides along as an attachment.

import { env } from "@/lib/env";
import { jobText, type CustomerInput, type JobLabelInput } from "@/lib/labels/job";
import { getEmailBrand } from "@/lib/email/brand";
import { escapeHtml } from "@/lib/email/escape";
import { renderEmailLayout } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { formatMoney } from "./merge";
import type { CustomerContractSnapshot } from "./types";

export function appBaseUrl(): string {
  return (env.APP_BASE_URL || env.NEXTAUTH_URL || "").replace(/\/$/, "");
}

export function signUrlFor(token: string): string {
  return `${appBaseUrl()}/sign/${token}`;
}

type ContractForEmail = {
  id: string;
  jobId: string;
  contractNumber: string;
  snapshot: unknown;
  contractAmount: unknown;
  tokenExpiresAt: Date | null;
  signerName: string | null;
  signerEmail: string | null;
  signedAt: Date | null;
  declineReason: string | null;
  job: JobLabelInput & { title: string; lead: CustomerInput & { fullName: string; email: string | null } };
};

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

function button(href: string, label: string, color: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${escapeHtml(color)};color:#fff;padding:12px 22px;border-radius:6px;font-weight:600;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

function scheduleSummary(snap: CustomerContractSnapshot): { html: string; text: string } {
  const rows = snap.paymentSchedule.map((r) => `${r.label}: ${formatMoney(r.amount)} — ${r.trigger}`);
  return {
    html: `<ul style="margin:8px 0 0 18px;padding:0">${rows.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`,
    text: rows.map((r) => `  - ${r}`).join("\n"),
  };
}

const longDate = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });

/** The "please review and sign" email, PDF attached. Returns whether it went out. */
export async function sendContractEmail(c: ContractForEmail, pdf: Buffer, opts: { to: string; token: string; replyTo?: string | null; message?: string | null }): Promise<boolean> {
  const brand = await getEmailBrand();
  const snap = c.snapshot as CustomerContractSnapshot;
  const url = signUrlFor(opts.token);
  const sched = scheduleSummary(snap);
  const expires = c.tokenExpiresAt ? longDate(c.tokenExpiresAt) : null;
  const hi = firstName(c.job.lead.fullName);
  const bodyHtml = `
<p>Hi ${escapeHtml(hi)},</p>
<p>Please review and sign your agreement with ${escapeHtml(brand.companyName)} for <strong>${escapeHtml(c.job.title)}</strong> at ${escapeHtml(snap.jobSite.line1)}, ${escapeHtml(snap.jobSite.city)}.</p>
<p><strong>Contract price: ${escapeHtml(formatMoney(snap.price.total))}</strong></p>
<p>Payment schedule:</p>${sched.html}
${opts.message ? `<blockquote style="margin:16px 0;padding:10px 14px;border-left:3px solid ${escapeHtml(brand.primaryColor)};background:#f9fafb">${escapeHtml(opts.message).replace(/\n/g, "<br/>")}</blockquote>` : ""}
${button(url, "Review & Sign", brand.primaryColor)}
<p style="font-size:13px;color:#6b7280">If the button does not work, open this link:<br/><a href="${escapeHtml(url)}" style="color:${escapeHtml(brand.primaryColor)}">${escapeHtml(url)}</a></p>
<p style="font-size:13px;color:#6b7280">The full agreement is attached as a PDF.${expires ? ` This link expires on ${escapeHtml(expires)}.` : ""} Reply to this email with any questions.</p>`;
  const bodyText = `Hi ${hi},

Please review and sign your agreement with ${brand.companyName} for ${c.job.title} at ${snap.jobSite.line1}, ${snap.jobSite.city}.

Contract price: ${formatMoney(snap.price.total)}
Payment schedule:
${sched.text}
${opts.message ? `\n${opts.message}\n` : ""}
Review & sign: ${url}

The full agreement is attached as a PDF.${expires ? ` This link expires on ${expires}.` : ""}`;
  const { html, text } = renderEmailLayout({ bodyHtml, bodyText, brand });
  const result = await sendEmail({
    to: opts.to,
    subject: `Your agreement with ${brand.companyName} — ${c.job.title}`,
    html,
    text,
    replyTo: opts.replyTo ?? undefined,
    attachments: [{ filename: `${c.contractNumber}.pdf`, contentBase64: pdf.toString("base64") }],
  });
  return result != null;
}

/** Confirmation to the customer with the signed copy attached. */
export async function sendContractSignedCustomerEmail(c: ContractForEmail, signedPdf: Buffer, to: string): Promise<boolean> {
  const brand = await getEmailBrand();
  const snap = c.snapshot as CustomerContractSnapshot;
  const when = c.signedAt ? longDate(c.signedAt) : longDate(new Date());
  const bodyHtml = `
<p>Thank you, ${escapeHtml(c.signerName ?? firstName(c.job.lead.fullName))}.</p>
<p>You signed the ${escapeHtml(snap.template.title)} for <strong>${escapeHtml(c.job.title)}</strong> on ${escapeHtml(when)}. Your signed copy, including the signature certificate, is attached.</p>
<p>Contract price: <strong>${escapeHtml(formatMoney(snap.price.total))}</strong>. The deposit of ${escapeHtml(formatMoney(snap.depositAmount))} is due now; we will be in touch about scheduling.</p>
<p style="font-size:13px;color:#6b7280">Keep this email for your records. Reply with any questions.</p>`;
  const bodyText = `Thank you, ${c.signerName ?? firstName(c.job.lead.fullName)}.

You signed the ${snap.template.title} for ${c.job.title} on ${when}. Your signed copy, including the signature certificate, is attached.

Contract price: ${formatMoney(snap.price.total)}. The deposit of ${formatMoney(snap.depositAmount)} is due now; we will be in touch about scheduling.`;
  const { html, text } = renderEmailLayout({ bodyHtml, bodyText, brand });
  const result = await sendEmail({
    to,
    subject: `Signed: ${snap.template.title} — ${brand.companyName}`,
    html,
    text,
    attachments: [{ filename: `${c.contractNumber}-signed.pdf`, contentBase64: signedPdf.toString("base64") }],
  });
  return result != null;
}

/** Heads-up to the office: signed or declined. */
export async function sendContractOutcomeInternalEmail(
  c: ContractForEmail,
  outcome: "signed" | "declined",
  to: string[],
  signedPdf?: Buffer | null,
): Promise<boolean> {
  if (to.length === 0) return false;
  const brand = await getEmailBrand();
  const snap = c.snapshot as CustomerContractSnapshot;
  const jobUrl = `${appBaseUrl()}/jobs/${c.jobId}?tab=money&sub=contract`;
  const headline = outcome === "signed" ? `${c.contractNumber} signed by ${c.signerName ?? "the customer"}` : `${c.contractNumber} declined`;
  const detail =
    outcome === "signed"
      ? `<p>${escapeHtml(c.job.lead.fullName)} signed the agreement for <strong>${escapeHtml(jobText(c.job))}</strong> (${escapeHtml(formatMoney(snap.price.total))})${c.signedAt ? ` on ${escapeHtml(longDate(c.signedAt))}` : ""}. The job's contract amount and deposit are set from it.</p>`
      : `<p>${escapeHtml(c.job.lead.fullName)} declined the agreement for <strong>${escapeHtml(jobText(c.job))}</strong>.</p>${c.declineReason ? `<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #ef4444;background:#fef2f2">${escapeHtml(c.declineReason)}</blockquote>` : "<p><em>No reason given.</em></p>"}`;
  const bodyHtml = `<p><strong>${escapeHtml(headline)}</strong></p>${detail}${button(jobUrl, "Open job", brand.primaryColor)}`;
  const bodyText = `${headline}\n\n${outcome === "signed" ? `${c.job.lead.fullName} signed ${jobText(c.job)} (${formatMoney(snap.price.total)}).` : `${c.job.lead.fullName} declined ${jobText(c.job)}.${c.declineReason ? `\nReason: ${c.declineReason}` : ""}`}\n\nOpen job: ${jobUrl}`;
  const { html, text } = renderEmailLayout({ bodyHtml, bodyText, brand });
  try {
    const result = await sendEmail({
      to,
      subject: headline,
      html,
      text,
      attachments: signedPdf ? [{ filename: `${c.contractNumber}-signed.pdf`, contentBase64: signedPdf.toString("base64") }] : undefined,
    });
    return result != null;
  } catch (err) {
    logger.exception(err, { where: "contracts.internalEmail", contractId: c.id, outcome });
    return false;
  }
}
