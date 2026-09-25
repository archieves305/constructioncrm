import { format } from "date-fns";
import { escapeHtml } from "@/lib/email/escape";
import type { EmailBrand } from "@/lib/email/brand";
import { renderEmailLayout } from "@/lib/email/layout";

/**
 * Every code-violation mail on the branded shell. Pure renderers: the
 * runners decide who and when, these decide what it says.
 */

export type RenderedEmail = { subject: string; html: string; text: string };

export type DeadlineEmailItem = {
  caseNumber: string;
  caseTitle: string;
  property: string;
  label: string;
  at: Date;
  daysRemaining: number;
  url: string;
};

function pill(label: string, fg: string, bg: string, border: string): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;color:${fg};background:${bg};border:1px solid ${border}">${escapeHtml(label)}</span>`;
}
function eyebrow(text: string, color: string): string {
  return `<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color};margin-bottom:6px">${escapeHtml(text)}</div>`;
}
function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#111827">${escapeHtml(text)}</h1>`;
}
function when(i: DeadlineEmailItem): { label: string; fg: string; bg: string; border: string } {
  if (i.daysRemaining < 0) return { label: `${-i.daysRemaining}d overdue`, fg: "#b91c1c", bg: "#fef2f2", border: "#fca5a5" };
  if (i.daysRemaining === 0) return { label: "today", fg: "#b45309", bg: "#fffbeb", border: "#fcd34d" };
  return { label: `in ${i.daysRemaining}d`, fg: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" };
}

function itemRows(items: DeadlineEmailItem[]): string {
  return items
    .map((i) => {
      const w = when(i);
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
          <a href="${escapeHtml(i.url)}" style="font-size:14px;font-weight:600;color:#111827;text-decoration:none">${escapeHtml(i.label)} · ${escapeHtml(format(i.at, "EEE MMM d"))}</a>
          <div style="font-size:12px;color:#6b7280;margin-top:2px"><span style="font-family:ui-monospace,monospace">${escapeHtml(i.caseNumber)}</span> · ${escapeHtml(i.caseTitle)}</div>
          <div style="font-size:12px;color:#6b7280">${escapeHtml(i.property)}</div>
        </td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;vertical-align:top">${pill(w.label, w.fg, w.bg, w.border)}</td>
      </tr>`;
    })
    .join("");
}
function itemText(items: DeadlineEmailItem[]): string[] {
  return items.map((i) => `  - ${i.label} · ${format(i.at, "EEE MMM d")} (${when(i).label}) — ${i.caseNumber} ${i.caseTitle} — ${i.property}\n    ${i.url}`);
}

/** One digest per person per run: overdue, due today, coming up. */
export function renderViolationDeadlineEmail(input: { recipientFirstName: string; overdue: DeadlineEmailItem[]; dueToday: DeadlineEmailItem[]; upcoming: DeadlineEmailItem[]; brand: EmailBrand }): RenderedEmail {
  const { brand } = input;
  const section = (label: string, items: DeadlineEmailItem[], color: string) =>
    items.length === 0 ? "" : `${eyebrow(label, color)}<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 18px">${itemRows(items)}</table>`;
  const total = input.overdue.length + input.dueToday.length + input.upcoming.length;
  const bodyHtml = `
${heading(input.overdue.length > 0 ? "Code violation deadlines — some are overdue" : total === 1 ? "A code violation deadline is coming up" : "Code violation deadlines coming up")}
<p style="margin:0 0 14px;font-size:15px;color:#374151">Hi ${escapeHtml(input.recipientFirstName)} — here is what is due on the cases you cover.</p>
${section("Overdue", input.overdue, "#b91c1c")}
${section("Due today", input.dueToday, "#b45309")}
${section("Coming up", input.upcoming, "#1d4ed8")}`;
  const textLines = [`Hi ${input.recipientFirstName} — here is what is due on the cases you cover.`, ""];
  if (input.overdue.length) textLines.push("OVERDUE", ...itemText(input.overdue), "");
  if (input.dueToday.length) textLines.push("DUE TODAY", ...itemText(input.dueToday), "");
  if (input.upcoming.length) textLines.push("COMING UP", ...itemText(input.upcoming), "");
  const rendered = renderEmailLayout({ bodyHtml, bodyText: textLines.join("\n"), brand });
  const first = input.overdue[0] ?? input.dueToday[0] ?? input.upcoming[0];
  const subject =
    input.overdue.length > 0
      ? `${input.overdue.length} overdue code violation deadline${input.overdue.length === 1 ? "" : "s"}`
      : total === 1 && first
        ? `${first.caseNumber}: ${first.label} ${first.daysRemaining === 0 ? "today" : `in ${first.daysRemaining} day${first.daysRemaining === 1 ? "" : "s"}`}`
        : `${total} code violation deadlines coming up`;
  return { subject, html: rendered.html, text: rendered.text };
}

export type EscalationEmailItem = {
  caseNumber: string;
  caseTitle: string;
  property: string;
  jurisdiction: string | null;
  deadline: Date;
  daysOverdue: number;
  level: number;
  caseManagerName: string;
  exposure: string | null;
  url: string;
};

export function renderCaseEscalationEmail(input: { recipientFirstName: string; recipientReason: "case_manager" | "manager" | "admin"; items: EscalationEmailItem[]; brand: EmailBrand }): RenderedEmail {
  const { brand, items } = input;
  const intro =
    input.recipientReason === "case_manager"
      ? "These cases you manage are past their compliance deadline and fines may be accruing."
      : input.recipientReason === "manager"
        ? "You are getting this as a manager: these cases are well past their compliance deadline."
        : "You are getting this as an admin: these cases have been overdue long enough to reach the top of the chain.";
  const rows = items
    .map(
      (i) => `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
        <a href="${escapeHtml(i.url)}" style="font-size:14px;font-weight:600;color:#111827;text-decoration:none"><span style="font-family:ui-monospace,monospace">${escapeHtml(i.caseNumber)}</span> · ${escapeHtml(i.caseTitle)}</a>
        <div style="font-size:12px;color:#6b7280;margin-top:2px">${escapeHtml(i.property)}${i.jurisdiction ? ` · ${escapeHtml(i.jurisdiction)}` : ""} · ${escapeHtml(i.caseManagerName)}</div>
        <div style="font-size:12px;color:#6b7280">Deadline ${escapeHtml(format(i.deadline, "MMM d, yyyy"))}${i.exposure ? ` · est. exposure ${escapeHtml(i.exposure)}` : ""}</div>
      </td>
      <td style="padding:10px 0 10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;vertical-align:top">${pill(`${i.daysOverdue}d overdue`, "#b91c1c", "#fef2f2", "#fca5a5")}<br/>${pill(`level ${i.level}`, "#374151", "#f3f4f6", "#d1d5db")}</td>
    </tr>`,
    )
    .join("");
  const bodyHtml = `
${eyebrow("Escalation", "#b91c1c")}
${heading(items.length === 1 ? "A code violation is past its deadline" : `${items.length} code violations are past their deadline`)}
<p style="margin:0 0 4px;font-size:15px;color:#374151">Hi ${escapeHtml(input.recipientFirstName)} — ${escapeHtml(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-top:12px">${rows}</table>`;
  const textLines = [`Hi ${input.recipientFirstName} — ${intro}`, ""];
  for (const i of items) textLines.push(`  - ${i.caseNumber} ${i.caseTitle} — ${i.daysOverdue}d overdue (deadline ${format(i.deadline, "MMM d, yyyy")}) — ${i.property} — ${i.caseManagerName}${i.exposure ? ` — est. exposure ${i.exposure}` : ""}`, `    ${i.url}`);
  const rendered = renderEmailLayout({ bodyHtml, bodyText: textLines.join("\n"), brand });
  const first = items[0];
  return {
    subject: items.length === 1 && first ? `Overdue ${first.daysOverdue} days: ${first.caseNumber} ${first.caseTitle}` : `${items.length} code violations past their deadline`,
    html: rendered.html,
    text: rendered.text,
  };
}

export type CaseNoticeInput = {
  recipientFirstName: string;
  eyebrow: string;
  title: string;
  intro: string;
  rows: { label: string; value: string }[];
  url: string;
  cta: string;
  brand: EmailBrand;
  subject: string;
};

/** A single-case notice: assigned, item assigned, inspection scheduled, agency confirmed, closed. */
export function renderCaseNoticeEmail(input: CaseNoticeInput): RenderedEmail {
  const rows = input.rows
    .map((r) => `<tr><td style="padding:6px 12px 6px 0;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top">${escapeHtml(r.label)}</td><td style="padding:6px 0;font-size:14px;color:#111827">${escapeHtml(r.value)}</td></tr>`)
    .join("");
  const bodyHtml = `
${eyebrow(input.eyebrow, input.brand.primaryColor)}
${heading(input.title)}
<p style="margin:0 0 12px;font-size:15px;color:#374151">Hi ${escapeHtml(input.recipientFirstName)} — ${escapeHtml(input.intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px">${rows}</table>
<a href="${escapeHtml(input.url)}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:${escapeHtml(input.brand.primaryColor)};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">${escapeHtml(input.cta)}</a>`;
  const textLines = [`Hi ${input.recipientFirstName} — ${input.intro}`, "", ...input.rows.map((r) => `${r.label}: ${r.value}`), "", `${input.cta}: ${input.url}`];
  const rendered = renderEmailLayout({ bodyHtml, bodyText: textLines.join("\n"), brand: input.brand });
  return { subject: input.subject, html: rendered.html, text: rendered.text };
}
