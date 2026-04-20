const STREET_SUFFIXES = new Set([
  "st", "street",
  "ave", "avenue",
  "blvd", "boulevard",
  "rd", "road",
  "dr", "drive",
  "ln", "lane",
  "ct", "court",
  "pl", "place",
  "ter", "terrace",
  "way", "hwy", "highway",
  "cir", "circle",
  "pkwy", "parkway",
  "sq", "square",
  "trl", "trail",
  "loop",
]);

const DIRECTIONALS = new Set([
  "n", "north",
  "s", "south",
  "e", "east",
  "w", "west",
  "ne", "nw", "se", "sw",
]);

export function normalizeAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length > 0 && !STREET_SUFFIXES.has(tok) && !DIRECTIONALS.has(tok))
    .join(" ")
    .trim();
}

/**
 * Returns true if the PO text plausibly refers to the given job address.
 * Match if normalized PO equals address, OR either is a substring of the other
 * after at least one token (e.g. a house number) appears in both.
 */
export function addressMatches(poText: string, jobAddress: string): boolean {
  const p = normalizeAddress(poText);
  const a = normalizeAddress(jobAddress);
  if (!p || !a) return false;
  if (p === a) return true;

  const pTokens = p.split(" ");
  const aTokens = a.split(" ");

  const pHouse = pTokens[0];
  const aHouse = aTokens[0];
  const sameHouseNumber = /^\d+$/.test(pHouse) && pHouse === aHouse;
  if (!sameHouseNumber) return false;

  const overlap = pTokens
    .slice(1)
    .some((t) => t.length > 1 && aTokens.includes(t));
  return overlap || p === aHouse || a === pHouse;
}
