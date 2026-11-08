import { z } from "zod";

/**
 * A crew's contact: the foreman's name, phone and language, used for guest
 * links (and later texts). Pure. Phones are stored as +1XXXXXXXXXX so a link
 * or a text can be sent without guessing; what was typed is checked here.
 */
export const CREW_LANGUAGES = ["en", "es"] as const;
export type CrewLanguage = (typeof CREW_LANGUAGES)[number];

/** A US number typed any way → "+1XXXXXXXXXX"; null when it is not one. */
export function normalizeUsPhone(typed: string | null | undefined): string | null {
  const digits = (typed ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10 || ten[0] === "0" || ten[0] === "1") return null;
  return `+1${ten}`;
}

/** "+15551234567" → "(555) 123-4567"; anything else as it is. */
export function displayPhone(stored: string | null | undefined): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(stored ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : stored ?? "";
}

export const crewContactSchema = z.object({
  foremanName: z.string().trim().max(120).nullable().optional(),
  /** Empty clears it; anything else must be a US number. */
  phone: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .optional()
    .refine((v) => v == null || v === "" || normalizeUsPhone(v) !== null, { message: "Enter a 10-digit US phone number" }),
  language: z.enum(CREW_LANGUAGES).optional(),
});
export type CrewContactInput = z.infer<typeof crewContactSchema>;

/** The database fields for a contact change (only what was sent). */
export function contactData(input: CrewContactInput): { foremanName?: string | null; phone?: string | null; language?: CrewLanguage } {
  const out: { foremanName?: string | null; phone?: string | null; language?: CrewLanguage } = {};
  if (input.foremanName !== undefined) out.foremanName = input.foremanName?.trim() || null;
  if (input.phone !== undefined) out.phone = input.phone ? normalizeUsPhone(input.phone) : null;
  if (input.language !== undefined) out.language = input.language;
  return out;
}
