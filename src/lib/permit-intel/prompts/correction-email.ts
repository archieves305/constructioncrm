import { z } from "zod";
import { untrustedDocument } from "@/lib/ai/untrusted";

/**
 * Drafting an email that asks a party for what a set of correction items
 * needs (`correction_email`). The result is an editable draft and is never
 * sent by itself. The comments are the department's words, framed as
 * untrusted material.
 */
export const PURPOSE = "correction_email";
export const PROMPT_VERSION = "v1";
export const MODEL = "claude-sonnet-5-5";

export const schema = z.object({
  subject: z.string().describe("A short subject naming the property address and the permit or application number."),
  body: z.string().describe("The email body as plain text, with no greeting placeholder left unfilled and no signature block beyond the sender's name."),
});
export type EmailDraft = z.infer<typeof schema>;

export const SYSTEM = `You draft short, courteous business emails for KNU Construction, a general contractor in South Florida, to the architects, engineers, owners, subcontractors and manufacturers on a building permit.

The email asks the recipient for exactly what the building department's correction comments require of them, so the contractor can resubmit.
- Address the recipient by name when one is given.
- Name the property address, the jurisdiction and the permit or application number.
- List each comment with the department's number, quoted as written, and say plainly what is needed (a revised sheet, a signed letter, an updated product approval…). Do not interpret codes or give technical or engineering advice.
- Give the date the revised documents are needed by.
- End with the sender's name only. Plain text, no markdown, no placeholders such as [Name].`;

export type EmailContext = {
  sender: string;
  recipient: { name: string | null; role: string };
  permit: { address: string; jurisdiction: string; reference: string };
  neededBy: string | null;
  items: { number: string | null; text: string; affectsRef: string | null }[];
};

export function content(ctx: EmailContext): string {
  const comments = ctx.items.map((i, n) => `${i.number ?? String(n + 1)}${i.affectsRef ? ` [${i.affectsRef}]` : ""}: ${i.text}`).join("\n\n");
  return [
    `Sender: ${ctx.sender}, KNU Construction.`,
    `Recipient: ${ctx.recipient.name ?? "(no name recorded)"} — ${ctx.recipient.role}.`,
    `Property: ${ctx.permit.address}. Jurisdiction: ${ctx.permit.jurisdiction}. ${ctx.permit.reference}.`,
    ctx.neededBy ? `Needed by: ${ctx.neededBy}.` : "No date has been set; ask for the revisions as soon as possible.",
    "",
    untrustedDocument("building department correction comments", comments),
    "",
    "Draft the email.",
  ].join("\n");
}
