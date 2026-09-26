import { formatAddressLine } from "@/lib/labels/address";
import { caseLabel, type CaseLabelInput } from "@/lib/labels/case";
import { jobLabel, type JobLabelInput } from "@/lib/labels/job";

/** One row in the palette: what to show and where it goes. */
export type SearchHit = {
  type: "job" | "lead" | "case" | "prospect";
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
};

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
  return hits;
}
