import { z } from "zod";
import { permitDocLabel, permitDocType } from "./doc-types";
import type { Flag } from "./approvals-plan";

/**
 * Preflight: is this permit's package ready to go to the building
 * department? Pure and client-safe. Deterministic rules, versioned, over what
 * the records hold; the AI review (optional) only ever adds warnings. The
 * score is a readiness score — never a prediction of approval.
 */
export const PREFLIGHT_RULES_VERSION = "pf-1";
export const SCORE_LABEL = "Readiness score — not a prediction of approval";

export type Severity = "BLOCKER" | "WARNING" | "INFO";
export type Evidence = { kind: "tab"; ref: "documents" | "forms" | "products" | "parties" | "corrections" | "overview" | "submissions"; label: string };
export type Finding = { code: string; severity: Severity; message: string; suggestion?: string; evidence?: Evidence[]; source: "rules" | "ai" };

export type PreflightContext = {
  permit: { hasJurisdiction: boolean; permitTypeKey: string | null; valuation: number | null; currentCycle: number; jurisdictionHvhz: boolean };
  property: { parcelNumber: string | null };
  checklist: { id: string; title: string; documentType: string | null; required: boolean; met: boolean }[];
  /** The permit's documents by type, for the sealed-document reminder. */
  documentTypes: (string | null)[];
  forms: {
    available: { id: string; name: string }[];
    fills: { templateId: string; name: string; status: "DRAFT" | "FINAL"; problems: string[]; missing: string[]; signByHand: string[] }[];
  };
  products: { id: string; label: string; flags: Flag[] }[];
  parties: { role: string; name: string; licenseNumber: string | null }[];
  contractor: { licenseNumber: string | null; qualifierName: string | null };
  cycle: {
    latestOutcome: "PENDING" | "APPROVED" | "CORRECTIONS" | "DENIED" | "WITHDRAWN" | null;
    latestHasSubmission: boolean;
    noticeToConfirm: boolean;
    openCorrections: number;
    responseLetterSinceNotice: boolean;
  };
};

const tab = (ref: Evidence["ref"], label: string): Evidence => ({ kind: "tab", ref, label });
const list = (xs: string[], n = 6) => (xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.join(", "));

