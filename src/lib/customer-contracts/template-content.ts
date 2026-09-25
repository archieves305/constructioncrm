// Pure helpers over a template version's content: normalisation, the
// content hash the seeder pins, validation, and parsing the stored JSON.
// No Prisma import — the admin editor validates drafts client-side with it.

import { createHash } from "node:crypto";
import { isKnownMergeField, listMergeFields } from "./merge";
import { validatePaymentSchedule } from "./schedule";
import type { ContractArticle, ContractTemplateContent, PaymentScheduleItem } from "./types";

export const ARTICLE_KEY_RE = /^[a-z][a-z0-9_]*$/;

export function normaliseTemplateContent(c: ContractTemplateContent): ContractTemplateContent {
  return {
    title: c.title.trim(),
    articles: c.articles.map((a) => ({ key: a.key.trim(), title: a.title.trim(), body: a.body.replace(/\r\n/g, "\n").trim() })),
    paymentSchedule: {
      items: c.paymentSchedule.items.map((i) => ({ key: i.key.trim(), label: i.label.trim(), percent: Number(i.percent), trigger: i.trigger.trim() })),
    },
    paymentScheduleText: c.paymentScheduleText.trim(),
    consentText: c.consentText.trim(),
  };
}

export function templateContentHash(c: ContractTemplateContent): string {
  return createHash("sha256").update(JSON.stringify(normaliseTemplateContent(c))).digest("hex");
}

/** Human-readable reasons the content cannot be published. */
export function validateTemplateContent(c: ContractTemplateContent): string[] {
  const errors: string[] = [];
  const n = normaliseTemplateContent(c);
  if (!n.title) errors.push("Title is required");
  if (n.articles.length === 0) errors.push("Add at least one article");
  const keys = new Set<string>();
  n.articles.forEach((a, i) => {
    const label = a.title || `Article ${i + 1}`;
    if (!ARTICLE_KEY_RE.test(a.key)) errors.push(`${label}: key must be lowercase letters, digits and underscores`);
    if (keys.has(a.key)) errors.push(`${label}: duplicate key "${a.key}"`);
    keys.add(a.key);
    if (!a.title) errors.push(`Article ${i + 1}: title is required`);
    if (!a.body) errors.push(`${label}: body is required`);
  });
  errors.push(...validatePaymentSchedule(n.paymentSchedule.items).map((e) => `Payment schedule: ${e}`));
  if (!n.consentText) errors.push("Consent text is required");
  const scheduleKeys = n.paymentSchedule.items.map((i) => i.key);
  const texts = [n.title, n.paymentScheduleText, n.consentText, ...n.articles.flatMap((a) => [a.title, a.body])];
  const unknown = new Set<string>();
  for (const t of texts) for (const f of listMergeFields(t)) if (!isKnownMergeField(f, scheduleKeys)) unknown.add(f);
  if (unknown.size > 0) errors.push(`Unknown merge fields: ${[...unknown].map((u) => `{{${u}}}`).join(", ")}`);
  return errors;
}

/** The stored JSON columns back into typed content (tolerant of bad shapes). */
export function parseTemplateContent(row: {
  title: string;
  articles: unknown;
  paymentSchedule: unknown;
  paymentScheduleText: string;
  consentText: string;
}): ContractTemplateContent {
  const articles = Array.isArray(row.articles) ? (row.articles as ContractArticle[]) : [];
  const ps = row.paymentSchedule as { items?: unknown } | null;
  const items = ps && typeof ps === "object" && Array.isArray(ps.items) ? (ps.items as PaymentScheduleItem[]) : [];
  return { title: row.title, articles, paymentSchedule: { items }, paymentScheduleText: row.paymentScheduleText, consentText: row.consentText };
}
