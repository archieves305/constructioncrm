import { untrustedDocument } from "@/lib/ai/untrusted";
import { permitDocLabel } from "../doc-types";
import { aiReviewSchema, type PreflightContext } from "../preflight";

/**
 * The optional AI review at preflight (`preflight_review`): a second look at
 * the package's *summary* — what is on file, how the forms stand, the
 * products and their flags, the department's earlier comments on this permit.
 * No document is sent, and no phone or email. Its points come back as
 * warnings that cite the summary's refs; it never blocks a submission.
 */
export const PURPOSE = "preflight_review";
export const PROMPT_VERSION = "v1";
export const schema = aiReviewSchema;

export const SYSTEM = `You help a Florida general contractor get a building permit package right the first time. You are shown a summary of one permit package: the jurisdiction and permit type, the documents on file, the jurisdiction's requirement checklist, the application forms and how complete they are, the products and their approval checks, the parties, and any comments the building department made on this permit before.

Point out up to 8 concrete things a plans examiner is likely to question that the summary shows or that are conspicuously absent for this kind of permit — for example a document type usually required for this work that is not on file, a product approval that does not fit the work, a comment the department made before that the package does not visibly answer.

Rules:
- Each point cites the ref codes it is about (doc:n, req:n, form:n, product:n, party:n, prior:n, permit). A point with no ref is discarded.
- Do not repeat anything in the "Already reported" list, or what the summary marks as missing or flagged, even in other words.
- No engineering judgements, no code citations you are not sure of, no guesses about approval or timing.
- If nothing stands out, return an empty list.`;

export type ReviewInput = {
  jurisdiction: string;
  hvhz: boolean;
  permitType: string | null;
  scope: string | null;
  documents: { name: string; docType: string | null }[];
  priorComments: string[];
};

/** The summary and the set of refs it contains (an AI point must cite one of them). */
export function summary(ctx: PreflightContext, input: ReviewInput, reported: readonly string[] = []): { text: string; refs: Set<string> } {
  const refs = new Set<string>(["permit"]);
  const lines: string[] = [];
  lines.push(`permit: ${input.permitType ?? "type not set"} with ${input.jurisdiction}${input.hvhz ? " (High Velocity Hurricane Zone)" : ""}; value ${ctx.permit.valuation ?? "not set"}; review cycle ${ctx.permit.currentCycle}${input.scope ? `; scope: ${input.scope.slice(0, 300)}` : ""}`);
  lines.push("", "Documents on file:");
  input.documents.forEach((d, i) => {
    refs.add(`doc:${i + 1}`);
    lines.push(`  doc:${i + 1} ${permitDocLabel(d.docType)} — ${d.name.slice(0, 120)}`);
  });
  if (!input.documents.length) lines.push("  (none)");
  lines.push("", "Requirement checklist:");
  ctx.checklist.forEach((r, i) => {
    refs.add(`req:${i + 1}`);
    lines.push(`  req:${i + 1} ${r.title}${r.documentType ? ` [${permitDocLabel(r.documentType)}]` : ""} — ${r.met ? "on file" : r.required ? "MISSING (already reported)" : "not on file (optional)"}`);
  });
  if (!ctx.checklist.length) lines.push("  (no requirements recorded for this jurisdiction and type)");
  lines.push("", "Application forms:");
  ctx.forms.available.forEach((t, i) => {
    refs.add(`form:${i + 1}`);
    const fill = ctx.forms.fills.find((f) => f.templateId === t.id && f.status === "FINAL") ?? ctx.forms.fills.find((f) => f.templateId === t.id);
    lines.push(`  form:${i + 1} ${t.name} — ${fill ? `${fill.status.toLowerCase()}, ${fill.missing.length} blank, ${fill.signByHand.length} to sign` : "not filled"}`);
  });
  if (!ctx.forms.available.length) lines.push("  (no published form for this jurisdiction)");
  lines.push("", "Products:");
  ctx.products.forEach((p, i) => {
    refs.add(`product:${i + 1}`);
    lines.push(`  product:${i + 1} ${p.label.slice(0, 160)}${p.flags.length ? ` — flags: ${p.flags.map((f) => f.code).join(", ")}` : ""}`);
  });
  if (!ctx.products.length) lines.push("  (none)");
  lines.push("", "Parties:");
  ctx.parties.forEach((p, i) => {
    refs.add(`party:${i + 1}`);
    lines.push(`  party:${i + 1} ${p.role.toLowerCase().replace(/_/g, " ")}${p.licenseNumber ? " (licence on record)" : ""}`);
  });
  if (!ctx.parties.length) lines.push("  (none)");
  let prior = "";
  if (input.priorComments.length) {
    const comments = input.priorComments.slice(0, 40).map((c, i) => {
      refs.add(`prior:${i + 1}`);
      return `prior:${i + 1} ${c.replace(/\s+/g, " ").slice(0, 400)}`;
    });
    prior = `\n\n${untrustedDocument("the building department's earlier comments on this permit", comments.join("\n"))}`;
  }
  const already = reported.length ? `\n\nAlready reported by the rules (do not repeat these, or restate them in other words):\n${reported.map((m) => `  - ${m}`).join("\n")}` : "";
  return { text: `${lines.join("\n")}${already}${prior}\n\nReview the package.`, refs };
}
