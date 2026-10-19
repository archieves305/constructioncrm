/**
 * Which requirements apply to a permit, and which are met. Pure.
 *
 * A requirement names a jurisdiction (or none: every jurisdiction) and a
 * permit type (or none: every type). The most specific row for a document
 * type wins, so a jurisdiction can make a company-wide requirement optional,
 * or add one of its own. Only APPROVED rows in effect on the day count.
 */
export type RequirementRow = {
  id: string;
  kind: "REQUIREMENT" | "LESSON" | "TIP";
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "RETIRED";
  jurisdictionId: string | null;
  permitTypeKey: string | null;
  title: string;
  body: string | null;
  documentType: string | null;
  required: boolean;
  reliability: "OFFICIAL" | "INTERNAL" | "OBSERVED";
  sourceUrl: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  sortOrder: number;
};

export type PermitScope = { jurisdictionId: string | null; permitTypeKey: string | null };

/** 3 = this jurisdiction and type, 2 = this jurisdiction, 1 = this type, 0 = everyone; -1 = not for this permit. */
export function specificity(r: Pick<RequirementRow, "jurisdictionId" | "permitTypeKey">, p: PermitScope): number {
  if (r.jurisdictionId && r.jurisdictionId !== p.jurisdictionId) return -1;
  if (r.permitTypeKey && r.permitTypeKey !== p.permitTypeKey) return -1;
  return (r.jurisdictionId ? 2 : 0) + (r.permitTypeKey ? 1 : 0);
}

export function inEffect(r: Pick<RequirementRow, "effectiveFrom" | "effectiveTo">, on: Date): boolean {
  if (r.effectiveFrom && r.effectiveFrom > on) return false;
  if (r.effectiveTo && r.effectiveTo < on) return false;
  return true;
}

export function applicableRequirements(rows: RequirementRow[], permit: PermitScope, on: Date): RequirementRow[] {
  const live = rows
    .filter((r) => r.kind === "REQUIREMENT" && r.status === "APPROVED" && inEffect(r, on))
    .map((r) => ({ r, s: specificity(r, permit) }))
    .filter((x) => x.s >= 0);
  // one row per document type: the most specific; rows with no document type all stand
  const best = new Map<string, { r: RequirementRow; s: number }>();
  const loose: RequirementRow[] = [];
  for (const x of live) {
    if (!x.r.documentType) {
      loose.push(x.r);
      continue;
    }
    const held = best.get(x.r.documentType);
    if (!held || x.s > held.s) best.set(x.r.documentType, x);
  }
  return [...[...best.values()].map((x) => x.r), ...loose].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}

export type ChecklistFile = { id: string; fileName: string; permitDocType: string | null; missing?: boolean };
export type ChecklistLine = { requirement: RequirementRow; files: ChecklistFile[]; met: boolean };

/**
 * Each requirement with the permit's files of its document type. A file
 * missing from the store does not meet it. A requirement with no document
 * type is a note a person ticks off in the review, never met by a file.
 */
export function requirementChecklist(reqs: RequirementRow[], files: ChecklistFile[]): ChecklistLine[] {
  return reqs.map((requirement) => {
    const of = requirement.documentType ? files.filter((f) => f.permitDocType === requirement.documentType) : [];
    return { requirement, files: of, met: of.some((f) => !f.missing) };
  });
}

export function checklistSummary(lines: ChecklistLine[]): { required: number; requiredMet: number; optional: number; optionalMet: number } {
  const req = lines.filter((l) => l.requirement.required && l.requirement.documentType);
  const opt = lines.filter((l) => !l.requirement.required && l.requirement.documentType);
  return { required: req.length, requiredMet: req.filter((l) => l.met).length, optional: opt.length, optionalMet: opt.filter((l) => l.met).length };
}
