import { format } from "date-fns";
import { formatAddressLine } from "@/lib/labels/address";
import { caseLabel, type CaseLabelInput } from "@/lib/labels/case";
import { jobLabel, type JobLabelInput } from "@/lib/labels/job";
import { dayKey, dayKeyToLocalDate } from "@/lib/time/zone";

const ORG_KIND_LABEL: Record<string, string> = { GENERAL_CONTRACTOR: "General contractor", DEVELOPER: "Developer", PROPERTY_MANAGER: "Property manager", ARCHITECT: "Architect", ENGINEER: "Engineer", MUNICIPALITY: "Municipality", REFERRAL_PARTNER: "Referral partner", OTHER: "Organization" };
const ORG_STAGE_LABEL: Record<string, string> = { TARGET: "Target", CONTACTED: "Contacted", ENGAGED: "Engaged", ACTIVE: "Active", DORMANT: "Dormant", DO_NOT_PURSUE: "Do not pursue" };

/** One row in the palette: what to show and where it goes. */
export type SearchHit = {
  type: "job" | "lead" | "case" | "prospect" | "task" | "vendor" | "organization" | "contact";
  id: string;
  primary: string;
  secondary: string | null;
  code: string | null;
  href: string;
};

export type SearchRows = {
  jobs: (JobLabelInput & { id: string; currentStage?: { name: string } | null })[];
  leads: { id: string; kind?: "CUSTOMER" | "GC_BID"; fullName: string; companyName?: string | null; propertyAddress1: string; propertyAddress2?: string | null; city: string; primaryPhone?: string | null; currentStage?: { name: string } | null; bidInvitation?: { number: string; projectName: string; status: string } | null }[];
  cases: (CaseLabelInput & { id: string; status?: string | null })[];
  prospects: { id: string; propertyAddress1: string; city: string; ownerName?: string | null }[];
  /** Active open tasks; a dated one opens on the calendar's day, an undated one on the tasks page. */
  tasks?: {
    id: string;
    title: string;
    dueAt: Date | string | null;
    status: string;
    job: JobLabelInput | null;
    lead: { fullName: string; propertyAddress1?: string | null; propertyAddress2?: string | null; city?: string | null } | null;
    violationCase: { caseNumber: string } | null;
  }[];
  vendors?: { id: string; name: string; kind: string; trade?: string | null; isActive?: boolean }[];
  organizations?: { id: string; name: string; kind: string; stage: string; city?: string | null; isActive?: boolean }[];
  contacts?: { id: string; firstName: string; lastName: string; title?: string | null; organization: { id: string; name: string } }[];
};

/** Where a task hit lands: the calendar on its day with the sheet open, else the tasks page. */
export function taskHitHref(t: { id: string; dueAt: Date | string | null }): string {
  if (!t.dueAt) return `/tasks?task=${t.id}`;
  const d = t.dueAt instanceof Date ? t.dueAt : new Date(t.dueAt);
  return `/calendar?view=day&date=${dayKey(d)}&task=${t.id}`;
}

export function toSearchHits(rows: SearchRows): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const j of rows.jobs) {
    const l = jobLabel(j);
    const stage = j.currentStage?.name;
    hits.push({ type: "job", id: j.id, primary: l.primary, secondary: [l.secondary, stage].filter(Boolean).join(" · ") || null, code: l.code, href: `/jobs/${j.id}` });
  }
  for (const l of rows.leads) {
    const address = formatAddressLine(l);
    const stage = l.currentStage?.name;
    if (l.kind === "GC_BID") {
      // A bid package: the contractor leads, the site is the detail, and it opens on its Bid tab.
      hits.push({ type: "lead", id: l.id, primary: `Bid · ${l.companyName || l.fullName}${l.bidInvitation ? ` · ${l.bidInvitation.projectName}` : ""}`, secondary: [address, l.bidInvitation ? ORG_STAGE_LABEL[l.bidInvitation.status] ?? l.bidInvitation.status : stage].filter(Boolean).join(" · ") || null, code: l.bidInvitation?.number ?? null, href: `/leads/${l.id}?tab=bid` });
      continue;
    }
    hits.push({
      type: "lead",
      id: l.id,
      primary: address || l.fullName,
      secondary: [address ? l.fullName : null, l.primaryPhone, stage].filter(Boolean).join(" · ") || null,
      code: null,
      href: `/leads/${l.id}`,
    });
  }
  for (const c of rows.cases) {
    const l = caseLabel(c);
    hits.push({ type: "case", id: c.id, primary: l.primary, secondary: [l.secondary, c.status].filter(Boolean).join(" · ") || null, code: l.code, href: `/violations/${c.id}` });
  }
  for (const p of rows.prospects) {
    hits.push({ type: "prospect", id: p.id, primary: `${p.propertyAddress1}, ${p.city}`, secondary: p.ownerName ?? null, code: null, href: `/canvassing/prospects?search=${encodeURIComponent(p.propertyAddress1)}` });
  }
  for (const t of rows.tasks ?? []) {
    const where = t.job ? jobLabel(t.job, { customer: false }).primary : t.violationCase ? `Case ${t.violationCase.caseNumber}` : t.lead ? formatAddressLine(t.lead) || t.lead.fullName : null;
    const due = t.dueAt ? format(dayKeyToLocalDate(dayKey(t.dueAt instanceof Date ? t.dueAt : new Date(t.dueAt))), "EEE, MMM d") : "No date";
    hits.push({ type: "task", id: t.id, primary: t.title, secondary: [where, due].filter(Boolean).join(" · ") || null, code: null, href: taskHitHref(t) });
  }
  for (const v of rows.vendors ?? []) {
    const kind = v.kind === "SUBCONTRACTOR" ? "Subcontractor" : v.kind === "SUPPLIER" ? "Supplier" : "Vendor";
    hits.push({ type: "vendor", id: v.id, primary: v.name, secondary: [kind, v.trade, v.isActive === false ? "Inactive" : null].filter(Boolean).join(" · "), code: null, href: `/vendors/${v.id}` });
  }
  for (const o of rows.organizations ?? []) {
    hits.push({ type: "organization", id: o.id, primary: o.name, secondary: [ORG_KIND_LABEL[o.kind] ?? o.kind, o.city, ORG_STAGE_LABEL[o.stage] ?? o.stage, o.isActive === false ? "Inactive" : null].filter(Boolean).join(" · ") || null, code: null, href: `/partners/${o.id}` });
  }
  for (const c of rows.contacts ?? []) {
    hits.push({ type: "contact", id: c.id, primary: `${c.firstName} ${c.lastName}`, secondary: [c.title, c.organization.name].filter(Boolean).join(" · ") || null, code: null, href: `/partners/${c.organization.id}?tab=contacts&contact=${c.id}` });
  }
  return hits;
}
