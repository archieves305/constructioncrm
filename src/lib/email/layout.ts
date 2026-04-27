import { EmailBrand, formatBrandAddress } from "./brand";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function defaultSignatureHtml(brand: EmailBrand): string {
  const lines: string[] = [`<strong>${escapeHtml(brand.companyName)}</strong>`];
  const address = formatBrandAddress(brand);
  if (address) lines.push(escapeHtml(address));
  if (brand.officePhone) lines.push(`Office: ${escapeHtml(brand.officePhone)}`);
  if (brand.mobilePhone) lines.push(`Cell: ${escapeHtml(brand.mobilePhone)}`);
  if (brand.contactEmail) {
    lines.push(
      `<a href="mailto:${escapeHtml(brand.contactEmail)}" style="color:${escapeHtml(brand.primaryColor)};text-decoration:none">${escapeHtml(brand.contactEmail)}</a>`,
    );
  }
  if (brand.website) {
    const href = brand.website.startsWith("http") ? brand.website : `https://${brand.website}`;
    lines.push(
      `<a href="${escapeHtml(href)}" style="color:${escapeHtml(brand.primaryColor)};text-decoration:none">${escapeHtml(brand.website)}</a>`,
    );
  }
  return lines.join("<br/>");
}

function defaultSignatureText(brand: EmailBrand): string {
  const lines: string[] = [brand.companyName];
  const address = formatBrandAddress(brand);
  if (address) lines.push(address);
  if (brand.officePhone) lines.push(`Office: ${brand.officePhone}`);
  if (brand.mobilePhone) lines.push(`Cell: ${brand.mobilePhone}`);
  if (brand.contactEmail) lines.push(brand.contactEmail);
  if (brand.website) lines.push(brand.website);
  return lines.join("\n");
}

export type LayoutInput = {
  bodyHtml: string;
  bodyText: string;
  brand: EmailBrand;
  signatureHtml?: string | null;
  signatureText?: string | null;
  unsubscribeUrl?: string | null;
};

export function renderEmailLayout(input: LayoutInput): { html: string; text: string } {
  const { bodyHtml, bodyText, brand, unsubscribeUrl } = input;
  const sigHtml = input.signatureHtml ?? brand.signatureHtml ?? defaultSignatureHtml(brand);
  const sigText = input.signatureText ?? brand.signatureText ?? defaultSignatureText(brand);
  const address = formatBrandAddress(brand);
  const color = brand.primaryColor;

  const headerHtml = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.companyName)}" style="max-height:48px;display:block" />`
    : `<div style="font-size:18px;font-weight:600;color:${escapeHtml(color)}">${escapeHtml(brand.companyName)}</div>`;

  const footerLines: string[] = [];
  if (address) footerLines.push(escapeHtml(address));
  if (unsubscribeUrl) {
    footerLines.push(
      `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a>`,
    );
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(brand.companyName)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
      <tr><td style="padding:24px 32px;border-bottom:3px solid ${escapeHtml(color)}">
        ${headerHtml}
      </td></tr>
      <tr><td style="padding:32px;font-size:15px;line-height:1.6;color:#1f2937">
        ${bodyHtml}
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:14px;line-height:1.5;color:#374151">
          ${sigHtml}
        </div>
      </td></tr>
      <tr><td style="padding:16px 32px;background:#f9fafb;font-size:11px;color:#6b7280;line-height:1.5;text-align:center">
        ${footerLines.join(" &middot; ")}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const textLines: string[] = [bodyText.trim(), "", "---", sigText];
  if (unsubscribeUrl) {
    textLines.push("", `Unsubscribe: ${unsubscribeUrl}`);
  }
  const text = textLines.join("\n");

  return { html, text };
}
