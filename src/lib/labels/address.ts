/**
 * Address formatting shared by every label. Pure and client-safe.
 *
 * A job has no address of its own — it lives on the lead — so every helper
 * takes the lead-shaped fields and nothing else.
 */

export type AddressInput = {
  propertyAddress1?: string | null;
  propertyAddress2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
};

const PLACEHOLDERS = new Set(["", "tbd", "tba", "n/a", "na", "unknown", "pending", "-", "—"]);

/**
 * True only when the whole street line is empty or a bare placeholder.
 * "2188 (street TBD)" is *not* a placeholder: it carries a house number the
 * user typed, and it is the only thing that tells that job apart from the
 * same customer's other job.
 */
export function isPlaceholderAddress(s: string | null | undefined): boolean {
  return PLACEHOLDERS.has((s ?? "").trim().toLowerCase());
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** "2192 Wind Trace, Navarre" — street[, unit], city. Empty when there is no real street. */
export function formatAddressLine(a: AddressInput | null | undefined): string {
  if (!a) return "";
  const line1 = clean(a.propertyAddress1);
  if (isPlaceholderAddress(line1)) return "";
  const parts = [line1, clean(a.propertyAddress2), clean(a.city)].filter(Boolean);
  return parts.join(", ");
}

/** "2192 Wind Trace, Navarre, FL 32566" — the form contracts and PDFs print. */
export function formatAddressFull(a: AddressInput | null | undefined): string {
  const line = formatAddressLine(a);
  if (!line) return "";
  const region = [clean(a?.state), clean(a?.zipCode)].filter(Boolean).join(" ");
  return region ? `${line}, ${region}` : line;
}
