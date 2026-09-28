import type { RoleName } from "@/generated/prisma/client";
import type { EmailBrand } from "@/lib/email/brand";
import { button, eyebrow, groupHeading, heading, itemRow, moreLine, pill, PRIORITY_SWATCH, sectionHeading, SWATCH, table } from "@/lib/email/components";
import { escapeHtml } from "@/lib/email/escape";
import { renderEmailLayout } from "@/lib/email/layout";
import { DIGEST_SECTION_LABEL, type DigestSection } from "../kinds";
import { absoluteUrl, hrefForRole } from "../links";
import { SLOT_LABEL, type DigestSlot } from "../windows";
import type { DigestItem, DigestModel } from "./build";

/**
 * The digest email. One column, action first, every line a link into the
 * CRM, nothing that says "you have new notifications". Pure: model + agenda
 * + who it is for → subject, HTML, text.
 */

/** What the person has on today (or tomorrow, in the evening), from the calendar, not from rows. */
export type AgendaItem = {
  title: string;
  /** "9:00 – 11:00 AM" · "All day" · "Overdue since Sep 24". */
  when: string;
  context: string;
  href: string;
  tone: "overdue" | "today" | "upcoming" | "event";
};

export type AgendaModel = {
  heading: string;
  items: AgendaItem[];
  /** Tasks whose day or time moved since yesterday's digest. */
  changes: { title: string; from: string; to: string; byName: string | null; href: string }[];
  /** Jobs whose target start is today. */
  starting: { title: string; href: string }[];
};

export type RenderDigestInput = {
  recipientFirstName: string;
  role: RoleName;
  slot: DigestSlot;
  model: DigestModel;
  agenda: AgendaModel | null;
  /** ISO of the previous window, for the "View all activity" link. */
  since: Date;
  brand: EmailBrand;
};

const SECTION_ACCENT: Record<DigestSection, string> = {
  ACTION_REQUIRED: "#b91c1c",
  TODAY: "#1d4ed8",
  ASSIGNED: "#1d4ed8",
  JOB_UPDATES: "#374151",
  COMPLETED: "#047857",
  UPCOMING: "#6d28d9",
  OTHER: "#6b7280",
};

const KIND_WORD: Record<string, string> = {
  "task.assigned": "Assigned to you",
  "task.reassigned": "Reassigned to you",
  "task.ready": "Ready",
  "task.completed": "Completed",
  "task.blocked": "Blocked",
  "task.mentioned": "Mentioned you",
  "task.nudged": "Nudge",
  "task.overdue": "Overdue",
  "task.due_today": "Due today",
  "task.reminder": "Reminder",
  "task.escalated": "Escalated",
  "case.assigned": "Case assigned",
  "case.item_assigned": "Item assigned",
  "case.inspection_scheduled": "Inspection scheduled",
  "case.agency_confirmed": "Agency confirmed",
  "case.closed": "Case closed",
  "case.deadline": "Deadline",
  "daily_log.draft_reminder": "Daily log open",
  "contract.outcome": "Contract",
};

function itemPills(i: DigestItem): string[] {
  const out: string[] = [];
  const word = KIND_WORD[i.kind];
  if (word) out.push(pill(word, i.kind === "task.completed" ? SWATCH.success : i.actionRequired ? SWATCH.warning : SWATCH.neutral));
  if (i.priority === "URGENT" || i.priority === "HIGH") out.push(pill(i.priority, PRIORITY_SWATCH[i.priority]));
  if (i.occurrences > 1 && !i.collapsed) out.push(pill(`×${i.occurrences}`, SWATCH.neutral));
  return out;
}

function itemMeta(i: DigestItem): string | null {
  if (i.collapsed) {
    const rest = i.collapsed.count - i.collapsed.titles.length;
    return `${i.collapsed.titles.join(" · ")}${rest > 0 ? ` · +${rest} more` : ""}`;
  }
  return i.body ? i.body.replace(/\s+/g, " ").slice(0, 160) : null;
}

