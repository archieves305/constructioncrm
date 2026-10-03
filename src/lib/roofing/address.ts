// Address normalization + matching helpers. The normalized `addressKey` is the
// basis for "does this property already exist?" and for matching invoices to
// Roofr reports. We keep this deterministic and dependency-free.

const STREET_ABBR: Record<string, string> = {
  street: "st", str: "st", st: "st",
  avenue: "ave", ave: "ave", av: "ave",
  boulevard: "blvd", blvd: "blvd",
  drive: "dr", dr: "dr",
  road: "rd", rd: "rd",
  lane: "ln", ln: "ln",
  court: "ct", ct: "ct",
  place: "pl", pl: "pl",
  terrace: "ter", ter: "ter",
  circle: "cir", cir: "cir",
  highway: "hwy", hwy: "hwy",
  parkway: "pkwy", pkwy: "pkwy",
  trail: "trl", trl: "trl",
  way: "way",
  north: "n", south: "s", east: "e", west: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
};

export interface ParsedAddress {
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

/** Collapse an address to a stable comparison key. */
export function addressKey(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((t) => STREET_ABBR[t] ?? t)
    .filter(Boolean);
  return tokens.join(" ");
}

/** Build a comparison key from a structured address. */
export function addressKeyFromParts(p: ParsedAddress): string {
  const parts = [p.line1, p.line2, p.city, p.state, p.postalCode].filter(Boolean).join(" ");
  return addressKey(parts);
}

/**
 * Best-effort structured parse of a US single-line address. Roofr reports
 * usually print "123 Main St, Springfield, FL 33701". Falls back gracefully.
 */
export function parseUsAddress(raw: string): ParsedAddress {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  // "..., City, ST 12345"
  const m = cleaned.match(
    /^(.*?),\s*([A-Za-z .'-]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/,
  );
  if (m) {
    return {
      line1: m[1].trim(),
      city: m[2].trim(),
      state: m[3].trim().toUpperCase(),
      postalCode: m[4]?.trim(),
    };
  }
  // "... City ST 12345" without commas
  const m2 = cleaned.match(/^(.*?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m2) {
    return { line1: m2[1].trim(), state: m2[2], postalCode: m2[3] };
  }
  return { line1: cleaned };
}

/**
 * Similarity 0..1 between two address keys (token Jaccard). Used to rank
 * candidate property/invoice matches during historical import.
 */
export function addressSimilarity(a: string, b: string): number {
  const sa = new Set(addressKey(a).split(" ").filter(Boolean));
  const sb = new Set(addressKey(b).split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}
