import type { RoleName } from "@/generated/prisma/client";

/**
 * A crew never receives a customer's phone number or email (crew study, gap
 * S1-3). Routes a crew lead can reach pass their response through this: every
 * customer record in it — any object carrying `primaryPhone`, which only a
 * lead has — loses its phone numbers and email. Staff records (a PM, an
 * assignee) carry no `primaryPhone` and are left alone. Office roles get the
 * data unchanged.
 */
export const CREW_REDACTED_ROLES: readonly RoleName[] = ["CREW_LEAD", "CREW_MEMBER"];

const CONTACT_KEYS = ["primaryPhone", "secondaryPhone", "email"] as const;

export function hidesCustomerContact(role: RoleName): boolean {
  return CREW_REDACTED_ROLES.includes(role);
}

/** A copy of `data` with every customer record's phones and email set to null. */
export function redactCustomerContact<T>(data: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v === null || typeof v !== "object" || v instanceof Date) return v;
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) out[k] = walk(val);
    if ("primaryPhone" in o) for (const k of CONTACT_KEYS) if (k in out) out[k] = null;
    return out;
  };
  return walk(data) as T;
}

/** `data` as this viewer may receive it. */
export function forViewer<T>(role: RoleName, data: T): T {
  return hidesCustomerContact(role) ? redactCustomerContact(data) : data;
}

/**
 * A lead as a crew may receive it: who and where, and the jobs it became.
 * Never the customer's messages, the sales history or contact details (the
 * messages carry the customer's address and number in fromValue / toValue).
 */
export function crewLeadView(lead: {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  companyName?: string | null;
  propertyAddress1?: string | null;
  propertyAddress2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  jobs?: unknown;
}) {
  return {
    id: lead.id,
    firstName: lead.firstName ?? null,
    lastName: lead.lastName ?? null,
    fullName: lead.fullName ?? null,
    companyName: lead.companyName ?? null,
    propertyAddress1: lead.propertyAddress1 ?? null,
    propertyAddress2: lead.propertyAddress2 ?? null,
    city: lead.city ?? null,
    state: lead.state ?? null,
    zipCode: lead.zipCode ?? null,
    jobs: lead.jobs ?? [],
  };
}
