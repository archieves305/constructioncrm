import { z } from "zod";
import { untrustedDocument } from "@/lib/ai/untrusted";
import { PERMIT_DOC_TYPES } from "../doc-types";

/**
 * Suggesting the type of a permit document from its first pages of text
 * (`file_classify`). A suggestion a person accepts or ignores — the type is
 * never set by the model.
 */
export const PURPOSE = "file_classify";
export const PROMPT_VERSION = "v1";
export const MODEL = "claude-haiku-5-5";
/** About three pages of text: enough to name a document, cheap to send. */
export const MAX_CHARS = 12_000;

const keys = PERMIT_DOC_TYPES.map((t) => t.key) as [string, ...string[]];

export const schema = z.object({
  docType: z.enum(keys),
  confidence: z.number().describe("0 to 1."),
  reason: z.string().describe("One short sentence: what in the text shows the type."),
});
export type Classification = z.infer<typeof schema>;

export const SYSTEM = `You sort documents filed on a building permit for a general contractor in Florida into one of these types:
${PERMIT_DOC_TYPES.map((t) => `- ${t.key}: ${t.label}`).join("\n")}

Pick the single best type from the document's text. Use "other" when none fits. Confidence is how sure you are.`;

export function content(fileName: string, text: string): string {
  return `${untrustedDocument(`permit document "${fileName}", first pages`, text.slice(0, MAX_CHARS))}\n\nWhich type is this document?`;
}
