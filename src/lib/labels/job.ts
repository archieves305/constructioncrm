import { formatAddressLine, type AddressInput } from "./address";

/**
 * One way to name a job. Users know the property, not "JOB-00009", so the
 * address leads; the customer and trade sit under it; the number is a
 * small mono hint and the search key.
 */

export type CustomerInput = AddressInput & { fullName?: string | null; companyName?: string | null };

export type JobLabelInput = {
  jobNumber: string;
  title?: string | null;
  serviceType?: string | null;
  lead?: CustomerInput | null;
};

export type EntityLabel = {
  /** What the eye lands on: the address, or the best stand-in. */
  primary: string;
  /** Muted context under it, or null. */
  secondary: string | null;
  /** The record number in mono, or null when it is already the primary. */
  code: string | null;
  /** True when no real address was available and a stand-in was used. */
  placeholder: boolean;
};

export function customerName(lead: CustomerInput | null | undefined): string {
  return (lead?.fullName ?? "").trim() || (lead?.companyName ?? "").trim();
}

export function jobLabel(job: JobLabelInput, opts: { customer?: boolean; trade?: boolean } = {}): EntityLabel {
  const withCustomer = opts.customer ?? true;
  const withTrade = opts.trade ?? true;
  const address = formatAddressLine(job.lead);
  const context = [withCustomer ? customerName(job.lead) : "", withTrade ? (job.serviceType ?? "").trim() : ""].filter(Boolean).join(" · ") || null;
  if (address) return { primary: address, secondary: context, code: job.jobNumber, placeholder: false };
  const title = (job.title ?? "").trim();
  if (title) return { primary: title, secondary: context, code: job.jobNumber, placeholder: true };
  return { primary: job.jobNumber, secondary: context, code: null, placeholder: true };
}

/** "2192 Wind Trace, Navarre (JOB-00005)" — for subjects, task titles, logs. */
export function jobText(job: JobLabelInput): string {
  const l = jobLabel(job, { customer: false });
  return l.code ? `${l.primary} (${l.code})` : l.primary;
}

/** "2192 Wind Trace, Navarre — Sarah Smith (JOB-00005)". */
export function jobTextWithCustomer(job: JobLabelInput): string {
  const l = jobLabel(job, { customer: false });
  const name = customerName(job.lead);
  const head = name ? `${l.primary} — ${name}` : l.primary;
  return l.code ? `${head} (${l.code})` : head;
}
