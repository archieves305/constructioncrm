import { format } from "date-fns";
import { renderEmailLayout } from "@/lib/email/layout";
import { formatAddressLine } from "@/lib/labels/address";
import { jobText, jobTextWithCustomer, type CustomerInput, type JobLabelInput } from "@/lib/labels/job";
import type { EmailBrand } from "@/lib/email/brand";
import type { Priority, TaskStatus } from "@/generated/prisma/client";

/**
 * Task notification bodies.
 *
 * These render the INNER body only and hand off to `renderEmailLayout`, which
 * supplies the logo, brand rule, card, signature and footer that the rest of
 * the CRM's mail already uses. Building a second, prettier shell here would
 * make task mail look like it came from a different company.
 *
 * Everything is tables and inline CSS on purpose: Outlook ignores <style>
 * blocks, flexbox and grid, and these land in Outlook constantly.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type TaskEmailPerson = { firstName: string; lastName: string };

export type TaskEmailTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueAt: Date | null;
  blockedReason: string | null;
  job: JobLabelInput | null;
  lead: (CustomerInput & { fullName: string }) | null;
  invoice?: { invoiceNumber: string } | null;
  estimate?: { estimateNumber: string; name: string } | null;
  prospect?: { propertyAddress1: string; city: string } | null;
  dailyLog?: { logDate: Date } | null;
  assignedTo: TaskEmailPerson | null;
  createdBy: TaskEmailPerson | null;
  completedBy: TaskEmailPerson | null;
};

export type TaskEmailNote = {
  authorName: string;
  body: string;
  createdAt: Date;
};

export type RenderedEmail = { subject: string; html: string; text: string };

// ─── Primitives ─────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape, then honour the line breaks the author typed. */
function escapeMultiline(s: string): string {
  return escapeHtml(s).replace(/\r?\n/g, "<br/>");
}

type Swatch = { fg: string; bg: string; border: string };

