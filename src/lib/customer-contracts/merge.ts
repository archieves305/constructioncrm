// {{merge.fields}} for contract templates. Pure.
//
// Unknown keys are left in place (so a draft never renders a hole silently)
// and reported, so validation can refuse to send a document with one.

import type { CustomerContractSnapshot } from "./types";

export type MergeContext = Record<string, string>;

export const MERGE_FIELD_CATALOG: { key: string; description: string }[] = [
  { key: "customer.name", description: "Owner's full name" },
  { key: "customer.company", description: "Owner's company, if any" },
  { key: "customer.email", description: "Owner's email" },
  { key: "customer.phone", description: "Owner's phone" },
  { key: "customer.address", description: "Owner's address (one line)" },
  { key: "job.number", description: "Job number" },
  { key: "job.title", description: "Job title" },
  { key: "job.address", description: "Project / property address" },
  { key: "job.serviceType", description: "Service type" },
  { key: "company.name", description: "Contractor company name" },
  { key: "company.address", description: "Contractor address" },
  { key: "company.phone", description: "Contractor phone" },
  { key: "company.email", description: "Contractor email" },
  { key: "company.licenses", description: "Contractor license numbers" },
  { key: "contract.number", description: "Contract number" },
  { key: "contract.total", description: "Contract price, formatted" },
  { key: "contract.deposit", description: "Deposit amount, formatted" },
  { key: "contract.depositPercent", description: "Deposit percent" },
  { key: "contract.offerExpiresAt", description: "Date the price stops being valid" },
  { key: "contract.validityDays", description: "Days the price is valid for" },
  { key: "contract.date", description: "Date the contract was generated" },
  { key: "estimate.number", description: "Source estimate number" },
  { key: "schedule.<key>.amount", description: "Amount of a payment-schedule item (e.g. schedule.deposit.amount)" },
  { key: "schedule.<key>.percent", description: "Percent of a payment-schedule item" },
];

const FIELD_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

export function listMergeFields(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(FIELD_RE)) out.add(m[1]);
  return [...out];
}

export function renderMergeFields(text: string, ctx: MergeContext): { text: string; unknown: string[] } {
  const unknown = new Set<string>();
  const rendered = text.replace(FIELD_RE, (whole, key: string) => {
    if (Object.hasOwn(ctx, key)) return ctx[key];
    unknown.add(key);
    return whole;
  });
  return { text: rendered, unknown: [...unknown] };
}

/** Is `key` one the catalog knows? `schedule.<key>.*` is checked by shape. */
export function isKnownMergeField(key: string, scheduleKeys: string[] = []): boolean {
  if (MERGE_FIELD_CATALOG.some((f) => f.key === key)) return true;
  const m = /^schedule\.([a-zA-Z0-9_]+)\.(amount|percent)$/.exec(key);
  if (!m) return false;
  return scheduleKeys.length === 0 || scheduleKeys.includes(m[1]);
}

export function formatMoney(n: number): string {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatLongDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
}

function oneLineAddress(a: { line1: string; line2?: string | null; city: string; state: string; zip: string }): string {
  return `${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city}, ${a.state} ${a.zip}`;
}

function trimPercent(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Everything a template may reference, as flat dotted keys. */
export function buildMergeContext(s: Omit<CustomerContractSnapshot, "template" | "signature">): MergeContext {
  const deposit = s.paymentSchedule[0];
  const ctx: MergeContext = {
    "customer.name": s.owner.name,
    "customer.company": s.owner.companyName ?? "",
    "customer.email": s.owner.email ?? "",
    "customer.phone": s.owner.phone ?? "",
    "customer.address": oneLineAddress(s.jobSite),
    "job.number": s.job.jobNumber,
    "job.title": s.job.title,
    "job.address": oneLineAddress(s.jobSite),
    "job.serviceType": s.job.serviceType,
    "company.name": s.company.name,
    "company.address": s.company.address,
    "company.phone": s.company.phone ?? "",
    "company.email": s.company.email ?? "",
    "company.licenses": s.company.licenses.join(", "),
    "contract.number": s.contractNumber,
    "contract.total": formatMoney(s.price.total),
    "contract.deposit": formatMoney(s.depositAmount),
    "contract.depositPercent": deposit ? `${trimPercent(deposit.percent)}%` : "0%",
    "contract.offerExpiresAt": formatLongDate(s.validity.offerExpiresAt),
    "contract.validityDays": String(s.validity.validityDays),
    "contract.date": formatLongDate(s.generatedAt),
    "estimate.number": s.source.estimateNumber,
  };
  for (const row of s.paymentSchedule) {
    ctx[`schedule.${row.key}.amount`] = formatMoney(row.amount);
    ctx[`schedule.${row.key}.percent`] = `${trimPercent(row.percent)}%`;
  }
  return ctx;
}
