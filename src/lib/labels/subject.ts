import { format } from "date-fns";
import { formatAddressLine, type AddressInput } from "./address";
import { jobText, jobTextWithCustomer, jobLabel, type EntityLabel, type JobLabelInput } from "./job";

/**
 * "What is this task about?" — one answer for the chip, the sheet, the field
 * pages and the emails. The most specific record wins (an invoice beats its
 * job); the address leads whenever one is reachable.
 */

export type SubjectKind = "violation" | "invoice" | "estimate" | "dailyLog" | "prospect" | "job" | "lead";

export type SubjectTaskInput = {
  violationCase?: { id: string; caseNumber: string } | null;
  violationItem?: { id: string; itemNumber: number } | null;
  invoice?: { id: string; invoiceNumber: string; jobId: string } | null;
  estimate?: { id: string; estimateNumber: string; name: string; leadId: string } | null;
  dailyLog?: { id: string; jobId: string; logDate: string | Date } | null;
  prospect?: { id: string; propertyAddress1: string; city: string } | null;
  job?: (JobLabelInput & { id: string }) | null;
  lead?: (AddressInput & { id: string; fullName: string }) | null;
};

export type SubjectLabel = EntityLabel & { kind: SubjectKind; href: string | null };

function logDay(logDate: string | Date): { ymd: string; short: string } {
  const ymd = typeof logDate === "string" ? logDate.slice(0, 10) : logDate.toISOString().slice(0, 10);
  return { ymd, short: format(new Date(`${ymd}T12:00:00`), "MMM d") };
}

function withAddress(address: string, fallback: string, secondary: string | null, code: string | null): EntityLabel {
  return address
    ? { primary: address, secondary, code, placeholder: false }
    : { primary: fallback, secondary: null, code: null, placeholder: true };
}

export function subjectLabel(task: SubjectTaskInput): SubjectLabel | null {
  if (task.violationCase) {
    const c = task.violationCase;
    const item = task.violationItem;
    return {
      kind: "violation",
      href: item ? `/violations/${c.id}?tab=items&item=${item.id}` : `/violations/${c.id}`,
      ...withAddress(formatAddressLine(task.lead), item ? `${c.caseNumber} · Item ${item.itemNumber}` : c.caseNumber, item ? `Item ${item.itemNumber}` : null, c.caseNumber),
    };
  }
  if (task.invoice) {
    const inv = task.invoice;
    return { kind: "invoice", href: `/jobs/${inv.jobId}`, ...withAddress(formatAddressLine(task.job?.lead), inv.invoiceNumber, null, inv.invoiceNumber) };
  }
  if (task.estimate) {
    const e = task.estimate;
    return { kind: "estimate", href: `/leads/${e.leadId}`, ...withAddress(formatAddressLine(task.lead), `${e.estimateNumber} · ${e.name}`, e.name, e.estimateNumber) };
  }
  if (task.dailyLog) {
    const { ymd, short } = logDay(task.dailyLog.logDate);
    return {
      kind: "dailyLog",
      href: `/jobs/${task.dailyLog.jobId}/daily-logs/${ymd}`,
      ...withAddress(formatAddressLine(task.job?.lead), `Log · ${short}`, `Log · ${short}`, task.job?.jobNumber ?? null),
    };
  }
  if (task.prospect) {
    return { kind: "prospect", href: "/canvassing/prospects", primary: `${task.prospect.propertyAddress1}, ${task.prospect.city}`, secondary: null, code: null, placeholder: false };
  }
  if (task.job) return { kind: "job", href: `/jobs/${task.job.id}`, ...jobLabel(task.job) };
  if (task.lead) {
    return { kind: "lead", href: `/leads/${task.lead.id}`, ...withAddress(formatAddressLine(task.lead), task.lead.fullName, task.lead.fullName, null) };
  }
  return null;
}

/** One line for emails and titles: "INV-00012 — 2192 Wind Trace, Navarre (JOB-00005)". */
export function subjectText(task: SubjectTaskInput): string {
  if (task.violationCase) {
    const c = task.violationCase;
    const head = task.violationItem ? `${c.caseNumber} · Item ${task.violationItem.itemNumber}` : c.caseNumber;
    const address = formatAddressLine(task.lead);
    return address ? `${head} — ${address}` : head;
  }
  if (task.invoice) return task.job ? `${task.invoice.invoiceNumber} — ${jobText(task.job)}` : task.invoice.invoiceNumber;
  if (task.estimate) {
    const head = `${task.estimate.estimateNumber} · ${task.estimate.name}`;
    const address = formatAddressLine(task.lead);
    return address ? `${head} — ${address}` : head;
  }
  if (task.dailyLog) {
    const { short } = logDay(task.dailyLog.logDate);
    return task.job ? `Daily log ${short} — ${jobText(task.job)}` : `Daily log ${short}`;
  }
  if (task.prospect) return `${task.prospect.propertyAddress1}, ${task.prospect.city}`;
  if (task.job) return jobTextWithCustomer(task.job);
  if (task.lead) {
    const address = formatAddressLine(task.lead);
    return address ? `${task.lead.fullName} — ${address}` : task.lead.fullName;
  }
  return "";
}