/** ≤ 78 chars, says what is in it, never "You have new notifications". */
export function digestSubject(model: DigestModel, agenda: AgendaModel | null, slot: DigestSlot): string {
  const label = SLOT_LABEL[slot];
  const action = model.actionCount;
  const updates = model.itemCount - action;
  const agendaCount = agenda?.items.length ?? 0;
  let head: string;
  if (action === 1) {
    const first = model.sections.find((s) => s.section === "ACTION_REQUIRED")?.groups[0];
    const item = first?.items[0];
    head = item ? `${KIND_WORD[item.kind] ?? "Action"}: ${item.title}${first.label && first.key !== "none" ? ` at ${first.label}` : ""}` : "1 to action";
  } else if (action > 1) head = `${action} to action${updates ? ` · ${updates} update${updates === 1 ? "" : "s"}` : ""}`;
  else if (updates > 0) head = `${updates} update${updates === 1 ? "" : "s"} on your jobs`;
  else if (agendaCount > 0) head = `Your ${slot === "evening" ? "tomorrow" : slot}: ${agendaCount} scheduled`;
  else head = "Nothing new";
  const full = `${head} — ${label}`;
  return full.length <= 78 ? full : `${full.slice(0, 75)}…`;
}

function sectionHtml(section: DigestSection, groups: DigestModel["sections"][number]["groups"], hiddenGroups: number, role: RoleName): string {
  const accent = SECTION_ACCENT[section];
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const body = groups
    .map((g) => {
      const rows = g.items.map((i) => itemRow({ href: absoluteUrl(hrefForRole(i.href, role)), title: i.title, meta: itemMeta(i), pills: itemPills(i), muted: i.kind === "task.completed" })).join("");
      const more = g.hidden > 0 ? moreLine(g.href ? absoluteUrl(hrefForRole(g.href, role)) : null, `+${g.hidden} more on ${g.label}`) : "";
      return `${groupHeading(g.label, g.code, g.href ? absoluteUrl(hrefForRole(g.href, role)) : null)}${table(rows)}${more}`;
    })
    .join("");
  const moreGroups = hiddenGroups > 0 ? moreLine(absoluteUrl(role === "CREW_LEAD" ? "/field/tasks" : "/tasks?scope=mine"), `+${hiddenGroups} more ${hiddenGroups === 1 ? "subject" : "subjects"}`) : "";
  return `${sectionHeading(DIGEST_SECTION_LABEL[section], count, accent)}${body}${moreGroups}`;
}

function agendaHtml(a: AgendaModel, role: RoleName): string {
  const parts: string[] = [];
  if (a.starting.length) {
    parts.push(sectionHeading("Starting today", a.starting.length, "#047857"));
    parts.push(table(a.starting.map((s) => itemRow({ href: absoluteUrl(hrefForRole(s.href, role)), title: s.title, meta: "Target start date is today" })).join("")));
  }
  if (a.items.length) {
    parts.push(sectionHeading(a.heading, a.items.length, "#1d4ed8"));
    parts.push(
      table(
        a.items
          .map((i) =>
            itemRow({
              href: absoluteUrl(hrefForRole(i.href, role)),
              title: i.title,
              meta: `${i.when} · ${i.context}`,
              pills: i.tone === "overdue" ? [pill("Overdue", SWATCH.danger)] : i.tone === "event" ? [pill("Appointment", SWATCH.info)] : [],
            }),
          )
          .join(""),
      ),
    );
  }
  if (a.changes.length) {
    parts.push(sectionHeading("Schedule changed since yesterday", a.changes.length, "#b45309"));
    parts.push(table(a.changes.map((c) => itemRow({ href: absoluteUrl(hrefForRole(c.href, role)), title: c.title, meta: `${c.from} → ${c.to}${c.byName ? ` · moved by ${c.byName}` : ""}` })).join("")));
  }
  return parts.join("");
}

