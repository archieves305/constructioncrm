// The thank-you and review request a customer gets when their job closes.
// Pure: the caller loads the brand and sends. Every dynamic string is escaped
// and the body sits in the branded shell (renderEmailLayout).

import type { EmailBrand } from "@/lib/email/brand";
import { eyebrow, heading, panel } from "@/lib/email/components";
import { escapeHtml } from "@/lib/email/escape";
import { renderEmailLayout } from "@/lib/email/layout";

export type ReviewEmailInput = {
  brand: EmailBrand;
  firstName: string | null;
  /** The job's address; left out of the email when there is none. */
  address: string | null;
  unsubscribeUrl: string;
};

export type ReviewEmail = { subject: string; html: string; text: string };

const P = `margin:0 0 16px`;

/** A table-cell button: Outlook drops the padding of a bare inline-block link. */
function reviewButton(href: string, color: string): string {
  const c = escapeHtml(color);
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto">
  <tr><td bgcolor="${c}" style="background:${c};border-radius:6px">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none">Leave a review</a>
  </td></tr>
</table>`;
}

function reviewBlock(href: string, color: string): string {
  return `<div style="margin:28px 0;padding:24px 20px;background:#f9fafb;border-radius:8px;text-align:center">
  <div style="font-size:24px;line-height:1;letter-spacing:4px;color:#f59e0b;margin:0 0 10px" aria-hidden="true">★★★★★</div>
  <div style="font-size:16px;font-weight:600;color:#111827;margin:0 0 4px">How did we do?</div>
  <div style="font-size:14px;color:#4b5563;margin:0 0 18px">A short, honest review takes about a minute and helps other homeowners choose a contractor with confidence.</div>
  ${reviewButton(href, color)}
  <div style="font-size:12px;color:#6b7280;margin:16px 0 0;word-break:break-all">Button not working? Open this link:<br/><a href="${escapeHtml(href)}" style="color:#6b7280">${escapeHtml(href)}</a></div>
</div>`;
}

export function renderReviewRequestEmail(input: ReviewEmailInput): ReviewEmail {
  const { brand, address, unsubscribeUrl } = input;
  const name = input.firstName?.trim() || null;
  const company = brand.companyName;
  const reviewUrl = brand.reviewUrl?.trim() || null;
  const greeting = name ? `Hi ${name},` : "Hello,";
  const thanks = `Thank you for choosing ${company}. We enjoyed working with you, and we appreciate the trust you placed in our team.`;
  const closing = reviewUrl
    ? "If anything still needs attention, reply to this email and we will take care of it."
    : "We would love to hear how we did. Reply to this email and tell us about your experience, or let us know if anything still needs attention.";
  const preheader = reviewUrl ? "Thank you for working with us. Would you share your experience?" : "Thank you for working with us.";

  const bodyHtml = `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
${eyebrow("Project complete", brand.primaryColor)}
${heading(name ? `Thank you, ${name}` : "Thank you")}
<p style="${P}">Your project is complete. ${escapeHtml(thanks)}</p>
${address ? panel(`<div style="font-size:12px;color:#6b7280">Project address</div><div style="font-size:15px;font-weight:600;color:#111827">${escapeHtml(address)}</div>`, brand.primaryColor) : ""}
${reviewUrl ? reviewBlock(reviewUrl, brand.primaryColor) : ""}
<p style="margin:16px 0 0">${escapeHtml(closing)}</p>`;

  const bodyText = [
    greeting,
    "",
    `Your project${address ? ` at ${address}` : ""} is complete. ${thanks}`,
    ...(reviewUrl
      ? ["", "How did we do? A short, honest review takes about a minute and helps other homeowners choose a contractor with confidence.", "", `Leave a review: ${reviewUrl}`]
      : []),
    "",
    closing,
  ].join("\n");

  const { html, text } = renderEmailLayout({ bodyHtml, bodyText, brand, unsubscribeUrl });
  return { subject: `Your project is complete. Thank you from ${company}`, html, text };
}
