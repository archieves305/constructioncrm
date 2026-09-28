import { format } from "date-fns";
import { formatAddressLine } from "@/lib/labels/address";
import { caseLabel, type CaseLabelInput } from "@/lib/labels/case";
import { jobLabel, type JobLabelInput } from "@/lib/labels/job";
import { dayKey, dayKeyToLocalDate } from "@/lib/time/zone";

/** One row in the palette: what to show and where it goes. */
export type SearchHit = {
  type: "job" | "lead" | "case" | "prospect" | "task";
  id: string;
  primary: string;
  secondary: string | null;
  code: string | null;
  href: string;
};

export type SearchRows = {
  jobs: (JobLabelInput & { id: string; currentStage?: { name: string } | null })[];
  leads: { id: string; fullName: string; propertyAddress1: string; propertyAddress2?: string | null; city: string; primaryPhone?: string | null; currentStage?: { name: string } | null }[];
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
  return hits;
}
