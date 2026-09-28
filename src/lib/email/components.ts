import { escapeHtml } from "./escape";

/**
 * The building blocks every internal email is made of, as complete HTML
 * strings with inline styles (mail clients ignore stylesheets). Single
 * column, tables for layout, pills that wrap under titles at phone width.
 * Text twins live beside the HTML so the plain-text part reads the same.
 */

export type Swatch = { bg: string; fg: string };

export const SWATCH = {
  neutral: { bg: "#f3f4f6", fg: "#374151" },
  info: { bg: "#dbeafe", fg: "#1e40af" },
  warning: { bg: "#fef3c7", fg: "#92400e" },
  danger: { bg: "#fee2e2", fg: "#991b1b" },
  success: { bg: "#d1fae5", fg: "#065f46" },
  violet: { bg: "#ede9fe", fg: "#5b21b6" },
} as const satisfies Record<string, Swatch>;

export const PRIORITY_SWATCH: Record<"LOW" | "MEDIUM" | "HIGH" | "URGENT", Swatch> = {
  LOW: SWATCH.neutral,
  MEDIUM: SWATCH.info,
  HIGH: SWATCH.warning,
  URGENT: SWATCH.danger,
};

export function pill(label: string, s: Swatch): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.02em;background:${s.bg};color:${s.fg};white-space:nowrap">${escapeHtml(label)}</span>`;
}

export function eyebrow(text: string, color: string): string {
  return `<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${escapeHtml(color)};margin:0 0 6px">${escapeHtml(text)}</div>`;
}

export function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:700;color:#111827">${escapeHtml(text)}</h1>`;
}

export function sectionHeading(label: string, count: number | null, accent: string): string {
  return `<div style="margin:22px 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${escapeHtml(accent)}">${escapeHtml(label)}${count !== null ? ` (${count})` : ""}</div>`;
}

export function groupHeading(label: string, code: string | null, href: string | null): string {
  const text = `${escapeHtml(label)}${code ? ` <span style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#6b7280">${escapeHtml(code)}</span>` : ""}`;
  const inner = href ? `<a href="${escapeHtml(href)}" style="color:#111827;text-decoration:none">${text}</a>` : text;
  return `<div style="margin:10px 0 2px;font-size:13px;font-weight:600;color:#111827">${inner}</div>`;
}

export function button(href: string, label: string, color: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${escapeHtml(color)};color:#ffffff;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;text-decoration:none">${escapeHtml(label)}</a>`;
}

export function panel(inner: string, accent: string, bg = "#f9fafb"): string {
  return `<div style="border-left:4px solid ${escapeHtml(accent)};background:${bg};padding:12px 14px;border-radius:0 6px 6px 0;margin:8px 0">${inner}</div>`;
}

/** One row of a digest: title (linked), a muted line under it, pills on the right that wrap below on a phone. */
export function itemRow(input: { href: string; title: string; meta?: string | null; pills?: string[]; muted?: boolean }): string {
  const pills = input.pills?.length ? `<div style="margin-top:4px">${input.pills.join(" ")}</div>` : "";
  return `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
      <a href="${escapeHtml(input.href)}" style="font-size:14px;font-weight:600;color:${input.muted ? "#6b7280" : "#111827"};text-decoration:none">${escapeHtml(input.title)}</a>
      ${input.meta ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${escapeHtml(input.meta)}</div>` : ""}
      ${pills}
    </td>
  </tr>`;
}

export function table(rows: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">${rows}</table>`;
}

export function moreLine(href: string | null, text: string): string {
  const inner = href ? `<a href="${escapeHtml(href)}" style="color:#1d4ed8;text-decoration:none">${escapeHtml(text)}</a>` : escapeHtml(text);
  return `<div style="padding:6px 12px;font-size:12px;color:#6b7280">${inner}</div>`;
}
