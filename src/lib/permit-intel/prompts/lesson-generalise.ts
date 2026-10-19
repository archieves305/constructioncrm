import { untrustedDocument } from "@/lib/ai/untrusted";
import { CATEGORY_LABEL, TARGET_LABEL, type CorrectionCategory, type CorrectionTarget } from "../corrections-plan";
import { generaliseSchema } from "../lessons";

/**
 * Rewriting accepted correction comments as one general lesson
 * (`lesson_generalise`). The comments arrive scrubbed of the job's
 * particulars; the lesson must read for any job of that jurisdiction and type.
 */
export const PURPOSE = "lesson_generalise";
export const PROMPT_VERSION = "v2";
export const MODEL = "claude-haiku-5-5";
export const schema = generaliseSchema;

export const SYSTEM = `You turn building-department plan review comments into a short lesson a permit coordinator checks before submitting the next application to the same department.

Rules:
- Write it so it applies to any job of this jurisdiction and permit type: no address, owner, permit or application number, date or product name unless the product type itself is the point.
- The title is one imperative line ("Show the overall building height on the elevation sheet"). The body says, in two or three sentences, what the reviewer asked for and how to have it in the package.
- Do not invent code sections or requirements the comments do not state.
- requiresDocType: only when the comment says a kind of document was missing from the submission altogether (e.g. "provide a survey"). A comment about what a document must show, or about a sample, colour or detail, is null.`;

export function content(ctx: { jurisdiction: string; permitType: string | null; category: CorrectionCategory; target: CorrectionTarget; comments: string[] }): string {
  return `Jurisdiction: ${ctx.jurisdiction}. Permit type: ${ctx.permitType ?? "any"}. The comments are ${CATEGORY_LABEL[ctx.category].toLowerCase()} and concern ${TARGET_LABEL[ctx.target].toLowerCase()}.\n\n${untrustedDocument("accepted plan review comments, scrubbed", ctx.comments.map((c, i) => `${i + 1}. ${c}`).join("\n"))}\n\nWrite the lesson.`;
}
