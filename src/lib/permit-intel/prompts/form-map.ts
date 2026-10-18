import { z } from "zod";
import { untrustedDocument } from "@/lib/ai/untrusted";
import { DICTIONARY } from "../data-dictionary";
import type { InventoryField } from "../field-fill";

/**
 * Mapping a blank form's fields to data-dictionary keys (`form_map`). The
 * model sees the field names, their printed labels and options, and the
 * dictionary — never any job's data — and answers which key each field
 * means. What it may write as a fixed value is checked afterwards
 * (`acceptMapping`): only a choice among a field's own options.
 */
export const PURPOSE = "form_map";
export const PROMPT_VERSION = "v1";

export const schema = z.object({
  fields: z.array(
    z.object({
      fieldName: z.string(),
      dataKey: z.string().nullable().describe('A dictionary key, "literal:<option>" for a choice that is always the same, "when:<key>=<value>" for a checkbox ticked when the key has that value, or null.'),
      transform: z.string().nullable().describe('null, "upper", "date", "phone", "money", "digits", "char:<n>" (the n-th character, for a number printed one character per box), or "map:<value>=<option>|<value>=<option>" to turn a key\'s value into one of the field\'s options.'),
      confidence: z.number().describe("0 to 1."),
      rationale: z.string().describe("A few words: why this key, or why the field is left for a person."),
    }),
  ),
});
export type FormMapAnswer = z.infer<typeof schema>;

export const SYSTEM = `You map the fields of a blank building-permit application (a fillable PDF) to the keys of a contractor's data dictionary, so the form can be filled from the contractor's records. The contractor is KNU Construction, a licensed general and roofing contractor in Florida; it always applies as the contractor, never as an owner-builder.

For every field listed, answer one mapping:
- A dictionary key when the field asks for that piece of information. Owner fields take owner.* keys, the property / project address takes property.* keys, the contractor block takes contractor.* keys.
- "literal:<option>" only for a radio group, dropdown or checkbox whose answer is the same on every KNU application (for example the "contractor" choice of an owner-builder / contractor question, or "Primary Permit"). The option must be written exactly as listed for the field.
- "when:<key>=<value>" for a checkbox that should be ticked only when a key has a value (for example a trade box ticked when permit.typeKey=reroof).
- A radio group chosen from a key: give the key and a "map:" transform that turns each of the key's values into one of the field's options.
- null when the field is completed by someone else or needs a person: signatures; everything in a notary block (county, day, month, year, the name of the person making the statement, the notary's name, how identity was proven); "for office use only" items; fees, permit numbers and dates the department assigns; tenant, fax, bonding company, mortgage lender and fee-simple titleholder fields; and anything no key fits. A null is always safe.

Rules:
- Never write a name, address, number, licence, date or any other data as a literal. Values come only from keys.
- A number printed one character per box (for example a parcel control number split across many small fields) maps every box to the same key with "char:<n>", numbered in reading order of the boxes as the field names indicate.
- "Print name" beside the contractor's signature is contractor.qualifierName; beside the owner's signature, owner.name.
- Use "date" for date fields, "phone" for phone fields, "money" for the value of the work.
- Confidence is how sure you are the key is what the field asks for.

Dictionary keys:
${DICTIONARY.map((d) => `- ${d.key}: ${d.label} (e.g. ${d.example})${d.protected ? " [licence / qualifier: filled from records only]" : ""}`).join("\n")}`;

export function content(fields: readonly InventoryField[]): string {
  const lines = fields.map((f) => `${JSON.stringify(f.name)} | ${f.type} | page ${f.page + 1} | label: ${f.label ? JSON.stringify(f.label) : "none"}${f.options?.length ? ` | options: ${f.options.map((o) => JSON.stringify(o)).join(", ")}` : ""}${f.maxLen ? ` | max ${f.maxLen} characters` : ""}`);
  return `${untrustedDocument("the blank form's fields: name | type | page | printed label | options", lines.join("\n"))}\n\nMap every field listed, in the same order.`;
}