const PRIORITY_SWATCH: Record<Priority, Swatch> = {
  LOW: { fg: "#4b5563", bg: "#f3f4f6", border: "#d1d5db" },
  MEDIUM: { fg: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
  HIGH: { fg: "#b45309", bg: "#fffbeb", border: "#fcd34d" },
  URGENT: { fg: "#b91c1c", bg: "#fef2f2", border: "#fca5a5" },
};

const STATUS_SWATCH: Record<TaskStatus, Swatch> = {
  PENDING: { fg: "#4b5563", bg: "#f3f4f6", border: "#d1d5db" },
  IN_PROGRESS: { fg: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
  BLOCKED: { fg: "#b45309", bg: "#fffbeb", border: "#fcd34d" },
  COMPLETED: { fg: "#047857", bg: "#ecfdf5", border: "#a7f3d0" },
  CANCELLED: { fg: "#6b7280", bg: "#f9fafb", border: "#e5e7eb" },
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

function pill(label: string, s: Swatch): string {
  return `<span style="display:inline-block;padding:3px 10px;margin:0 6px 6px 0;border:1px solid ${s.border};border-radius:999px;background:${s.bg};color:${s.fg};font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap">${escapeHtml(label)}</span>`;
}

function personName(p: TaskEmailPerson | null): string {
  if (!p) return "—";
  return `${p.firstName} ${p.lastName}`.trim() || "—";
}

function formatDue(d: Date | null): string {
  return d ? format(d, "EEE, MMM d, yyyy") : "No due date";
}

function isOverdue(task: TaskEmailTask, now: Date): boolean {
  if (!task.dueAt) return false;
  if (task.status === "COMPLETED" || task.status === "CANCELLED") return false;
  return task.dueAt.getTime() < now.getTime();
}

/**
 * A padded-cell button rather than a styled <a>. Outlook collapses padding on
 * inline anchors, which turns the CTA into an underlined word — the one
 * element in the mail that has to survive.
 */
function button(href: string, label: string, color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px">
  <tr><td align="center" bgcolor="${escapeHtml(color)}" style="border-radius:6px">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}

function metaTable(rows: { label: string; value: string; accent?: string }[]): string {
  const body = rows
    .map(
      (r) => `<tr>
      <td style="padding:7px 16px 7px 0;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top">${escapeHtml(r.label)}</td>
      <td style="padding:7px 0;font-size:14px;color:${r.accent ?? "#111827"};font-weight:${r.accent ? "700" : "500"};vertical-align:top">${escapeHtml(r.value)}</td>
    </tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 8px;border-collapse:collapse">${body}</table>`;
}

/** Quiet panel with a coloured spine — used for descriptions and notes. */
function panel(inner: string, accent: string, bg = "#f9fafb"): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0;border-collapse:separate">
  <tr><td style="padding:14px 16px;background:${bg};border-left:3px solid ${accent};border-radius:0 6px 6px 0;font-size:14px;line-height:1.6;color:#374151">${inner}</td></tr>
</table>`;
}

function eyebrow(text: string, color: string): string {
  return `<div style="font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${escapeHtml(color)};margin:0 0 6px">${escapeHtml(text)}</div>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;font-weight:700;color:#111827">${escapeHtml(text)}</h1>`;
}

// ─── Shared task block ──────────────────────────────────────────────────────

/**
 * The pills + metadata + description that every task email shares, so an
 * assignment and a completion read as the same object seen at two moments.
 */
function taskBlock(task: TaskEmailTask, now: Date): { html: string; text: string[] } {
  const overdue = isOverdue(task, now);
  const dueSwatch: Swatch = overdue
    ? { fg: "#b91c1c", bg: "#fef2f2", border: "#fca5a5" }
    : { fg: "#4b5563", bg: "#f3f4f6", border: "#d1d5db" };

  const pills = [
    pill(task.priority, PRIORITY_SWATCH[task.priority]),
    pill(STATUS_LABEL[task.status], STATUS_SWATCH[task.status]),
    task.dueAt
      ? pill(`${overdue ? "Overdue — " : "Due "}${format(task.dueAt, "MMM d")}`, dueSwatch)
      : "",
  ].join("");

  // Most specific anchor first, then the job or lead it hangs off.
  const leadAddress = formatAddressLine(task.lead);
  const [contextLabel, context] = task.invoice
    ? ["Invoice", `${task.invoice.invoiceNumber}${task.job ? ` — ${jobText(task.job)}` : ""}`]
    : task.estimate
      ? ["Estimate", `${task.estimate.estimateNumber} — ${task.estimate.name}${leadAddress ? ` — ${leadAddress}` : ""}`]
      : task.dailyLog
        ? ["Daily log", `${format(task.dailyLog.logDate, "MMM d")}${task.job ? ` — ${jobText(task.job)}` : ""}`]
        : task.prospect
          ? ["Prospect", `${task.prospect.propertyAddress1}, ${task.prospect.city}`]
          : task.job
            ? ["Job", jobTextWithCustomer(task.job)]
            : task.lead
              ? ["Lead", leadAddress ? `${task.lead.fullName} — ${leadAddress}` : task.lead.fullName]
              : ["Lead", "—"];

  const rows = [
    { label: "Assigned to", value: personName(task.assignedTo) },
    { label: "Raised by", value: personName(task.createdBy) },
    {
      label: "Due",
      value: formatDue(task.dueAt) + (overdue ? " (overdue)" : ""),
      accent: overdue ? "#b91c1c" : undefined,
    },
    { label: contextLabel, value: context },
  ];

  let html = `<div style="margin:0 0 4px">${pills}</div>${metaTable(rows)}`;
  const text = [
    `Priority: ${task.priority}`,
    `Status: ${STATUS_LABEL[task.status]}`,
    `Assigned to: ${personName(task.assignedTo)}`,
    `Raised by: ${personName(task.createdBy)}`,
    `Due: ${formatDue(task.dueAt)}${overdue ? " (OVERDUE)" : ""}`,
    `${contextLabel}: ${context}`,
  ];

  if (task.description?.trim()) {
    html += panel(escapeMultiline(task.description.trim()), "#d1d5db");
    text.push("", "Details:", task.description.trim());
  }

  if (task.status === "BLOCKED" && task.blockedReason?.trim()) {
    html += panel(
      `<strong style="color:#b45309">Blocked:</strong> ${escapeMultiline(task.blockedReason.trim())}`,
      "#f59e0b",
      "#fffbeb",
    );
    text.push("", `Blocked: ${task.blockedReason.trim()}`);
  }

  return { html, text };
}

function notesBlock(notes: TaskEmailNote[]): { html: string; text: string[] } {
  if (notes.length === 0) return { html: "", text: [] };

  const items = notes
    .map(
      (n) => `<tr><td style="padding:0 0 14px">
      <div style="font-size:12px;color:#6b7280;margin-bottom:3px">
        <strong style="color:#374151">${escapeHtml(n.authorName)}</strong>
        &middot; ${escapeHtml(format(n.createdAt, "MMM d, h:mm a"))}
      </div>
      <div style="font-size:14px;line-height:1.6;color:#374151">${escapeMultiline(n.body)}</div>
    </td></tr>`,
    )
    .join("");

  const html = `<div style="margin:24px 0 4px;padding-top:18px;border-top:1px solid #e5e7eb">
    <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:12px">Latest notes</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${items}</table>
  </div>`;

  const text = ["", "Latest notes:"];
  for (const n of notes) {
    text.push(`  ${n.authorName} (${format(n.createdAt, "MMM d, h:mm a")}): ${n.body}`);
  }
  return { html, text };
}

// ─── Templates ──────────────────────────────────────────────────────────────

type BaseInput = {
  task: TaskEmailTask;
  recipientFirstName: string;
  actorName: string;
  url: string;
  brand: EmailBrand;
  /** Injected so tests are not clock-dependent. */
  now?: Date;
};

export function renderTaskAssignedEmail(input: BaseInput & { reassigned?: boolean }): RenderedEmail {
  const now = input.now ?? new Date();
  const { task, brand } = input;
  const block = taskBlock(task, now);
  const overdue = isOverdue(task, now);

  const bodyHtml = `
${eyebrow(input.reassigned ? "Task reassigned to you" : "New task assigned to you", brand.primaryColor)}
${heading(task.title)}
<p style="margin:0 0 16px;font-size:15px;color:#374151">
  Hi ${escapeHtml(input.recipientFirstName)} — ${escapeHtml(input.actorName)} ${input.reassigned ? "moved this task to you" : "assigned you a task"}${task.dueAt ? `, due ${escapeHtml(format(task.dueAt, "EEEE, MMMM d"))}` : ""}.
</p>
${block.html}
${button(input.url, "Open task", brand.primaryColor)}
<p style="margin:4px 0 0;font-size:12px;color:#9ca3af">
  Add a note on the task to keep everyone in the loop${overdue ? " — this one is already past its due date" : ""}.
</p>`;

  const bodyText = [
    input.reassigned ? "TASK REASSIGNED TO YOU" : "NEW TASK ASSIGNED TO YOU",
    "",
    task.title,
    "",
    `Hi ${input.recipientFirstName} — ${input.actorName} ${input.reassigned ? "moved this task to you" : "assigned you a task"}.`,
    "",
    ...block.text,
    "",
    `Open task: ${input.url}`,
  ].join("\n");

  const rendered = renderEmailLayout({ bodyHtml, bodyText, brand });
  return {
    subject: `${task.priority === "URGENT" ? "[URGENT] " : ""}Task assigned: ${task.title}`,
    html: rendered.html,
    text: rendered.text,
  };
}

export function renderTaskCompletedEmail(
  input: BaseInput & { notes: TaskEmailNote[] },
): RenderedEmail {
  const now = input.now ?? new Date();
  const { task, brand } = input;
  const block = taskBlock(task, now);
  const notes = notesBlock(input.notes);
  const done = "#047857";

  const bodyHtml = `
${eyebrow("Task completed", done)}
${heading(task.title)}
<p style="margin:0 0 16px;font-size:15px;color:#374151">
  Hi ${escapeHtml(input.recipientFirstName)} — ${escapeHtml(personName(task.completedBy) === "—" ? input.actorName : personName(task.completedBy))} marked this task complete.
</p>
${block.html}
${notes.html}
${button(input.url, "View task", brand.primaryColor)}`;

  const bodyText = [
    "TASK COMPLETED",
    "",
    task.title,
    "",
    `${personName(task.completedBy) === "—" ? input.actorName : personName(task.completedBy)} marked this task complete.`,
    "",
    ...block.text,
    ...notes.text,
    "",
    `View task: ${input.url}`,
  ].join("\n");

  const rendered = renderEmailLayout({ bodyHtml, bodyText, brand });
  return {
    subject: `Task completed: ${task.title}`,
    html: rendered.html,
    text: rendered.text,
  };
}

export function renderTaskBlockedEmail(input: BaseInput): RenderedEmail {
  const now = input.now ?? new Date();
  const { task, brand } = input;
  const block = taskBlock(task, now);

  const bodyHtml = `
${eyebrow("Task blocked", "#b45309")}
${heading(task.title)}
<p style="margin:0 0 16px;font-size:15px;color:#374151">
  Hi ${escapeHtml(input.recipientFirstName)} — ${escapeHtml(input.actorName)} marked this task blocked. It will not move until someone clears the blocker.
</p>
${block.html}
${button(input.url, "Open task", brand.primaryColor)}`;

  const bodyText = [
    "TASK BLOCKED",
    "",
    task.title,
    "",
    `${input.actorName} marked this task blocked.`,
    "",
    ...block.text,
    "",
    `Open task: ${input.url}`,
  ].join("\n");

  const rendered = renderEmailLayout({ bodyHtml, bodyText, brand });
  return {
    subject: `Task blocked: ${task.title}`,
    html: rendered.html,
    text: rendered.text,
  };
}

export function renderTaskMentionEmail(input: BaseInput & { note: TaskEmailNote }): RenderedEmail {
  const now = input.now ?? new Date();
  const { task, brand } = input;
  const block = taskBlock(task, now);

  const bodyHtml = `
${eyebrow("You were mentioned", brand.primaryColor)}
${heading(task.title)}
<p style="margin:0 0 4px;font-size:15px;color:#374151">
  Hi ${escapeHtml(input.recipientFirstName)} — ${escapeHtml(input.note.authorName)} mentioned you in a note:
</p>
${panel(escapeMultiline(input.note.body), brand.primaryColor, "#f9fafb")}
${block.html}
${button(input.url, "Reply on the task", brand.primaryColor)}`;

  const bodyText = [
    "YOU WERE MENTIONED",
    "",
    task.title,
    "",
    `${input.note.authorName} mentioned you in a note:`,
    input.note.body,
    "",
    ...block.text,
    "",
    `Reply on the task: ${input.url}`,
  ].join("\n");

  const rendered = renderEmailLayout({ bodyHtml, bodyText, brand });
  return {
    subject: `${input.note.authorName} mentioned you: ${task.title}`,
    html: rendered.html,
    text: rendered.text,
  };
}

// ─── Nudge ──────────────────────────────────────────────────────────────────

/** "Where does this stand?" from the person waiting on it. */
export function renderTaskNudgeEmail(input: BaseInput & { message?: string | null }): RenderedEmail {
  const now = input.now ?? new Date();
  const { task, brand } = input;
  const block = taskBlock(task, now);
  const msg = input.message?.trim();

  const bodyHtml = `
${eyebrow("Checking in", "#6d28d9")}
${heading(task.title)}
<p style="margin:0 0 4px;font-size:15px;color:#374151">
  Hi ${escapeHtml(input.recipientFirstName)} — ${escapeHtml(input.actorName)} wanted to know where this stands.
</p>
${msg ? panel(escapeMultiline(msg), "#6d28d9", "#f5f3ff") : ""}
${block.html}
${button(input.url, "Open the task and reply with a note", brand.primaryColor)}`;

  const bodyText = [
    "CHECKING IN",
    "",
    task.title,
    "",
    `${input.actorName} wanted to know where this stands.`,
    ...(msg ? ["", ...msg.split("\n").map((l) => `> ${l}`)] : []),
    "",
    ...block.text,
    "",
    `Open the task and reply with a note: ${input.url}`,
  ].join("\n");

  const rendered = renderEmailLayout({ bodyHtml, bodyText, brand });
  return {
    subject: `${input.actorName} is checking in on: ${task.title}`,
    html: rendered.html,
    text: rendered.text,
  };
}

// ─── Escalation ─────────────────────────────────────────────────────────────

export type EscalationItem = {
  title: string;
  assigneeName: string;
  daysOverdue: number;
  dueAt: Date | null;
  priority: Priority;
  level: number;
  context: string;
  url: string;
  lastNote: TaskEmailNote | null;
};

/**
 * One mail per recipient listing everything of theirs that crossed a
 * threshold this run — never one per task, so a bad week is one message to
 * triage rather than a wall of red subjects.
 */
export function renderTaskEscalationEmail(input: {
  recipientFirstName: string;
  recipientReason: "assignor" | "manager";
  items: EscalationItem[];
  managerThresholdDays: number;
  brand: EmailBrand;
}): RenderedEmail {
  const { brand, items } = input;
  const intro =
    input.recipientReason === "manager"
      ? `You are getting this as a manager: these have been overdue for ${input.managerThresholdDays}+ days.`
      : "You raised these, and they are now overdue.";

  const rows = items
    .map((i) => {
      const note = i.lastNote
        ? `<div style="font-size:12px;color:#6b7280;margin-top:4px"><em>${escapeHtml(i.lastNote.authorName)}, ${escapeHtml(format(i.lastNote.createdAt, "MMM d"))}:</em> ${escapeHtml(i.lastNote.body.slice(0, 160))}${i.lastNote.body.length > 160 ? "…" : ""}</div>`
        : `<div style="font-size:12px;color:#9ca3af;margin-top:4px">No notes yet</div>`;
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
          <a href="${escapeHtml(i.url)}" style="font-size:14px;font-weight:600;color:#111827;text-decoration:none">${escapeHtml(i.title)}</a>
          <div style="font-size:12px;color:#6b7280;margin-top:2px">${escapeHtml(i.context)} · ${escapeHtml(i.assigneeName)}</div>
          ${note}
        </td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;vertical-align:top">
          ${pill(`${i.daysOverdue}d overdue`, { fg: "#b91c1c", bg: "#fef2f2", border: "#fca5a5" })}<br/>
          ${pill(i.priority, PRIORITY_SWATCH[i.priority])}
        </td>
      </tr>`;
    })
    .join("");

  const bodyHtml = `
${eyebrow("Escalation", "#b91c1c")}
${heading(items.length === 1 ? "An overdue task needs attention" : `${items.length} overdue tasks need attention`)}
<p style="margin:0 0 4px;font-size:15px;color:#374151">Hi ${escapeHtml(input.recipientFirstName)} — ${escapeHtml(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-top:12px">${rows}</table>`;

  const textLines = [`Hi ${input.recipientFirstName} — ${intro}`, ""];
  for (const i of items) {
    textLines.push(
      `  - ${i.title} [${i.priority}] — ${i.daysOverdue}d overdue — ${i.assigneeName} — ${i.context}`,
      i.lastNote ? `    Last note (${i.lastNote.authorName}): ${i.lastNote.body.slice(0, 160)}` : "    No notes yet",
      `    ${i.url}`,
    );
  }

  const rendered = renderEmailLayout({ bodyHtml, bodyText: textLines.join("\n"), brand });
  const first = items[0];
  return {
    subject:
      items.length === 1 && first
        ? `Overdue ${first.daysOverdue} days: ${first.title} (${first.assigneeName})`
        : `${items.length} overdue tasks need attention`,
    html: rendered.html,
    text: rendered.text,
  };
}

// ─── Reminder digest ────────────────────────────────────────────────────────

export type ReminderItem = {
  title: string;
  priority: Priority;
  dueAt: Date | null;
  context: string;
  url: string;
  overdue: boolean;
};

/** A "remind me on…" that fell due today. `setByName` is null when the recipient set it. */
export type CustomReminderItem = ReminderItem & { setByName: string | null };

/**
 * One mail per person per run, not one per task. Someone with nine overdue
 * items needs a list they can triage, not nine separate interruptions.
 */
export function renderTaskReminderEmail(input: {
  recipientFirstName: string;
  dueToday: ReminderItem[];
  overdue: ReminderItem[];
  reminders?: CustomReminderItem[];
  brand: EmailBrand;
}): RenderedEmail {
  const { brand } = input;
  const reminders = input.reminders ?? [];
  const total = input.dueToday.length + input.overdue.length;

  function section(label: string, items: ReminderItem[], accent: string): string {
    if (items.length === 0) return "";
    const rows = items
      .map(
        (i) => `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
          <a href="${escapeHtml(i.url)}" style="font-size:14px;font-weight:600;color:#111827;text-decoration:none">${escapeHtml(i.title)}</a>
          <div style="font-size:12px;color:#6b7280;margin-top:2px">${escapeHtml(i.context)}${"setByName" in i ? ` · ${escapeHtml((i as CustomReminderItem).setByName ? `${(i as CustomReminderItem).setByName} asked you to be reminded` : "You asked to be reminded")}` : ""}</div>
        </td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;vertical-align:top">
          ${pill(i.priority, PRIORITY_SWATCH[i.priority])}<br/>
          <span style="font-size:11px;color:${i.overdue ? "#b91c1c" : "#6b7280"}">${escapeHtml(i.dueAt ? format(i.dueAt, "MMM d") : "—")}</span>
        </td>
      </tr>`,
      )
      .join("");
    return `<div style="margin:20px 0 4px">
      <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${accent};margin-bottom:6px">${escapeHtml(label)} (${items.length})</div>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">${rows}</table>
    </div>`;
  }

  const headline =
    total === 0
      ? reminders.length === 1
        ? "A reminder you asked for"
        : `${reminders.length} reminders for today`
      : input.overdue.length > 0
        ? `${input.overdue.length} overdue, ${input.dueToday.length} due today`
        : `${input.dueToday.length} task${input.dueToday.length === 1 ? "" : "s"} due today`;

  const bodyHtml = `
${eyebrow("Your tasks", brand.primaryColor)}
${heading(headline)}
<p style="margin:0 0 4px;font-size:15px;color:#374151">Morning ${escapeHtml(input.recipientFirstName)} — here is what is on you today.</p>
${section("Overdue", input.overdue, "#b91c1c")}
${section("Due today", input.dueToday, "#1d4ed8")}
${section("Reminders", reminders, "#6d28d9")}`;

  const textLines = [
    `Morning ${input.recipientFirstName} — here is what is on you today.`,
    "",
  ];
  for (const [label, items] of [
    ["OVERDUE", input.overdue],
    ["DUE TODAY", input.dueToday],
    ["REMINDERS", reminders],
  ] as const) {
    if (items.length === 0) continue;
    textLines.push(`${label} (${items.length}):`);
    for (const i of items) {
      const who =
        "setByName" in i
          ? ` — ${(i as CustomReminderItem).setByName ? `${(i as CustomReminderItem).setByName} asked you to be reminded` : "you asked to be reminded"}`
          : "";
      textLines.push(
        `  - ${i.title} [${i.priority}]${i.dueAt ? ` due ${format(i.dueAt, "MMM d")}` : ""} — ${i.context}${who}`,
        `    ${i.url}`,
      );
    }
    textLines.push("");
  }

  const rendered = renderEmailLayout({ bodyHtml, bodyText: textLines.join("\n"), brand });
  const reminderSuffix = reminders.length
    ? ` and ${reminders.length} reminder${reminders.length === 1 ? "" : "s"}`
    : "";
  return {
    subject:
      total === 0
        ? reminders.length === 1 && reminders[0]
          ? `Reminder: ${reminders[0].title}`
          : `${reminders.length} reminders for today`
        : input.overdue.length > 0
          ? `${input.overdue.length} overdue task${input.overdue.length === 1 ? "" : "s"}${input.dueToday.length ? ` and ${input.dueToday.length} due today` : ""}${reminderSuffix}`
          : `${total} task${total === 1 ? "" : "s"} due today${reminderSuffix}`,
    html: rendered.html,
    text: rendered.text,
  };
}