export function runPreflight(c: PreflightContext): Finding[] {
  const out: Finding[] = [];
  const add = (f: Omit<Finding, "source">) => out.push({ ...f, source: "rules" });

  // where it goes and what it is
  if (!c.permit.hasJurisdiction || !c.permit.permitTypeKey) {
    add({ code: "jurisdiction.set", severity: "BLOCKER", message: "The permit has no jurisdiction or permit type, so its requirements and forms cannot be checked", suggestion: "Pick both on the Overview tab", evidence: [tab("overview", "Overview")] });
  }

  // the review cycle
  if (c.cycle.latestOutcome === "PENDING" && c.cycle.latestHasSubmission) {
    add({ code: "cycle.waiting", severity: "INFO", message: "The last submission is still with the building department; this check is for a revision or the next round" });
  }
  if (c.cycle.noticeToConfirm) {
    add({ code: "cycle.notice", severity: "BLOCKER", message: "A correction notice has not been checked and confirmed yet", suggestion: "Confirm its items on the Corrections tab", evidence: [tab("corrections", "Corrections")] });
  }
  if (c.cycle.latestOutcome === "CORRECTIONS") {
    if (c.cycle.openCorrections > 0) {
      add({ code: "cycle.open_items", severity: "BLOCKER", message: `${c.cycle.openCorrections} correction${c.cycle.openCorrections === 1 ? " is" : "s are"} still open`, suggestion: "Resolve or waive each one before resubmitting", evidence: [tab("corrections", "Corrections")] });
    }
    if (!c.cycle.responseLetterSinceNotice) {
      add({ code: "cycle.response_letter", severity: "WARNING", message: "No response letter has been written for the corrections", suggestion: "Write it from the Corrections tab and include it in the package", evidence: [tab("corrections", "Corrections")] });
    }
  }

  // the documents the jurisdiction asks for
  for (const line of c.checklist) {
    if (line.met) continue;
    if (!line.documentType) {
      add({ code: `requirement.${line.id}`, severity: "INFO", message: `Check by hand: ${line.title}` });
      continue;
    }
    add({
      code: `requirement.${line.id}`,
      severity: line.required ? "BLOCKER" : "WARNING",
      message: `${line.required ? "Missing" : "Not on file (optional)"}: ${line.title}`,
      suggestion: `Upload it on the Documents tab as “${permitDocLabel(line.documentType)}”`,
      evidence: [tab("documents", "Documents")],
    });
  }

  // the application forms
  for (const t of c.forms.available) {
    const fills = c.forms.fills.filter((f) => f.templateId === t.id);
    const final = fills.find((f) => f.status === "FINAL");
    const draft = fills.find((f) => f.status === "DRAFT");
    if (!final) {
      add({
        code: `form.${t.id}`,
        severity: "BLOCKER",
        message: draft ? `The ${t.name} is started but not finalised${draft.problems.length ? ` — ${draft.problems.join("; ")}` : ""}` : `The ${t.name} has not been filled`,
        suggestion: "Fill it on the Forms tab, check it and finalise it",
        evidence: [tab("forms", "Forms")],
      });
      continue;
    }
    if (final.missing.length) add({ code: `form.${t.id}.blank`, severity: "WARNING", message: `The ${t.name} prints with ${final.missing.length} field${final.missing.length === 1 ? "" : "s"} blank: ${list(final.missing)}`, suggestion: "Fill them by hand on the printed form, or add the records and finalise a new fill", evidence: [tab("forms", "Forms")] });
    if (final.signByHand.length) add({ code: `signature.${t.id}`, severity: "WARNING", message: `Signatures to collect on the ${t.name}: ${list(final.signByHand)}`, suggestion: "Sign by hand; notarise where the form has a notary block", evidence: [tab("forms", "Forms")] });
  }

  // who is applying
  if (!c.contractor.licenseNumber) add({ code: "data.contractor", severity: "BLOCKER", message: "No contractor licence number is on record for this permit", suggestion: "Add the qualifier with their licence on the Parties tab, or the licence on the company profile", evidence: [tab("parties", "Parties")] });
  else if (!c.contractor.qualifierName) add({ code: "data.qualifier", severity: "WARNING", message: "No qualifier is named on the permit", suggestion: "Add the qualifier (certificate holder) on the Parties tab", evidence: [tab("parties", "Parties")] });
  const owner = c.parties.find((p) => p.role === "OWNER");
  if (!owner) add({ code: "data.owner", severity: "INFO", message: "No owner party on the permit; forms use the customer on the lead", evidence: [tab("parties", "Parties")] });
  for (const p of c.parties.filter((x) => (x.role === "ARCHITECT" || x.role === "ENGINEER_OF_RECORD") && !x.licenseNumber)) {
    add({ code: `party.licence.${p.role.toLowerCase()}`, severity: "WARNING", message: `${p.name} (${p.role === "ARCHITECT" ? "architect" : "engineer of record"}) has no licence number on record`, suggestion: "Add it on the Parties tab", evidence: [tab("parties", "Parties")] });
  }

  // the property and the job
  if (!c.property.parcelNumber) add({ code: "data.parcel", severity: "WARNING", message: "No parcel number (PCN / folio) on the property", suggestion: "Add it from the property appraiser — a form's Missing row saves it on the property" });
  if (c.permit.valuation == null) add({ code: "data.valuation", severity: "WARNING", message: "No value of the work on the permit", suggestion: "Set it on the Overview tab", evidence: [tab("overview", "Overview")] });

  // products
  for (const p of c.products) {
    for (const f of p.flags) {
      add({
        code: `product.${p.id}.${f.code}`,
        severity: f.level === "danger" ? "BLOCKER" : f.level === "warning" ? "WARNING" : "INFO",
        message: `${p.label}: ${f.message}`,
        suggestion: "Advisory — the engineer of record and the building official decide",
        evidence: [tab("products", "Products")],
      });
    }
  }
  if (c.permit.jurisdictionHvhz && c.permit.permitTypeKey === "reroof" && !c.products.length) {
    add({ code: "product.none", severity: "WARNING", message: "A re-roof in the HVHZ with no product approvals on the permit", suggestion: "Add the NOAs for the assembly on the Products tab", evidence: [tab("products", "Products")] });
  }

  // sealed documents: listed for a person, never verified here
  const sealed = [...new Set(c.documentTypes.filter((t): t is string => !!permitDocType(t)?.sealed))];
  if (sealed.length) add({ code: "sealed.present", severity: "INFO", message: `Confirm these are signed and sealed: ${sealed.map(permitDocLabel).join(", ")}`, suggestion: "The CRM cannot verify a seal" });

  return out;
}

/**
 * The score counts the rules' findings only: an AI look is a second opinion,
 * and the score must not move with a model's answer.
 */
export function score(findings: readonly Finding[]): { score: number; blockers: number; warnings: number } {
  const rules = findings.filter((f) => f.source === "rules");
  const blockers = rules.filter((f) => f.severity === "BLOCKER").length;
  const warnings = rules.filter((f) => f.severity === "WARNING").length;
  return { score: Math.max(0, 100 - 25 * blockers - 5 * warnings), blockers, warnings };
}

/** A finding as a task once a person asks for it: once per permit and rule. */
export const preflightTaskKey = (permitId: string, code: string) => `preflight:${permitId}:${code}`;

// ─── The AI review ──────────────────────────────────────────────────────────

export const aiReviewSchema = z.object({
  findings: z.array(
    z.object({
      message: z.string().describe("One concrete thing a plans examiner is likely to question, in one sentence."),
      evidenceRefs: z.array(z.string()).describe("The ref codes from the summary this is about (e.g. doc:3, form:1, product:2)."),
      suggestion: z.string().nullable(),
    }),
  ),
});
export type AiReview = z.infer<typeof aiReviewSchema>;

/** The AI's points as warnings — never blockers — keeping only those that point at the summary. */
export function aiFindings(r: AiReview, knownRefs: ReadonlySet<string>): Finding[] {
  return r.findings
    .filter((f) => f.message.trim() && f.evidenceRefs.some((ref) => knownRefs.has(ref.trim())))
    .slice(0, 12)
    .map((f, i) => ({ code: `ai.${i + 1}`, severity: "WARNING" as const, message: f.message.trim().slice(0, 400), suggestion: f.suggestion?.trim().slice(0, 300) || undefined, source: "ai" as const }));
}