function agendaText(a: AgendaModel, role: RoleName): string[] {
  const lines: string[] = [];
  if (a.starting.length) {
    lines.push(`STARTING TODAY (${a.starting.length}):`);
    for (const s of a.starting) lines.push(`  - ${s.title}`, `    ${absoluteUrl(hrefForRole(s.href, role))}`);
    lines.push("");
  }
  if (a.items.length) {
    lines.push(`${a.heading.toUpperCase()} (${a.items.length}):`);
    for (const i of a.items) lines.push(`  - ${i.when} · ${i.title} — ${i.context}${i.tone === "overdue" ? " [OVERDUE]" : ""}`, `    ${absoluteUrl(hrefForRole(i.href, role))}`);
    lines.push("");
  }
  if (a.changes.length) {
    lines.push(`SCHEDULE CHANGED SINCE YESTERDAY (${a.changes.length}):`);
    for (const c of a.changes) lines.push(`  - ${c.title}: ${c.from} → ${c.to}${c.byName ? ` (moved by ${c.byName})` : ""}`, `    ${absoluteUrl(hrefForRole(c.href, role))}`);
    lines.push("");
  }
  return lines;
}

export function renderDigestEmail(input: RenderDigestInput): { subject: string; html: string; text: string } {
  const { model, agenda, role, brand } = input;
  const subject = digestSubject(model, agenda, input.slot);
  const headline = subject.replace(/ — [^—]+$/, "");
  const activityUrl = absoluteUrl(`/notifications?since=${encodeURIComponent(input.since.toISOString())}`);

  const sectionsHtml = model.sections.map((s) => sectionHtml(s.section, s.groups, s.hiddenGroups, role)).join("");
  const bodyHtml = `
${eyebrow(SLOT_LABEL[input.slot], brand.primaryColor)}
${heading(headline)}
<p style="margin:0 0 4px;font-size:15px;color:#374151">Hi ${escapeHtml(input.recipientFirstName)} — ${input.slot === "morning" ? "here is your day and what changed overnight." : input.slot === "evening" ? "here is what happened since this afternoon and what is on tomorrow." : "here is what happened since the last digest."}</p>
${agenda ? agendaHtml(agenda, role) : ""}
${sectionsHtml}
${model.hiddenCount > 0 ? `<p style="margin:16px 0 0;font-size:12px;color:#6b7280">${model.hiddenCount} more ${model.hiddenCount === 1 ? "item is" : "items are"} in the CRM.</p>` : ""}
<p style="margin:20px 0 0">${button(activityUrl, "View all activity", brand.primaryColor)}</p>`;

  const textLines: string[] = [`${SLOT_LABEL[input.slot]} — ${headline}`, ""];
  if (agenda) textLines.push(...agendaText(agenda, role));
  for (const s of model.sections) {
    const count = s.groups.reduce((n, g) => n + g.items.length, 0);
    textLines.push(`${DIGEST_SECTION_LABEL[s.section].toUpperCase()} (${count}):`);
    for (const g of s.groups) {
      textLines.push(`  ${g.label}${g.code ? ` (${g.code})` : ""}`);
      for (const i of g.items) {
        const word = KIND_WORD[i.kind];
        textLines.push(`    - ${word ? `[${word}] ` : ""}${i.title}${i.collapsed ? ` (${i.collapsed.titles.join(", ")}${i.collapsed.count > i.collapsed.titles.length ? `, +${i.collapsed.count - i.collapsed.titles.length} more` : ""})` : ""}`, `      ${absoluteUrl(hrefForRole(i.href, role))}`);
      }
      if (g.hidden > 0) textLines.push(`    +${g.hidden} more on ${g.label}`);
    }
    if (s.hiddenGroups > 0) textLines.push(`  +${s.hiddenGroups} more subjects`);
    textLines.push("");
  }
  textLines.push(`View all activity: ${activityUrl}`);

  const rendered = renderEmailLayout({ bodyHtml, bodyText: textLines.join("\n"), brand });
  return { subject, html: rendered.html, text: rendered.text };
}
